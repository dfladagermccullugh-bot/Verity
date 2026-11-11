import { describe, expect, it } from "vitest";
import { FakeCallSession } from "../src/telephony/fake.js";
import { sleepCall, type CallSession, type TranscriptEvent } from "../src/telephony/types.js";

/** One second of call time passes in 10 ms. */
const FAST = 0.01;
const seconds = (n: number) => Buffer.alloc(8000 * n, 0xff);

function answered(timeScale = FAST): FakeCallSession {
  const call = new FakeCallSession({ timeScale });
  call.answer();
  return call;
}

function marks(call: CallSession): string[] {
  const seen: string[] = [];
  call.on("mark", (name) => seen.push(name));
  return seen;
}

describe("FakeCallSession: speaking", () => {
  it("plays a clip for its length in call time, then confirms it", async () => {
    const call = answered();
    const seen = marks(call);
    const started = Date.now();
    const result = await call.play(seconds(2), "p.intro");
    const real = Date.now() - started;

    expect(result).toEqual({ completed: true });
    expect(seen).toEqual(["p.intro"]);
    // 2 s of call time at 1/100 speed is 20 ms of real time, not 2 s.
    expect(real).toBeGreaterThanOrEqual(15);
    expect(real).toBeLessThan(1000);
    expect(call.played).toHaveLength(1);
    expect(call.played[0]).toMatchObject({ markName: "p.intro", durationMs: 2000, completed: true });
    expect(call.played[0]!.endMs! - call.played[0]!.startMs!).toBe(2000);
  });

  it("plays queued clips one after another, in order", async () => {
    const call = answered();
    const seen = marks(call);
    const results = await Promise.all([call.play(seconds(1), "a"), call.play(seconds(1), "b"), call.play(seconds(1), "c")]);

    expect(results.every((r) => r.completed)).toBe(true);
    expect(seen).toEqual(["a", "b", "c"]);
    const [a, b, c] = call.played;
    expect(b!.startMs).toBe(a!.endMs);
    expect(c!.startMs).toBe(b!.endMs);
    expect(c!.endMs! - a!.startMs!).toBe(3000);
  });

  it("stops the clip that is playing and drops the queue when cleared", async () => {
    const call = answered();
    const seen = marks(call);
    const first = call.play(seconds(60), "q.Q1.ask");
    const second = call.play(seconds(5), "q.Q1.options");
    await sleepCall(call, 3000);
    await call.clearPlayback();

    expect(await first).toEqual({ completed: false });
    expect(await second).toEqual({ completed: false });
    expect(seen).toEqual([]);
    const [cut, never] = call.played;
    expect(cut).toMatchObject({ completed: false, startMs: expect.any(Number) });
    // Cut off about three seconds in, well short of the clip's sixty.
    expect(cut!.endMs! - cut!.startMs!).toBeGreaterThanOrEqual(2500);
    expect(cut!.endMs! - cut!.startMs!).toBeLessThan(30_000);
    expect(never).toMatchObject({ completed: false, startMs: null, endMs: null });
  });

  it("plays normally again after a clear", async () => {
    const call = answered();
    const cut = call.play(seconds(60), "a");
    await call.clearPlayback();
    expect(await cut).toEqual({ completed: false });
    expect(await call.play(seconds(1), "a")).toEqual({ completed: true });
    expect(call.played.map((p) => p.completed)).toEqual([false, true]);
  });

  it("holds audio queued before answer until the call is answered", async () => {
    const call = new FakeCallSession({ timeScale: FAST });
    let done = false;
    const pending = call.play(seconds(1), "p.intro").then((r) => {
      done = true;
      return r;
    });
    await new Promise((r) => setTimeout(r, 40));
    expect(done).toBe(false);
    expect(call.played[0]).toMatchObject({ startMs: null, completed: null });

    call.answer();
    expect(await pending).toEqual({ completed: true });
    expect(call.played[0]!.startMs).toBe(0);
  });

  it("clearing with nothing playing does nothing", async () => {
    const call = answered();
    await call.clearPlayback();
    expect(call.played).toEqual([]);
  });
});

describe("FakeCallSession: the respondent", () => {
  it("delivers what the test makes the respondent say and press", () => {
    const call = answered();
    const heard: TranscriptEvent[] = [];
    const keys: [string, number][] = [];
    const speech: string[] = [];
    call.on("transcript", (e) => heard.push(e));
    call.on("dtmf", (digit, atMs) => keys.push([digit, atMs]));
    call.on("speechStart", (atMs) => speech.push(`start ${atMs}`));
    call.on("utteranceEnd", (atMs) => speech.push(`end ${atMs}`));

    call.speechStart(100);
    call.say("yes", { isFinal: false, startMs: 100, endMs: 300 });
    call.say("yes I do", { startMs: 100, endMs: 700 });
    call.utteranceEnd(700);
    call.say("four");
    call.pressKey("4");

    expect(speech).toEqual(["start 100", "end 700"]);
    expect(heard[0]).toEqual({ text: "yes", isFinal: false, startMs: 100, endMs: 300 });
    expect(heard[1]).toEqual({ text: "yes I do", isFinal: true, startMs: 100, endMs: 700 });
    expect(heard[2]).toMatchObject({ text: "four", isFinal: true, estimated: true });
    expect(keys).toHaveLength(1);
    expect(keys[0]![0]).toBe("4");
    expect(keys[0]![1]).toBeGreaterThanOrEqual(0);
  });

  it("reports the answering-machine verdict and audio state it is given", () => {
    const call = answered();
    const seen: string[] = [];
    call.on("machine", (r) => seen.push(r));
    call.on("audio", (state) => seen.push(state));
    call.machineDetected("machine");
    call.audioState("music");
    expect(seen).toEqual(["machine", "music"]);
  });

  it("ends the call when the respondent hangs up, and nothing more plays", async () => {
    const call = answered();
    const reasons: string[] = [];
    call.on("ended", (r) => reasons.push(r));
    const pending = call.play(seconds(60), "q.Q1.ask");
    call.remoteHangup();

    expect(await pending).toEqual({ completed: false });
    expect(call.ended).toBe(true);
    expect(call.endReason).toBe("remote-hangup");
    expect(await call.play(seconds(1), "q.Q2.ask")).toEqual({ completed: false });
    call.remoteHangup();
    expect(reasons).toEqual(["remote-hangup"]);
  });
});

describe("FakeCallSession: our side", () => {
  it("records a hangup and the keys we send", async () => {
    const call = answered();
    await call.sendDigits("12#");
    await call.hangup();
    expect(call.digitsSent).toEqual(["12#"]);
    expect(call.endReason).toBe("agent-hangup");
  });

  it("measures call time from answer, scaled", async () => {
    const call = new FakeCallSession({ timeScale: FAST });
    expect(call.now()).toBe(0);
    let answeredEvents = 0;
    call.on("answered", () => answeredEvents++);
    call.answer();
    call.answer();
    expect(answeredEvents).toBe(1);
    await sleepCall(call, 2000);
    expect(call.now()).toBeGreaterThanOrEqual(1500);
    expect(call.now()).toBeLessThan(60_000);
  });

  it("runs in real time by default", () => {
    expect(new FakeCallSession().timeScale).toBe(1);
  });
});
