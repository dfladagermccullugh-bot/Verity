/** A readable account of one call: the transcript, then how each answer was reached. */

import type { Instrument } from "../instrument/types.js";
import type { AuditEvent } from "../interviewer/interviewer.js";
import type { SimulatedCall } from "../interviewer/simulate.js";

function answerText(instrument: Instrument, slot: string, call: SimulatedCall): string {
  const a = call.interviewer.state.interview.answers[slot];
  if (!a) return "";
  if (a.kind === "nonresponse") return { dont_know: "(don't know)", refused: "(declined)", no_answer: "(no usable answer)" }[a.reason];
  if (a.kind === "number") return String(a.value);
  if (a.kind === "text") return `"${a.value}"`;
  const item = instrument.items.find((i) => i.id === slot.split("#")[0]);
  return item?.choices?.find((c) => c.code === a.code)?.label ?? a.code;
}

export function renderCallReport(title: string, instrument: Instrument, call: SimulatedCall): string {
  const out: string[] = [`## ${title}`, ""];
  const s = call.interviewer.state;
  out.push(`Outcome: **${call.hungUp ? "breakoff (hung up)" : s.outcome}**. Answers recorded: ${Object.keys(s.interview.answers).length}. Flagged for human review: ${s.review.length === 0 ? "none" : s.review.join(", ")}.`, "");
  out.push("### Transcript", "");
  for (const t of call.transcript) out.push(`- **${t.speaker === "interviewer" ? "Interviewer" : "Respondent"}:** ${t.text}`);
  out.push("", "### How each answer was reached", "", "| Question | Respondent said | Read as | Decided by | Confidence | Decision |", "|---|---|---|---|---|---|");
  const log = call.interviewer.log;
  log.forEach((e: AuditEvent, i) => {
    if (e.type !== "classified" || e.expecting !== "answer") return;
    const heard = log[i - 1];
    const decision = log.slice(i + 1).find((d) => d.type === "decision");
    const c = e.classification;
    const readAs = c.intent === "answer" && decision?.type === "decision" && (decision.action === "record" || decision.action === "nonresponse") ? answerText(instrument, e.slot!, call) : c.intent;
    const cell = (x: string) => x.replace(/\|/g, "\\|");
    out.push(`| ${e.slot} | ${cell(heard?.type === "heard" ? heard.text : "")} | ${cell(readAs)} | ${c.by}${c.rejected ? " (discarded)" : ""} | ${c.confidence.toFixed(2)} | ${cell(decision?.type === "decision" ? decision.detail : "")} |`);
  });
  out.push("");
  return out.join("\n");
}
