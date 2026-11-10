/** Builds docs/sample-calls.md: three simulated calls on the Library test survey. */

import type { Instrument } from "../instrument/types.js";
import { at, cooperative, scriptedModel, simulateCall } from "../interviewer/simulate.js";
import { renderCallReport } from "./call-report.js";

const REPLIES: Record<string, string> = {
  QID2: "Yes",
  QID3: "About once a month",
  "QID4#1": "Somewhat agree",
  "QID4#2": "Neither agree nor disagree",
  "QID4#3": "Strongly agree",
  QID5: "8",
  QID6: "12",
  QID7: "yes",
  QID8: "Longer weekend hours",
  QID9: "Good",
};

export async function renderSampleCalls(instrument: Instrument): Promise<string> {
  const natural = "probably about once a month I'd say";
  const vague = "oh, it's fine I suppose";
  const model = scriptedModel({
    [natural]: { intent: "answer", answer: { kind: "choice", code: "3" }, confidence: 0.93, evidence: "about once a month" },
    [vague]: { intent: "answer", answer: { kind: "choice", code: "3" }, confidence: 0.62, evidence: "fine" },
  });
  const everyday = (ctx: Parameters<ReturnType<typeof cooperative>>[0]) => {
    const slot = ctx.expecting.kind === "answer" ? ctx.expecting.slot : "";
    if (slot === "QID3" && ctx.attempt === 1) return natural;
    if (slot === "QID4#2" && ctx.attempt === 1) return "sorry, can you repeat that?";
    if (slot === "QID6" && ctx.attempt === 1) return "I'd rather not say";
    if (slot === "QID9" && ctx.attempt <= 3) return vague;
    return cooperative(REPLIES)(ctx);
  };
  const calls = [
    ["Call 1 — an everyday respondent", await simulateCall({ instrument, persona: everyday, model })],
    ["Call 2 — declines to take part", await simulateCall({ instrument, persona: () => "no thank you" })],
    ["Call 3 — asks to be removed part-way through", await simulateCall({ instrument, persona: at("QID5", "please take me off your list", cooperative(REPLIES)) })],
  ] as const;
  const head = [
    "# Sample calls",
    "",
    "Three simulated calls on the Library test survey, produced by the real interviewer code with",
    "scripted respondents typing in place of speech. A stand-in replaces the language model, with",
    "fixed readings for two replies. This file is generated; a test fails if it goes out of date.",
    "",
    "What to look for: the AI disclosure and consent come first; questions are word for word; the",
    "interviewer never comments on an answer; an unsure reading is probed, not guessed; a refusal is",
    "accepted at once; \"remove me\" ends the call immediately.",
    "",
  ];
  return [...head, ...calls.map(([title, call]) => renderCallReport(title, instrument, call))].join("\n");
}
