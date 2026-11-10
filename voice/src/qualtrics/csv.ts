/**
 * Writer for a Qualtrics response import file.
 *
 * Layout follows Qualtrics' own CSV export: three header rows (column name, description, and an
 * ImportId that ties the column to a question), then one row per response, with numeric values.
 * Checked against the header rows of real exports; a live import has not yet been run.
 */

import type { Answer, Instrument } from "../instrument/types.js";
import { slotKey } from "../instrument/types.js";
import type { InterviewState } from "../engine/flow.js";
import { slotsOf } from "../engine/flow.js";

/** Embedded-data fields the survey should declare so each response carries its voice metadata. */
export const VERITY_FIELDS = ["vv_mode", "vv_case_id", "vv_outcome", "vv_script"] as const;

export interface InterviewRecord {
  caseId: string;
  startedAt: Date;
  endedAt: Date;
  /** True when the interview reached the end of the survey. */
  finished: boolean;
  state: InterviewState;
  /** Values for embedded-data fields. Only fields the survey declares are written. */
  embedded?: Record<string, string>;
}

interface Column {
  name: string;
  description: string;
  importId: string;
  value: (r: InterviewRecord) => string;
}

function csvCell(s: string): string {
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function utcStamp(d: Date): string {
  return d.toISOString().slice(0, 19).replace("T", " ");
}

function answerValue(instrument: Instrument, itemId: string, a: Answer | undefined): string {
  if (!a || a.kind === "nonresponse") return "";
  if (a.kind === "number") return String(a.value);
  if (a.kind === "text") return a.value;
  const item = instrument.items.find((i) => i.id === itemId);
  return item?.choices?.find((c) => c.code === a.code)?.exportValue ?? "";
}

function totalSlots(instrument: Instrument): number {
  return instrument.items.reduce((n, i) => n + slotsOf(i).length, 0);
}

export function responseColumns(instrument: Instrument): Column[] {
  const total = totalSlots(instrument);
  const cols: Column[] = [
    { name: "StartDate", description: "Start Date", importId: "startDate", value: (r) => utcStamp(r.startedAt) },
    { name: "EndDate", description: "End Date", importId: "endDate", value: (r) => utcStamp(r.endedAt) },
    { name: "Status", description: "Response Type", importId: "status", value: () => "0" },
    {
      name: "Progress",
      description: "Progress",
      importId: "progress",
      value: (r) => (r.finished ? "100" : String(total === 0 ? 0 : Math.floor((100 * Object.keys(r.state.answers).length) / total))),
    },
    {
      name: "Duration (in seconds)",
      description: "Duration (in seconds)",
      importId: "duration",
      value: (r) => String(Math.max(0, Math.round((r.endedAt.getTime() - r.startedAt.getTime()) / 1000))),
    },
    { name: "Finished", description: "Finished", importId: "finished", value: (r) => (r.finished ? "1" : "0") },
  ];
  for (const item of instrument.items) {
    if (item.kind === "statement") continue;
    if (item.kind === "grid") {
      for (const row of item.rows ?? []) {
        cols.push({
          name: `${item.exportTag}_${row.exportSuffix}`,
          description: `${item.text} - ${row.label}`,
          importId: `${item.id}_${row.code}`,
          value: (r) => answerValue(instrument, item.id, r.state.answers[slotKey(item.id, row.code)]),
        });
      }
      continue;
    }
    const typed = item.kind === "number" || item.kind === "text";
    cols.push({
      name: item.exportTag,
      description: item.text,
      importId: typed ? `${item.id}_TEXT` : item.id,
      value: (r) => answerValue(instrument, item.id, r.state.answers[slotKey(item.id)]),
    });
  }
  for (const field of instrument.embeddedFields) {
    cols.push({ name: field, description: field, importId: field, value: (r) => r.embedded?.[field] ?? "" });
  }
  return cols;
}

export function writeResponsesCsv(instrument: Instrument, records: InterviewRecord[]): string {
  const cols = responseColumns(instrument);
  const rows = [
    cols.map((c) => c.name),
    cols.map((c) => c.description),
    cols.map((c) => JSON.stringify({ ImportId: c.importId })),
    ...records.map((r) => cols.map((c) => c.value(r))),
  ];
  return rows.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
