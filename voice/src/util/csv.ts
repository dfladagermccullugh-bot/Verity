/** Minimal RFC 4180 CSV reading and writing. */

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  let started = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
      continue;
    }
    if (ch === '"') {
      quoted = true;
      started = true;
    } else if (ch === ",") {
      row.push(cell);
      cell = "";
      started = true;
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      if (started || cell !== "") {
        row.push(cell);
        rows.push(row);
      }
      row = [];
      cell = "";
      started = false;
    } else cell += ch;
  }
  if (started || cell !== "") {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

export function csvCell(s: string): string {
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function writeCsv(rows: string[][]): string {
  return rows.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

/** Rows as objects keyed by the header row (trimmed, lower-cased). */
export function parseCsvObjects(text: string): Record<string, string>[] {
  const [header, ...rows] = parseCsv(text);
  if (!header) return [];
  const keys = header.map((h) => h.trim().toLowerCase());
  return rows.map((r) => Object.fromEntries(keys.map((k, i) => [k, (r[i] ?? "").trim()])));
}
