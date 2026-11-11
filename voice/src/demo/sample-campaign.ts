/**
 * A complete simulated campaign on the Library test survey: a contact list, scripted spoken
 * respondents of several kinds, calls placed over several days, then the same outputs a real
 * campaign produces. Everything is seeded, so the result is identical on every run.
 */

import type { Sql } from "../db/sql.js";
import { Store } from "../dialer/store.js";
import { runCampaign, type Connect } from "../dialer/worker.js";
import type { Instrument } from "../instrument/types.js";
import type { Interviewer } from "../interviewer/interviewer.js";
import { writeResponsesCsv } from "../qualtrics/csv.js";
import { campaignReport } from "../report/campaign-report.js";
import { writeCsv } from "../util/csv.js";
import { runVoiceCall } from "../voice/call.js";
import { ScriptedVoice, type SpokenReply } from "../voice/scripted.js";

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0), s / 0x100000000);
}

type Kind = "cooperative" | "straightliner" | "hesitant" | "declines" | "opts_out" | "drops_then_returns" | "never_answers" | "machine_then_answers" | "no_consent";
const MIX: [Kind, number][] = [["cooperative", 30], ["straightliner", 4], ["hesitant", 5], ["declines", 5], ["opts_out", 3], ["drops_then_returns", 4], ["never_answers", 5], ["machine_then_answers", 2], ["no_consent", 2]];
const OPEN_ANSWERS = ["Longer weekend hours", "More parking", "Better wifi", "More books for children", "Open on Sundays", "A quiet study room", "Nothing, it is fine as it is", "More evening events"];

/** What one simulated person says to each question, chosen once from a seed. */
function repliesFor(instrument: Instrument, kind: Kind, rand: () => number): Record<string, SpokenReply> {
  const replies: Record<string, SpokenReply> = {};
  const pick = <T,>(xs: T[]): T => xs[Math.floor(rand() * xs.length)]!;
  const wait = () => ({ afterMs: 350 + Math.floor(rand() * (kind === "hesitant" ? 4000 : 1800)) });
  for (const item of instrument.items) {
    if (item.kind === "statement") continue;
    const slots = item.kind === "grid" ? (item.rows ?? []).map((r) => `${item.id}#${r.code}`) : [item.id];
    const straight = kind === "straightliner" ? pick(item.choices ?? []) : null;
    for (const slot of slots) {
      let say: string;
      if (item.kind === "number") say = String(Math.floor(rand() * 30));
      else if (item.kind === "text") say = pick(OPEN_ANSWERS);
      else if (kind === "hesitant" && rand() < 0.35) say = pick(["I don't know", "hmm, hard to say", "I'd rather not say"]);
      else say = (straight ?? pick(item.choices ?? [])).label;
      replies[slot] = { say, ...wait(), ...(kind === "cooperative" && rand() < 0.06 ? { interruptAt: 0.75 } : {}) };
    }
  }
  // Most people visited a library, so the survey's longer path is exercised.
  replies.QID2 = { say: rand() < 0.8 ? "Yes" : "No", ...wait() };
  replies.QID7 = { say: rand() < 0.85 ? "Yes" : "No", ...wait() };
  return replies;
}

export interface SampleCampaign {
  report: string;
  responsesCsv: string;
  doNotCallCsv: string;
}

export async function runSampleCampaign(sql: Sql, instrument: Instrument): Promise<SampleCampaign> {
  const store = new Store(sql);
  const start = new Date("2026-11-16T17:00:00Z"); // a Monday, midday Eastern
  const campaign = await store.createCampaign({
    name: "Library pilot (simulated)",
    instrument,
    wording: { sponsor: "the Library Study", topic: "your local public library", minutes: 3, askRecording: false },
    settings: { concurrency: 1, maxCallMinutes: 100_000 },
  });

  const kinds: Kind[] = MIX.flatMap(([kind, n]) => Array.from({ length: n }, () => kind));
  const people = kinds.map((kind, i) => ({ kind, ref: `R_${String(i + 1).padStart(3, "0")}`, phone: `+1202555${String(1100 + i)}`, seed: 1000 + i }));
  await store.addCases(
    campaign.id,
    people.map((p) => ({
      phone: p.phone,
      externalRef: p.ref,
      stateCode: "DC",
      consent: p.kind === "no_consent" ? null : { source: `Sign-up form ${p.ref}`, obtainedAt: "2026-11-09T15:00:00.000Z", method: "web_form" as const, scope: "A short phone survey about your local public library, conducted by an AI interviewer." },
    })),
  );
  await store.setCampaignStatus(campaign.id, "running");

  let clock = start.getTime();
  const byPhone = new Map(people.map((p) => [p.phone, p]));
  const connect: Connect = async (claim, interviewer: Interviewer) => {
    const person = byPhone.get(claim.case.phone)!;
    const n = claim.attempt.number;
    if (person.kind === "never_answers" || (person.kind === "machine_then_answers" && n === 1)) {
      clock += 30_000;
      return { connected: false, outcome: person.kind === "never_answers" ? (n % 2 === 0 ? "busy" : "no_answer") : "answering_machine" };
    }
    const rand = rng(person.seed);
    const replies = repliesFor(instrument, person.kind, rand);
    const voice = new ScriptedVoice(() => {
      const e = interviewer.expecting();
      if (e.kind === "consent") return { say: person.kind === "declines" ? "no thank you" : "yes", afterMs: 700 };
      if (e.kind !== "answer") return { say: "yes" };
      if (person.kind === "opts_out" && e.slot === "QID5") return { say: "please take me off your list" };
      if (person.kind === "drops_then_returns" && n === 1 && e.slot === "QID5") return { hangup: true };
      return replies[e.slot] ?? { say: "I don't know" };
    });
    await runVoiceCall(interviewer, voice);
    clock += voice.now;
    return { connected: true };
  };

  // Four calling sessions, a day and a bit apart, so retries fall due and land at different times of day.
  for (let session = 0; session < 5; session++) {
    clock = start.getTime() + session * 27 * 3_600_000;
    await runCampaign(store, campaign.id, { transport: "simulated", connect, now: () => new Date(clock) });
  }

  const report = await campaignReport(store, campaign.id, {
    researcher: "Verity Voice (demonstration)",
    recruitment: "No real people were called. The respondents are scripted stand-ins of several kinds (cooperative, hesitant, declining, dropping the call, never answering), each fixed by a seed.",
    classifier: null,
    voice: "none (simulated; no audio was produced)",
    recogniser: "none (simulated; replies are text)",
    transport: "simulated",
  });
  const records = (await store.responseRecords(campaign.id)).sort((a, b) => a.caseId.localeCompare(b.caseId));
  const dnc = await store.doNotCallList();
  return {
    report,
    responsesCsv: writeResponsesCsv(instrument, records),
    doNotCallCsv: writeCsv([["phone", "reason", "added_at"], ...dnc.sort((a, b) => a.phone.localeCompare(b.phone)).map((d) => [d.phone, d.reason, d.addedAt.toISOString()])]),
  };
}
