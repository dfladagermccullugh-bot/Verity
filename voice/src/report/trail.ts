import type { Instrument } from "../instrument/types.js";
import type { AuditEvent } from "../interviewer/interviewer.js";

export interface TrailRow {
  slot: string;
  question: string;
  said: string;
  readAs: string;
  by: string;
  confidence: number;
  decision: string;
}

/** A readable account of how each answer was reached: one row per reply to a question. */
export function trail(instrument: Instrument, log: AuditEvent[]): TrailRow[] {
  const out: TrailRow[] = [];
  for (let i = 0; i < log.length; i++) {
    const e = log[i]!;
    if (e.type !== "classified" || e.expecting !== "answer") continue;
    const heard = log.slice(0, i).reverse().find((x) => x.type === "heard");
    const decision = log.slice(i + 1).find((x) => x.type === "decision");
    const item = instrument.items.find((it) => it.id === e.slot?.split("#")[0]);
    const row = e.slot?.includes("#") ? item?.rows?.find((r) => r.code === e.slot!.split("#")[1])?.label : undefined;
    const a = e.classification.answer;
    const readAs = e.classification.intent !== "answer" || !a ? e.classification.intent.replace("_", " ") : a.kind === "choice" ? (item?.choices?.find((c) => c.code === a.code)?.label ?? a.code) : a.kind === "number" ? String(a.value) : a.kind === "text" ? "their own words" : a.reason.replace("_", " ");
    out.push({ slot: e.slot ?? "", question: row ?? item?.text ?? e.slot ?? "", said: heard?.type === "heard" ? heard.text : "", readAs, by: e.classification.by, confidence: e.classification.confidence, decision: decision?.type === "decision" ? decision.detail : "" });
  }
  return out;
}

