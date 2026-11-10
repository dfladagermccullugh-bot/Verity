/**
 * The spoken script: every line the interviewer may say for a survey, fixed in advance.
 *
 * Lines are of two kinds. "survey" lines are the researcher's own wording, taken verbatim from the
 * survey file. "template" lines are fixed carrier phrases around that wording (how answer options
 * are introduced); they are versioned here and shown to the researcher for sign-off. Nothing else
 * is ever spoken about a question.
 */

import { createHash } from "node:crypto";
import type { Choice, Instrument, Item } from "../instrument/types.js";
import type { Step } from "../engine/flow.js";

/** Bump when any template wording below changes; it is part of the script hash. */
export const TEMPLATE_VERSION = "1";

export type ScriptId = string & { readonly __brand: "ScriptId" };

export interface ScriptLine {
  id: ScriptId;
  role: "statement" | "question" | "options" | "row";
  source: "survey" | "template";
  itemId: string;
  rowCode?: string;
  text: string;
}

export interface Script {
  lines: ScriptLine[];
  templateVersion: string;
  /** SHA-256 over every line id and text plus the template version. Identifies exactly what is spoken. */
  hash: string;
}

function sid(s: string): ScriptId {
  return s as ScriptId;
}

function listAloud(labels: string[]): string {
  if (labels.length === 1) return labels[0]!;
  return `${labels.slice(0, -1).join("; ")}; or ${labels[labels.length - 1]!}`;
}

/** A plain yes/no question is not followed by "the answer options are". */
export function isYesNo(choices: Choice[]): boolean {
  if (choices.length !== 2) return false;
  const labels = choices.map((c) => c.label.trim().toLowerCase()).sort();
  return labels[0] === "no" && labels[1] === "yes";
}

function optionsText(item: Item): string | null {
  const choices = item.choices ?? [];
  if (item.kind === "single") return isYesNo(choices) ? null : `The answer options are: ${listAloud(choices.map((c) => c.label))}.`;
  if (item.kind === "grid") return `For each one, the answer options are: ${listAloud(choices.map((c) => c.label))}.`;
  if (item.kind === "scale") {
    const low = choices[0]!.label;
    const high = choices[choices.length - 1]!.label;
    const ends = item.endLabels ? `, where ${low} means ${item.endLabels.low} and ${high} means ${item.endLabels.high}` : "";
    return `Please answer with a number from ${low} to ${high}${ends}.`;
  }
  return null;
}

export function buildScript(instrument: Instrument): Script {
  const lines: ScriptLine[] = [];
  for (const item of instrument.items) {
    if (item.kind === "statement") {
      lines.push({ id: sid(`q.${item.id}.text`), role: "statement", source: "survey", itemId: item.id, text: item.text });
      continue;
    }
    lines.push({ id: sid(`q.${item.id}.ask`), role: "question", source: "survey", itemId: item.id, text: item.text });
    const options = optionsText(item);
    if (options) lines.push({ id: sid(`q.${item.id}.options`), role: "options", source: "template", itemId: item.id, text: options });
    for (const row of item.rows ?? []) {
      lines.push({ id: sid(`q.${item.id}.row.${row.code}`), role: "row", source: "survey", itemId: item.id, rowCode: row.code, text: row.label });
    }
  }
  const hash = createHash("sha256")
    .update(JSON.stringify({ v: TEMPLATE_VERSION, lines: lines.map((l) => [l.id, l.text]) }))
    .digest("hex");
  return { lines, templateVersion: TEMPLATE_VERSION, hash };
}

/**
 * The lines to say for a step, in order. For a grid, the question and options are said before the
 * first statement only, unless `repeatStem` asks for them again (for example after a dropped call).
 */
export function linesForStep(script: Script, step: Step, opts: { repeatStem?: boolean } = {}): ScriptLine[] {
  if (step.kind === "end") return [];
  const ofItem = script.lines.filter((l) => l.itemId === step.item.id);
  if (step.kind === "statement") return ofItem.filter((l) => l.role === "statement");
  const stem = ofItem.filter((l) => l.role === "question" || l.role === "options");
  if (!step.row) return stem;
  const row = ofItem.filter((l) => l.role === "row" && l.rowCode === step.row!.code);
  const isFirstRow = step.item.rows?.[0]?.code === step.row.code;
  return isFirstRow || opts.repeatStem ? [...stem, ...row] : row;
}
