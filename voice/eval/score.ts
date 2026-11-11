/** Scoring a classifier against the labelled replies. Used by the tests and by `npm run eval`. */

import type { Instrument, Item } from "../src/instrument/types.js";
import { classify, type Classification, type ModelClassifier, type ModelRequest } from "../src/interviewer/classify.js";
import { DATASET, type Target } from "./dataset.js";

export interface Scored {
  target: Target;
  utterance: string;
  expected: string[];
  got: string;
  correct: boolean;
  classification: Classification;
}

/** The reading as a short label, in the dataset's notation. */
export function label(c: Classification): string {
  if (c.intent === "answer" && c.answer) {
    const a = c.answer;
    if (a.kind === "choice") return `c:${a.code}`;
    if (a.kind === "number") return `n:${a.value}`;
    if (a.kind === "text") return "text";
    return a.reason === "dont_know" ? "dk" : a.reason === "refused" ? "ref" : "unclear";
  }
  return c.intent === "opt_out" ? "optout" : c.intent;
}

export function requestFor(instrument: Instrument, target: Target, utterance: string): ModelRequest {
  if (target === "consent") return { utterance, expecting: "consent" };
  const item: Item | undefined = instrument.items.find((i) => i.id === target);
  if (!item) throw new Error(`The survey has no ${target}`);
  return { utterance, expecting: "answer", item };
}

export async function scoreAll(instrument: Instrument, model?: ModelClassifier, concurrency = 8): Promise<Scored[]> {
  const jobs: { target: Target; utterance: string; expected: string[] }[] = [];
  for (const [target, rows] of Object.entries(DATASET) as [Target, (typeof DATASET)[Target]][]) {
    for (const [utterance, ...expected] of rows) jobs.push({ target, utterance, expected });
  }
  const out: Scored[] = new Array(jobs.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      for (;;) {
        const i = next++;
        const job = jobs[i];
        if (!job) return;
        const classification = await classify(requestFor(instrument, job.target, job.utterance), model);
        const got = label(classification);
        out[i] = { ...job, got, correct: job.expected.includes(got), classification };
      }
    }),
  );
  return out;
}

export interface Summary {
  n: number;
  /** Share of all replies read as an acceptable label. */
  accuracy: number;
  /** Replies decided by a rule, and how many of those were right. */
  byRule: { n: number; correct: number };
  /** Replies decided by the model (after its verdict passed the code checks), and how many were right. */
  byModel: { n: number; correct: number };
  /** Model verdicts thrown away by the code checks. */
  discarded: number;
  /**
   * The costly error: a substantive answer that would be RECORDED without a probe (confidence at
   * or above the accept threshold) and is wrong. Everything else wrong only costs a probe.
   */
  falseAccepts: Scored[];
  /** Correct readings that fall below the accept threshold: they cost a probe but record nothing wrong. */
  needlessProbes: number;
  /** Confidence against correctness for model-decided replies, in bands. */
  calibration: { band: string; n: number; correct: number }[];
  wrong: Scored[];
}

const ANSWER = /^(c:|n:|text|yes$|no$)/;

export function summarize(scored: Scored[], acceptAt = 0.85): Summary {
  const rule = scored.filter((s) => s.classification.by === "rule" && s.got !== "unclear");
  const model = scored.filter((s) => s.classification.by === "model" && !s.classification.rejected);
  const bands = [0, 0.5, 0.7, 0.85, 0.95, 1.000001];
  return {
    n: scored.length,
    accuracy: scored.filter((s) => s.correct).length / scored.length,
    byRule: { n: rule.length, correct: rule.filter((s) => s.correct).length },
    byModel: { n: model.length, correct: model.filter((s) => s.correct).length },
    discarded: scored.filter((s) => s.classification.rejected).length,
    falseAccepts: scored.filter((s) => !s.correct && ANSWER.test(s.got) && s.classification.confidence >= acceptAt),
    needlessProbes: scored.filter((s) => s.correct && ANSWER.test(s.got) && s.classification.confidence < acceptAt).length,
    calibration: bands.slice(0, -1).map((lo, i) => {
      const hi = bands[i + 1]!;
      const inBand = model.filter((s) => s.classification.confidence >= lo && s.classification.confidence < hi);
      return { band: `${lo.toFixed(2)}–${Math.min(hi, 1).toFixed(2)}`, n: inBand.length, correct: inBand.filter((s) => s.correct).length };
    }),
    wrong: scored.filter((s) => !s.correct),
  };
}

const pct = (a: number, b: number) => (b === 0 ? "n/a" : `${((100 * a) / b).toFixed(1)}%`);

export function renderSummary(s: Summary, title: string): string {
  const lines = [
    `## ${title}`,
    "",
    `Labelled replies: ${s.n} (hand-written for this project, not real calls).`,
    "",
    "| Measure | Value |",
    "|---|---|",
    `| Read as an acceptable label | ${pct(Math.round(s.accuracy * s.n), s.n)} |`,
    `| Decided by a rule | ${s.byRule.n} (${pct(s.byRule.correct, s.byRule.n)} right) |`,
    `| Decided by the model | ${s.byModel.n} (${pct(s.byModel.correct, s.byModel.n)} right) |`,
    `| Model verdicts discarded by code checks | ${s.discarded} |`,
    `| Wrong answers that would be recorded without a probe | ${s.falseAccepts.length} (${pct(s.falseAccepts.length, s.n)}) |`,
    `| Right answers probed anyway | ${s.needlessProbes} |`,
    "",
  ];
  if (s.byModel.n > 0) {
    lines.push("| Model confidence | Replies | Right |", "|---|---|---|", ...s.calibration.map((c) => `| ${c.band} | ${c.n} | ${pct(c.correct, c.n)} |`), "");
  }
  if (s.falseAccepts.length > 0) {
    lines.push("Wrong answers that would be recorded:", "", ...s.falseAccepts.map((w) => `- ${w.target}: "${w.utterance}" read as ${w.got} (expected ${w.expected.join(" or ")}), confidence ${w.classification.confidence.toFixed(2)}`), "");
  }
  return lines.join("\n");
}
