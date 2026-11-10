/** Phone-readiness report for a survey, as markdown a researcher can read. */

import type { Condition, Finding, Instrument, Item } from "../instrument/types.js";
import type { ReadResult } from "../qualtrics/qsf.js";
import { VERITY_FIELDS } from "../qualtrics/csv.js";
import { buildScript } from "../script/script.js";

const KIND_LABEL: Record<Item["kind"], string> = {
  statement: "Read-only text",
  single: "Single choice",
  scale: "Number scale",
  number: "Number",
  text: "Open answer",
  grid: "Grid (one statement at a time)",
};

function choiceLabel(instrument: Instrument, itemId: string, code: string): string {
  return instrument.items.find((i) => i.id === itemId)?.choices?.find((c) => c.code === code)?.label ?? code;
}

export function describeCondition(instrument: Instrument, c: Condition): string {
  if ("terms" in c) return c.terms.map((t) => describeCondition(instrument, t)).join(c.op === "and" ? " and " : " or ");
  if ("choiceCode" in c) {
    const item = instrument.items.find((i) => i.id === c.itemId);
    const row = c.rowCode === undefined ? "" : ` (${item?.rows?.find((r) => r.code === c.rowCode)?.label ?? c.rowCode})`;
    return `${c.itemId}${row} ${c.op === "selected" ? "is" : "is not"} "${choiceLabel(instrument, c.itemId, c.choiceCode)}"`;
  }
  const words = { eq: "equals", ne: "does not equal", gt: "is more than", ge: "is at least", lt: "is less than", le: "is at most" } as const;
  return `${c.itemId} ${words[c.op]} ${c.value}`;
}

function describeSkips(instrument: Instrument, item: Item): string {
  return (item.skips ?? [])
    .map((s) => {
      const to = s.to.kind === "endOfSurvey" ? "end the survey" : s.to.kind === "endOfBlock" ? "skip the rest of this section" : `skip to ${s.to.itemId}`;
      return `If ${describeCondition(instrument, s.when)}: ${to}`;
    })
    .join("; ");
}

function cell(s: string): string {
  return s.replace(/\|/g, "\\|").replace(/\s+/g, " ");
}

function findingLines(findings: Finding[]): string[] {
  return findings.map((f) => `- ${f.itemId ? `**${f.itemId}:** ` : ""}${f.message}`);
}

export function renderReadinessReport(result: ReadResult, sourceName: string): string {
  const blockers = result.findings.filter((f) => f.severity === "blocker");
  const warnings = result.findings.filter((f) => f.severity === "warning");
  const out: string[] = [];
  const title = result.surveyName || sourceName;
  out.push(`# Phone-readiness report: ${title}`, "");

  if (!result.instrument) {
    out.push(`**Verdict: NOT READY.** ${blockers.length} thing${blockers.length === 1 ? "" : "s"} must change before this survey can be run by voice.`, "");
    out.push("## Must change", "", ...findingLines(blockers), "");
    if (warnings.length > 0) out.push("## Worth reviewing", "", ...findingLines(warnings), "");
    out.push("Nothing is run on a guess: a survey with any item above is refused in full.", "");
    return out.join("\n");
  }

  const instrument = result.instrument;
  const script = buildScript(instrument);
  out.push(`**Verdict: READY.** ${warnings.length === 0 ? "No concerns found." : `${warnings.length} point${warnings.length === 1 ? "" : "s"} worth reviewing.`}`, "");
  if (warnings.length > 0) out.push("## Worth reviewing", "", ...findingLines(warnings), "", "These are suggestions. Wording is only ever changed by you, in the survey platform.", "");

  out.push("## What will be asked", "", "| # | ID | Type | Asked when | After answering |", "|---|---|---|---|---|");
  instrument.items.forEach((item, i) => {
    out.push(`| ${i + 1} | ${item.id} | ${KIND_LABEL[item.kind]} | ${cell(item.displayIf ? describeCondition(instrument, item.displayIf) : "Always")} | ${cell(describeSkips(instrument, item) || "Continue")} |`);
  });
  out.push("");

  out.push(`## Spoken script`, "", `Script version \`${script.hash.slice(0, 12)}\`. Every word the interviewer says about a question is listed here.`, "Lines marked *standard wording* are fixed phrases that introduce the answer options; all other lines are your wording, unchanged.", "");
  let n = 0;
  for (const item of instrument.items) {
    out.push(`**${item.id}**`, "");
    for (const line of script.lines.filter((l) => l.itemId === item.id)) {
      n += 1;
      out.push(`${n}. ${line.text}${line.source === "template" ? " *(standard wording)*" : ""}`);
    }
    out.push("");
  }

  const missing = VERITY_FIELDS.filter((f) => !instrument.embeddedFields.includes(f));
  out.push("## Response file", "");
  if (missing.length === 0) out.push("The survey declares every embedded-data field used to label voice responses.", "");
  else out.push(`To label each response with its mode and call outcome, add these embedded-data fields in the survey flow: ${missing.map((f) => `\`${f}\``).join(", ")}. Without them the answers still import, unlabelled.`, "");
  return out.join("\n");
}
