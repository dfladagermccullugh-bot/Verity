/**
 * Telnyx carrier: places calls with Call Control and carries audio both ways over one
 * media-stream WebSocket.
 *
 * Origin: phone_map `server/telephony/telnyx.ts`. Changed here:
 * - The stream is two-way (`stream_bidirectional_mode: "rtp"`): `play`, `clearPlayback`, marks.
 * - Key presses arrive as `dtmf` events on the stream; answering-machine detection is optional.
 * - The listener is injected (`SttFactory`) and opened at answer, not at dial. Telnyx's own
 *   transcription (`transcription_start`) is not carried over.
 * - Configuration is a plain `TelnyxConfig`. Signature checks cannot be switched off.
 * - `startCall` refuses numbers that fail `checkCallable`, so the rule holds at the last step
 *   before the carrier whatever the dialer above it does.
 *
 * Checked against Telnyx's media-streaming, dial and answering-machine pages on 10 Nov 2026.
 * What those pages leave open, and what this file does about it:
 * - They do not say whether `stream_track` must change for two-way audio. It stays
 *   `inbound_track`, so our own speech is not streamed back to us and into the listener.
 * - `stream_bidirectional_target_legs` defaults to `opposite` and the pages do not define that
 *   for a call with one leg. It is left at the default; confirm on the first real call that the
 *   respondent hears the audio.
 * - No rate limit is given for RTP media frames, but a `rate_limit_reached` stream error
 *   exists. Frames are therefore sent at playback speed with a short lead, not in one burst.
 * - `clear` makes Telnyx send back the marks of the audio it dropped. A returned mark alone
 *   therefore does not prove audio was heard; marks are numbered on the wire and any that come
 *   back after a clear are ignored.
 * - There is no acknowledgement of `clear`, and no report of how much of a clip had played.
 * - Stream events may arrive out of order (`chunk`, `occurred_at`). They are taken in arrival
 *   order here.
 * Nothing in this file has been run against a live Telnyx account.
 */

import crypto from "node:crypto";
import type { WebSocket } from "ws";
import { checkCallable } from "../util/phone.js";
import { AudioClassifier, FRAME_MS, SAMPLE_RATE, mulawFrames } from "./audio.js";
import type { SttFactory, SttStream } from "./stt.js";
import { CallSession, type MachineResult, type PlayResult, type StartCallOptions, type TelephonyProvider } from "./types.js";

const API = "https://api.telnyx.com/v2";
export const TELNYX_WEBHOOK_PATH = "/telnyx/webhook";
/** The per-call token is appended as one more path segment. */
export const TELNYX_MEDIA_PATH = "/telnyx/media";

/** DER prefix that turns a raw 32-byte Ed25519 public key into SPKI form. */
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");
const DTMF_MS = 250;
/** How far ahead of real time outbound audio is sent. Covers timer and network jitter. */
const SEND_AHEAD_MS = 300;

/**
 * Verify a Telnyx signature: Ed25519 (base64, header telnyx-signature-ed25519) over
 * `${telnyx-timestamp}|${signed}`, checked with the account's public key, within a replay
 * window. `signed` is the raw body for a webhook and the stream URL for a media-stream
 * connection.
 */
export function verifyTelnyxSignature(
  publicKeyB64: string,
  signed: string,
  timestamp: string | undefined,
  signatureB64: string | undefined,
  toleranceSeconds = 300,
  nowMs = Date.now(),
): boolean {
  if (!publicKeyB64 || !timestamp || !signatureB64) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(nowMs / 1000 - ts) > toleranceSeconds) return false;
  try {
    const raw = Buffer.from(publicKeyB64, "base64");
    const key = crypto.createPublicKey({ key: raw.length === 32 ? Buffer.concat([ED25519_SPKI_PREFIX, raw]) : raw, format: "der", type: "spki" });
    return crypto.verify(null, Buffer.from(`${timestamp}|${signed}`), key, Buffer.from(signatureB64, "base64"));
  } catch {
    return false;
  }
}

export interface TelnyxConfig {
  apiKey: string;
  /** The Call Control application calls are placed from. */
  connectionId: string;
  fromNumber: string;
  /** The https origin Telnyx reaches us on. The routes in telnyx-routes.ts are served under it. */
  publicBaseUrl: string;
  /** The account's Ed25519 public key (base64). Webhooks and stream connections are checked against it. */
  publicKey: string;
  /** Two-letter country codes that may be dialled. */
  allowedCountries: string[];
  /** Opens the listener for one call. */
  stt: SttFactory;
  /** Where operational errors go. Defaults to console.error. */
  log?: (message: string) => void;
}

export interface TelnyxWebhook {
  data?: { event_type?: string; payload?: Record<string, unknown> };
}

interface TelnyxStreamMessage {
  event?: "connected" | "start" | "media" | "stop" | "dtmf" | "mark" | "error";
  media?: { track?: string; payload?: string };
  dtmf?: { digit?: string };
  mark?: { name?: string };
  payload?: { code?: number; title?: string; detail?: string };
}

interface PendingPlay {
  /** The mark name sent to Telnyx: numbered, so a replayed line cannot be confused with its earlier self. */
  wire: string;
  name: string;
  frames: Buffer[];
  next: number;
  resolve: (r: PlayResult) => void;
}

export class TelnyxCallSession extends CallSession {
  readonly provider = "telnyx";
  readonly timeScale = 1;
  private stt: SttStream | null = null;
  private audio: AudioClassifier;
  private ws: WebSocket | null = null;
  /** Telnyx has sent `start` on the socket, so it will accept media. */
  private streaming = false;
  private maxTimer: NodeJS.Timeout | null = null;
  private dtmfChain: Promise<void> = Promise.resolve();
  /** Every play not yet resolved, by wire mark name. */
  private plays = new Map<string, PendingPlay>();
  /** The plays with frames still to send, in order. */
  private sending: PendingPlay[] = [];
  private playSeq = 0;
  private pumpTimer: NodeJS.Timeout | null = null;
  /** Real time at which the audio sent so far will have finished playing. */
  private sentUntil = 0;
  private machineReported = false;

  constructor(
    readonly token: string,
    /** Exactly the `stream_url` given to Telnyx, which is what it signs when it connects. */
    readonly streamUrl: string,
    private carrier: TelnyxProvider,
    private sttFactory: SttFactory,
  ) {
    super();
    this.audio = new AudioClassifier((state, atMs) => this.emit("audio", state, atMs));
  }

  setMaxDuration(seconds: number): void {
    this.maxTimer = setTimeout(() => void this.hangup(), seconds * 1000);
    this.maxTimer.unref();
  }

  attachSocket(ws: WebSocket): void {
    this.ws = ws;
    ws.on("message", (data) => {
      let msg: TelnyxStreamMessage;
      try {
        msg = JSON.parse(data.toString()) as TelnyxStreamMessage;
      } catch {
        return;
      }
      this.onStreamMessage(msg);
    });
    ws.on("error", (err) => this.carrier.log(`Telnyx stream socket error: ${err.message}`));
    ws.on("close", () => {
      this.streaming = false;
      if (this.answered) this.finish("stream-closed");
    });
  }

  private onStreamMessage(msg: TelnyxStreamMessage): void {
    switch (msg.event) {
      case "start":
        this.streaming = true;
        this.pump();
        break;
      case "media":
        // Audio before answer is ringing or early media, not the respondent.
        if (this.answered && msg.media?.payload && (!msg.media.track || msg.media.track === "inbound")) {
          const buf = Buffer.from(msg.media.payload, "base64");
          this.stt?.write(buf);
          this.audio.pushMulaw(buf);
        }
        break;
      case "mark":
        if (msg.mark?.name) this.onMark(msg.mark.name);
        break;
      case "dtmf":
        // Stamped on arrival: Telnyx's own `occurred_at` is on its clock, and call time is on ours.
        if (msg.dtmf?.digit) this.emit("dtmf", msg.dtmf.digit, this.now());
        break;
      case "error":
        this.carrier.log(`Telnyx stream error ${msg.payload?.code ?? "?"} ${msg.payload?.title ?? ""}: ${msg.payload?.detail ?? ""}`);
        break;
      case "stop":
        this.finish("stream-stopped");
        break;
    }
  }

  handleWebhook(eventType: string, payload: Record<string, unknown>): void {
    switch (eventType) {
      case "call.answered":
        // Webhooks can be delivered twice.
        if (this.answered || this.ended) break;
        this.stt = this.openStt();
        this.markAnswered();
        this.pump();
        break;
      case "call.machine.detection.ended":
        if (this.machineReported) break;
        this.machineReported = true;
        this.emit("machine", toMachineResult(payload.result));
        break;
      case "call.hangup":
        this.finish(this.answered ? "remote-hangup" : `call-${String(payload.hangup_cause ?? "not-answered")}`);
        break;
    }
  }

  private openStt(): SttStream {
    const stt = this.sttFactory({ encoding: "mulaw", sampleRate: SAMPLE_RATE });
    stt.on("transcript", (e) => this.emit("transcript", e));
    stt.on("speechStart", (atMs) => this.emit("speechStart", atMs));
    stt.on("utteranceEnd", (atMs) => this.emit("utteranceEnd", atMs));
    stt.on("error", (err) => this.carrier.log(`[telnyx ${this.token.slice(0, 6)}] listener error: ${err.message}`));
    return stt;
  }

  play(mulaw: Buffer, markName: string): Promise<PlayResult> {
    if (this.ended) return Promise.resolve({ completed: false });
    return new Promise((resolve) => {
      const p: PendingPlay = { wire: `${++this.playSeq}:${markName}`, name: markName, frames: mulawFrames(mulaw), next: 0, resolve };
      this.plays.set(p.wire, p);
      this.sending.push(p);
      this.pump();
    });
  }

  /**
   * Audio that has in fact finished at the carrier, but whose mark has not reached us yet,
   * is reported as not completed. The window is one network round trip.
   */
  async clearPlayback(): Promise<void> {
    if (this.plays.size === 0) return;
    this.send({ event: "clear" });
    this.dropPlays();
  }

  /**
   * Send queued frames until the carrier holds `SEND_AHEAD_MS` of audio, then come back in one
   * frame's time. Each clip is followed by its mark, which Telnyx returns when the clip has played.
   */
  private pump(): void {
    if (this.pumpTimer) clearTimeout(this.pumpTimer);
    this.pumpTimer = null;
    if (!this.answered || !this.streaming) return;
    const now = Date.now();
    if (this.sentUntil < now) this.sentUntil = now;
    for (let p = this.sending[0]; p && this.sentUntil - now < SEND_AHEAD_MS; p = this.sending[0]) {
      const frame = p.frames[p.next];
      if (frame) {
        this.send({ event: "media", media: { payload: frame.toString("base64") } });
        this.sentUntil += FRAME_MS;
        p.next++;
      }
      if (p.next >= p.frames.length) {
        this.send({ event: "mark", mark: { name: p.wire } });
        this.sending.shift();
      }
    }
    if (this.sending.length > 0) this.pumpTimer = setTimeout(() => this.pump(), FRAME_MS);
  }

  private onMark(wire: string): void {
    const p = this.plays.get(wire);
    // Unknown marks are the ones Telnyx returns for audio we cleared.
    if (!p) return;
    this.plays.delete(wire);
    p.resolve({ completed: true });
    this.emit("mark", p.name);
  }

  private dropPlays(): void {
    if (this.pumpTimer) clearTimeout(this.pumpTimer);
    this.pumpTimer = null;
    this.sentUntil = 0;
    this.sending = [];
    const dropped = [...this.plays.values()];
    this.plays.clear();
    for (const p of dropped) p.resolve({ completed: false });
  }

  private send(msg: Record<string, unknown>): void {
    if (this.ws && this.ws.readyState === this.ws.OPEN) this.ws.send(JSON.stringify(msg));
  }

  /** Out-of-band DTMF (RFC 2833) via the Call Control API: more reliable than in-band tones. */
  sendDigits(digits: string): Promise<void> {
    const run = async () => {
      if (this.ended || !this.providerCallId) return;
      await this.carrier.action(this.providerCallId, "send_dtmf", { digits, duration_millis: DTMF_MS });
      await new Promise((r) => setTimeout(r, digits.length * (DTMF_MS + 100)));
    };
    this.dtmfChain = this.dtmfChain.then(run, run);
    return this.dtmfChain;
  }

  async hangup(): Promise<void> {
    if (this.ended) return;
    const id = this.providerCallId;
    this.finish("agent-hangup");
    if (id) await this.carrier.action(id, "hangup", {}).catch((e: Error) => this.carrier.log(`Telnyx hangup failed: ${e.message}`));
  }

  private finish(reason: string): void {
    if (this.ended) return;
    if (this.maxTimer) clearTimeout(this.maxTimer);
    this.stt?.close();
    this.dropPlays();
    this.ws?.close();
    this.carrier.forget(this);
    this.markEnded(reason);
  }
}

/** Telnyx's standard detection answers `human`, `machine` or `not_sure`. */
function toMachineResult(result: unknown): MachineResult {
  return result === "human" || result === "machine" ? result : "unknown";
}

/**
 * Places real calls with Telnyx Call Control. Audio in both directions, playback marks and key
 * presses travel over a Telnyx media-stream WebSocket; call progress arrives as signed webhooks.
 */
export class TelnyxProvider implements TelephonyProvider {
  readonly name = "telnyx";
  private byToken = new Map<string, TelnyxCallSession>();
  private byCallId = new Map<string, TelnyxCallSession>();

  constructor(private cfg: TelnyxConfig) {
    for (const key of ["apiKey", "connectionId", "fromNumber", "publicKey"] as const) {
      if (!cfg[key]) throw new Error(`Telnyx configuration is missing ${key}.`);
    }
    // Telnyx only delivers webhooks and streams to a public TLS address.
    if (!/^https:\/\//.test(cfg.publicBaseUrl)) throw new Error("Telnyx needs a public https base URL.");
  }

  get(token: string): TelnyxCallSession | undefined {
    return this.byToken.get(token);
  }

  forget(s: TelnyxCallSession): void {
    this.byToken.delete(s.token);
    if (s.providerCallId) this.byCallId.delete(s.providerCallId);
  }

  log(message: string): void {
    (this.cfg.log ?? console.error)(message);
  }

  /** True when `signed` (a webhook's raw body, or a stream URL) carries a genuine Telnyx signature. */
  verify(signed: string, timestamp: string | undefined, signature: string | undefined): boolean {
    return verifyTelnyxSignature(this.cfg.publicKey, signed, timestamp, signature);
  }

  private headers(): Record<string, string> {
    return { Authorization: `Bearer ${this.cfg.apiKey}`, "Content-Type": "application/json", Accept: "application/json" };
  }

  async action(callControlId: string, action: string, body: Record<string, unknown>): Promise<void> {
    const res = await fetch(`${API}/calls/${encodeURIComponent(callControlId)}/actions/${action}`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
    });
    // 422 on hangup/dtmf usually means the call already ended.
    if (!res.ok && res.status !== 422) throw new Error(`Telnyx ${action} failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
  }

  async startCall(e164: string, opts: StartCallOptions): Promise<CallSession> {
    const callable = checkCallable(e164, this.cfg.allowedCountries);
    if (!callable.ok) throw new Error(`Refusing to dial: ${callable.reason}`);
    const token = crypto.randomBytes(24).toString("hex");
    const base = this.cfg.publicBaseUrl.replace(/\/$/, "");
    const streamUrl = `${base.replace(/^http/, "ws")}${TELNYX_MEDIA_PATH}/${token}`;
    const session = new TelnyxCallSession(token, streamUrl, this, this.cfg.stt);
    this.byToken.set(token, session);
    const res = await fetch(`${API}/calls`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        connection_id: this.cfg.connectionId,
        to: e164,
        from: this.cfg.fromNumber,
        webhook_url: `${base}${TELNYX_WEBHOOK_PATH}`,
        stream_url: streamUrl,
        stream_track: "inbound_track",
        stream_bidirectional_mode: "rtp",
        stream_bidirectional_codec: "PCMU",
        client_state: Buffer.from(token).toString("base64"),
        timeout_secs: 30,
        time_limit_secs: opts.maxDurationSeconds,
        // Standard detection: one `call.machine.detection.ended` webhook, no wait for the beep.
        ...(opts.amd ? { answering_machine_detection: "detect" } : {}),
      }),
    });
    if (!res.ok) {
      this.byToken.delete(token);
      throw new Error(`Telnyx call failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
    }
    const json = (await res.json()) as { data?: { call_control_id?: string } };
    const id = json.data?.call_control_id;
    if (!id) {
      this.byToken.delete(token);
      throw new Error("Telnyx call response had no call_control_id");
    }
    session.providerCallId = id;
    this.byCallId.set(id, session);
    session.setMaxDuration(opts.maxDurationSeconds + 30);
    return session;
  }

  /** Route a verified webhook to its call (by our client_state token, falling back to call_control_id). */
  handleWebhook(body: TelnyxWebhook): void {
    const type = body.data?.event_type;
    const payload = body.data?.payload ?? {};
    if (!type) return;
    let session: TelnyxCallSession | undefined;
    if (typeof payload.client_state === "string") session = this.byToken.get(Buffer.from(payload.client_state, "base64").toString());
    if (!session && typeof payload.call_control_id === "string") session = this.byCallId.get(payload.call_control_id);
    if (session && !session.providerCallId && typeof payload.call_control_id === "string") {
      session.providerCallId = payload.call_control_id;
      this.byCallId.set(payload.call_control_id, session);
    }
    session?.handleWebhook(type, payload);
  }
}
