/**
 * Platform-neutral questionnaire model. A survey platform adapter (Qualtrics first) turns its own
 * file format into an `Instrument`; the interviewer, flow engine and script builder only know this.
 */

export type ItemKind = "statement" | "single" | "scale" | "number" | "text" | "grid";

export interface Choice {
  /** The platform's own choice id (Qualtrics: key in `Choices`). */
  code: string;
  /** Wording as written by the researcher, as plain text. Read verbatim. */
  label: string;
  /** Value written to the response export (Qualtrics: recode value, else the choice id). */
  exportValue: string;
}

export interface GridRow {
  code: string;
  /** Statement text, read verbatim. */
  label: string;
  /** Column suffix in the response export. */
  exportSuffix: string;
}

/** A condition on earlier answers. Unanswered or nonresponse counts as "not selected". */
export type Condition =
  | { op: "and" | "or"; terms: Condition[] }
  | { op: "selected" | "notSelected"; itemId: string; rowCode?: string; choiceCode: string }
  | { op: "eq" | "ne" | "gt" | "ge" | "lt" | "le"; itemId: string; value: number };

export type SkipTarget = { kind: "endOfSurvey" } | { kind: "endOfBlock" } | { kind: "item"; itemId: string };

export interface SkipRule {
  when: Condition;
  to: SkipTarget;
}

export interface Item {
  /** Platform question id (Qualtrics: QID). */
  id: string;
  /** Column name in the response export (Qualtrics: DataExportTag). */
  exportTag: string;
  kind: ItemKind;
  blockId: string;
  /** Question wording as plain text. Read verbatim. */
  text: string;
  /** single, scale, grid (the grid's answer scale). */
  choices?: Choice[];
  /** grid only. */
  rows?: GridRow[];
  /** scale only: wording attached to the lowest and highest point, when the survey defines it. */
  endLabels?: { low: string; high: string };
  /** number only. */
  number?: { min?: number; max?: number; integer: boolean };
  displayIf?: Condition;
  skips?: SkipRule[];
}

export interface Instrument {
  platform: "qualtrics";
  surveyId: string;
  name: string;
  /** Items in the order they are asked. */
  items: Item[];
  /** Extra per-response fields the survey declares (Qualtrics: embedded data). */
  embeddedFields: string[];
}

/** One thing the interviewer asks for: an item, or one row of a grid. */
export interface Slot {
  key: string;
  itemId: string;
  rowCode?: string;
}

export function slotKey(itemId: string, rowCode?: string): string {
  return rowCode === undefined ? itemId : `${itemId}#${rowCode}`;
}

export type NonresponseReason = "dont_know" | "refused" | "no_answer";

export type Answer =
  | { kind: "choice"; code: string }
  | { kind: "number"; value: number }
  | { kind: "text"; value: string }
  | { kind: "nonresponse"; reason: NonresponseReason };

export type Severity = "blocker" | "warning" | "info";

/** Something the reader noticed about a survey. A blocker means the survey cannot be run by voice. */
export interface Finding {
  severity: Severity;
  code: string;
  message: string;
  itemId?: string;
}
