/**
 * Reader for Qualtrics survey files (.qsf).
 *
 * The QSF format is JSON but has no published schema. This reader accepts a declared subset and
 * refuses everything else with a plain reason (a "blocker"), so a survey is never run by voice on
 * a guess. Shapes were taken from real exports; anything unrecognised is treated as unsupported.
 */

import type { Choice, Condition, Finding, GridRow, Instrument, Item, SkipRule, SkipTarget } from "../instrument/types.js";
import { findPipes, hasUnspeakableMarkup, htmlToText } from "../instrument/text.js";
import { lintItem } from "./lint.js";

export interface ReadResult {
  /** Null when any blocker was found. */
  instrument: Instrument | null;
  findings: Finding[];
  /** The survey's name, when the file could be read at all. */
  surveyName?: string;
}

type Json = Record<string, unknown>;

function isObj(v: unknown): v is Json {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function str(v: unknown): string {
  return typeof v === "string" ? v : typeof v === "number" ? String(v) : "";
}

/** QSF lists appear either as arrays or as objects with numeric keys. */
function listOf(v: unknown): unknown[] {
  if (Array.isArray(v)) return v;
  if (isObj(v)) {
    return Object.keys(v)
      .filter((k) => /^\d+$/.test(k))
      .sort((a, b) => Number(a) - Number(b))
      .map((k) => v[k]);
  }
  return [];
}

const SINGLE_SELECTORS = new Set(["SAVR", "SAHR", "SACOL", "DL"]);
const MULTI_SELECTORS = new Set(["MAVR", "MAHR", "MACOL", "MSB"]);
const TEXT_SELECTORS = new Set(["SL", "ML", "ESTB"]);
/** Question types that record something about the web page rather than asking anything. */
const NOT_ASKED_TYPES = new Set(["Timing", "Meta"]);

const NUMERIC_OPERATORS: Record<string, "eq" | "ne" | "gt" | "ge" | "lt" | "le"> = {
  EqualTo: "eq",
  NotEqualTo: "ne",
  GreaterThan: "gt",
  GreaterThanOrEqual: "ge",
  LessThan: "lt",
  LessThanOrEqual: "le",
};

class Refusal extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

function parseLocator(locator: string): { itemId: string; parts: string[] } | null {
  const m = /^q:\/\/(QID\d+)\/(.+)$/.exec(locator);
  if (!m) return null;
  return { itemId: m[1]!, parts: m[2]!.split("/") };
}

function selectionCondition(op: "selected" | "notSelected", locator: string): Condition {
  const loc = parseLocator(locator);
  if (!loc || loc.parts[0] !== "SelectableChoice") {
    throw new Refusal("unsupported_logic", `Logic refers to "${locator}", which is not a selectable answer.`);
  }
  if (loc.parts.length === 2) return { op, itemId: loc.itemId, choiceCode: loc.parts[1]! };
  if (loc.parts.length === 3) return { op, itemId: loc.itemId, rowCode: loc.parts[1]!, choiceCode: loc.parts[2]! };
  throw new Refusal("unsupported_logic", `Logic refers to "${locator}", which is not understood.`);
}

function parseExpression(e: Json): Condition {
  if (str(e.LogicType) !== "Question") {
    throw new Refusal("unsupported_logic", `Logic based on "${str(e.LogicType) || "unknown"}" is not supported; only logic on earlier answers is.`);
  }
  const operator = str(e.Operator);
  const left = str(e.LeftOperand) || str(e.ChoiceLocator);
  if (operator === "Selected") return selectionCondition("selected", left);
  if (operator === "NotSelected") return selectionCondition("notSelected", left);
  const numeric = NUMERIC_OPERATORS[operator];
  if (numeric) {
    const loc = parseLocator(left);
    const value = Number(str(e.RightOperand));
    if (!loc || loc.parts[0] !== "ChoiceTextEntryValue" || loc.parts.length !== 1 || str(e.RightOperand).trim() === "" || !Number.isFinite(value)) {
      throw new Refusal("unsupported_logic", `A "${operator}" comparison is only supported on a number question against a fixed number.`);
    }
    return { op: numeric, itemId: loc.itemId, value };
  }
  throw new Refusal("unsupported_logic", `The logic operator "${operator || "unknown"}" is not supported.`);
}

/** Qualtrics "BooleanExpression": groups of expressions joined by And / Or. */
function parseBoolean(logic: unknown): Condition {
  if (!isObj(logic) || str(logic.Type) !== "BooleanExpression") {
    throw new Refusal("unsupported_logic", "Logic is in a form that is not understood.");
  }
  if (logic.inPage === true) throw new Refusal("unsupported_logic", "In-page display logic is not supported.");
  const groups = listOf(logic);
  if (groups.length !== 1) throw new Refusal("unsupported_logic", "Logic with more than one condition set is not supported.");
  const expressions = listOf(groups[0]).filter(isObj);
  if (expressions.length === 0) throw new Refusal("unsupported_logic", "Logic has no conditions.");
  const terms = expressions.map(parseExpression);
  if (terms.length === 1) return terms[0]!;
  // The misspelling "Conjuction" is Qualtrics' own.
  const joins = new Set(expressions.slice(1).map((e) => (str(e.Conjuction) || str(e.Conjunction)).toLowerCase()));
  if (joins.size !== 1 || !(joins.has("and") || joins.has("or"))) {
    throw new Refusal("unsupported_logic", "Logic that mixes And with Or is not supported.");
  }
  return { op: joins.has("and") ? "and" : "or", terms };
}

function parseSkip(entry: Json): SkipRule {
  const condition = str(entry.Condition);
  if (condition !== "Selected" && condition !== "NotSelected") {
    throw new Refusal("unsupported_logic", `Skip logic on "${condition || "unknown"}" is not supported.`);
  }
  const when = selectionCondition(condition === "Selected" ? "selected" : "notSelected", str(entry.ChoiceLocator) || str(entry.Locator));
  const dest = str(entry.SkipToDestination);
  let to: SkipTarget;
  if (dest === "ENDOFSURVEY") to = { kind: "endOfSurvey" };
  else if (dest === "ENDOFBLOCK") to = { kind: "endOfBlock" };
  else if (/^QID\d+$/.test(dest)) to = { kind: "item", itemId: dest };
  else throw new Refusal("unsupported_logic", `Skip destination "${dest || "unknown"}" is not understood.`);
  return { when, to };
}

/**
 * A QSF map from code to value. When the codes run 0, 1, 2, … Qualtrics writes the map as a plain
 * list (seen in a genuine export: the options of a 0-to-10 recommend question), so a list is read
 * as a map keyed by position.
 */
function mapOf(v: unknown): Json | null {
  if (Array.isArray(v)) return Object.fromEntries(v.map((x, i) => [String(i), x]));
  return isObj(v) ? v : null;
}

function orderedChoices(choicesIn: unknown, order: unknown, recodesIn: unknown): Choice[] {
  const choices = mapOf(choicesIn);
  const recodes = mapOf(recodesIn);
  if (!choices) return [];
  const codes = Array.isArray(order) && order.length > 0 ? order.map(str) : Object.keys(choices);
  const out: Choice[] = [];
  for (const code of codes) {
    const c = choices[code];
    if (!isObj(c)) continue;
    const recode = recodes ? str(recodes[code]) : "";
    out.push({ code, label: htmlToText(str(c.Display)), exportValue: recode !== "" ? recode : code });
  }
  return out;
}

function choicesHave(choicesIn: unknown, key: string): boolean {
  const choices = mapOf(choicesIn);
  return choices !== null && Object.values(choices).some((c) => isObj(c) && c[key] !== undefined && c[key] !== false && c[key] !== "false");
}

/** Returns the item, or null when the question is deliberately left out (with a finding). */
function readQuestion(p: Json, blockId: string, findings: Finding[]): Item | null {
  const id = str(p.QuestionID);
  const type = str(p.QuestionType);
  const selector = str(p.Selector);
  const sub = str(p.SubSelector);
  const rawText = str(p.QuestionText);

  if (NOT_ASKED_TYPES.has(type)) {
    findings.push({ severity: "warning", code: "not_asked", itemId: id, message: `${type} question: records web-page data, so it is left out of a voice interview.` });
    return null;
  }
  if (hasUnspeakableMarkup(rawText)) throw new Refusal("visual_content", "The question contains an image, table or other visual content that cannot be read aloud.");
  if (findPipes(rawText).length > 0) throw new Refusal("piped_text", "The question inserts text from elsewhere (piped text), which is not supported yet.");
  if (str(p.QuestionJS).trim() !== "") throw new Refusal("custom_script", "The question runs custom JavaScript.");
  if (isObj(p.Randomization) && str(p.Randomization.Type) !== "" && str(p.Randomization.Type) !== "None") {
    throw new Refusal("randomized_choices", "Answer options are randomized, which is not supported yet.");
  }
  if (p.DynamicChoices !== undefined || p.DynamicAnswers !== undefined) throw new Refusal("carry_forward", "Answer options are carried forward from another question.");
  for (const key of ["Choices", "Answers"] as const) {
    if (choicesHave(p[key], "TextEntry")) throw new Refusal("choice_text_entry", 'An answer option asks for typed text (for example "Other, please specify").');
    if (choicesHave(p[key], "DisplayLogic")) throw new Refusal("choice_display_logic", "Individual answer options have their own display logic.");
  }

  const text = htmlToText(rawText);
  if (text === "") throw new Refusal("empty_question", "The question has no text.");
  const base = { id, exportTag: str(p.DataExportTag) || id, blockId, text };
  let item: Item;

  if (type === "DB") {
    if (selector !== "TB") throw new Refusal("visual_content", "A graphic block cannot be read aloud.");
    item = { ...base, kind: "statement" };
  } else if (type === "MC") {
    if (MULTI_SELECTORS.has(selector) || sub === "MultipleAnswer") throw new Refusal("multi_select", "Select-all-that-apply questions are not supported yet.");
    const choices = orderedChoices(p.Choices, p.ChoiceOrder, p.RecodeValues);
    if (selector === "NPS") {
      const points = choices.map((c) => ({ ...c, exportValue: /^\d+$/.test(c.label) && c.exportValue === c.code ? c.label : c.exportValue }));
      const labels = listOf(p.ColumnLabels).map((l) => (isObj(l) ? htmlToText(str(l.Display)) : ""));
      item = { ...base, kind: "scale", choices: points };
      if (labels.length >= 2 && labels[0] && labels[labels.length - 1]) item.endLabels = { low: labels[0], high: labels[labels.length - 1]! };
    } else if (SINGLE_SELECTORS.has(selector)) {
      item = { ...base, kind: "single", choices };
    } else {
      throw new Refusal("unsupported_type", `Multiple-choice format "${selector || "unknown"}" is not supported.`);
    }
    if (choices.length < 2) throw new Refusal("too_few_choices", "The question has fewer than two answer options.");
  } else if (type === "TE") {
    if (!TEXT_SELECTORS.has(selector)) throw new Refusal("unsupported_type", `Text-entry format "${selector || "unknown"}" is not supported.`);
    const settings = isObj(p.Validation) && isObj(p.Validation.Settings) ? p.Validation.Settings : {};
    if (str(settings.ContentType) === "ValidNumber") {
      const vn = isObj(settings.ValidNumber) ? settings.ValidNumber : {};
      const min = str(vn.Min).trim();
      const max = str(vn.Max).trim();
      item = { ...base, kind: "number", number: { integer: str(vn.NumDecimals).trim() === "0" } };
      if (min !== "" && Number.isFinite(Number(min))) item.number!.min = Number(min);
      if (max !== "" && Number.isFinite(Number(max))) item.number!.max = Number(max);
    } else if (str(settings.Type) === "ContentType" && str(settings.ContentType) !== "") {
      throw new Refusal("unsupported_validation", `Answers must match the format "${str(settings.ContentType)}", which cannot be checked by voice yet.`);
    } else {
      item = { ...base, kind: "text" };
    }
  } else if (type === "Matrix") {
    if (selector !== "Likert" || sub !== "SingleAnswer") throw new Refusal("unsupported_type", "Only single-answer Likert grids are supported.");
    const scale = orderedChoices(p.Answers, p.AnswerOrder, p.RecodeValues);
    const statements = orderedChoices(p.Choices, p.ChoiceOrder, undefined);
    if (scale.length < 2 || statements.length < 1) throw new Refusal("too_few_choices", "The grid needs at least one statement and two scale points.");
    const tags = mapOf(p.ChoiceDataExportTags) ?? {};
    const rows: GridRow[] = statements.map((s) => ({ code: s.code, label: s.label, exportSuffix: str(tags[s.code]) || s.code }));
    item = { ...base, kind: "grid", choices: scale, rows };
  } else {
    throw new Refusal("unsupported_type", `Question type "${type || "unknown"}" is not supported.`);
  }

  for (const c of [...(item.choices ?? []), ...(item.rows ?? [])]) {
    if (c.label === "") throw new Refusal("empty_choice", "An answer option or statement has no text.");
  }
  if (p.DisplayLogic !== undefined) item.displayIf = parseBoolean(p.DisplayLogic);
  const skips = listOf(p.SkipLogic).filter(isObj).map(parseSkip);
  if (skips.length > 0) item.skips = skips;

  const settings = isObj(p.Validation) && isObj(p.Validation.Settings) ? p.Validation.Settings : {};
  if (str(settings.ForceResponse) === "ON" && item.kind !== "statement") {
    findings.push({ severity: "warning", code: "forced_response", itemId: id, message: "The web survey forces an answer here. By voice, a respondent may still decline; that is recorded as no answer." });
  }
  return item;
}

type LeafCondition = Exclude<Condition, { op: "and" | "or" }>;

function conditionRefs(c: Condition): LeafCondition[] {
  return "terms" in c ? c.terms.flatMap(conditionRefs) : [c];
}

/** Check that logic only looks backwards and names real answers. */
function validateLogic(items: Item[], findings: Finding[]): void {
  const index = new Map(items.map((it, i) => [it.id, i] as const));
  const block = (msg: string, code: string, itemId: string) => findings.push({ severity: "blocker", code, itemId, message: msg });

  const checkRef = (owner: Item, ownerIdx: number, ref: LeafCondition, allowSelf: boolean) => {
    const targetIdx = index.get(ref.itemId);
    if (targetIdx === undefined) return block(`Logic refers to ${ref.itemId}, which is not asked in this survey.`, "logic_unknown_question", owner.id);
    if (targetIdx > ownerIdx || (targetIdx === ownerIdx && !allowSelf)) return block(`Logic refers to ${ref.itemId}, which is asked later.`, "logic_forward_reference", owner.id);
    const target = items[targetIdx]!;
    if (ref.op === "selected" || ref.op === "notSelected") {
      const okKind = ref.rowCode === undefined ? target.kind === "single" || target.kind === "scale" : target.kind === "grid";
      const okRow = ref.rowCode === undefined || (target.rows ?? []).some((r) => r.code === ref.rowCode);
      const okChoice = (target.choices ?? []).some((ch) => ch.code === ref.choiceCode);
      if (!okKind || !okRow || !okChoice) block(`Logic refers to an answer of ${ref.itemId} that does not exist.`, "logic_unknown_answer", owner.id);
    } else if (target.kind !== "number") {
      block(`Logic compares ${ref.itemId} with a number, but it is not a number question.`, "logic_unknown_answer", owner.id);
    }
  };

  items.forEach((item, i) => {
    if (item.displayIf) for (const ref of conditionRefs(item.displayIf)) checkRef(item, i, ref, false);
    for (const skip of item.skips ?? []) {
      for (const ref of conditionRefs(skip.when)) checkRef(item, i, ref, true);
      if (skip.to.kind === "item") {
        const targetIdx = index.get(skip.to.itemId);
        if (targetIdx === undefined || targetIdx <= i || items[targetIdx]!.blockId !== item.blockId) {
          block(`Skip logic jumps to ${skip.to.itemId}, which is not a later question in the same block.`, "skip_bad_destination", item.id);
        }
      }
    }
  });
}

export function readQsf(input: string | unknown): ReadResult {
  const findings: Finding[] = [];
  const fail = (code: string, message: string): ReadResult => ({ instrument: null, findings: [...findings, { severity: "blocker", code, message }] });

  let doc: unknown = input;
  if (typeof input === "string") {
    try {
      doc = JSON.parse(input);
    } catch {
      return fail("not_qsf", "The file is not a Qualtrics survey file (it is not valid JSON).");
    }
  }
  if (!isObj(doc) || !isObj(doc.SurveyEntry) || !Array.isArray(doc.SurveyElements)) {
    return fail("not_qsf", "The file is not a Qualtrics survey file (expected SurveyEntry and SurveyElements).");
  }
  const elements = doc.SurveyElements.filter(isObj);
  const byType = (t: string) => elements.filter((e) => str(e.Element) === t);

  const questions = new Map<string, Json>();
  for (const e of byType("SQ")) if (isObj(e.Payload)) questions.set(str(e.Payload.QuestionID) || str(e.PrimaryAttribute), e.Payload);

  const blocks = new Map<string, Json>();
  for (const e of byType("BL")) for (const b of listOf(e.Payload)) if (isObj(b)) blocks.set(str(b.ID), b);

  const flowEl = byType("FL")[0];
  const flow = flowEl && isObj(flowEl.Payload) ? listOf(flowEl.Payload.Flow).filter(isObj) : [];
  if (flow.length === 0) return fail("not_qsf", "The survey file has no survey flow.");

  const embeddedFields: string[] = [];
  const blockOrder: string[] = [];
  let ended = false;
  for (const node of flow) {
    const type = str(node.Type);
    if (ended) {
      findings.push({ severity: "warning", code: "after_end", message: "Part of the survey flow sits after an End of Survey element and is never reached." });
      break;
    }
    if (type === "Block" || type === "Standard") blockOrder.push(str(node.ID));
    else if (type === "EmbeddedData") {
      for (const f of listOf(node.EmbeddedData)) if (isObj(f) && str(f.Field) !== "" && !embeddedFields.includes(str(f.Field))) embeddedFields.push(str(f.Field));
    } else if (type === "EndSurvey") ended = true;
    else findings.push({ severity: "blocker", code: "flow_element", message: `The survey flow uses "${type || "unknown"}", which is not supported. Only blocks in a fixed order and embedded data are.` });
  }

  const items: Item[] = [];
  for (const blockId of blockOrder) {
    const b = blocks.get(blockId);
    if (!b) {
      findings.push({ severity: "blocker", code: "missing_block", message: `The survey flow names block ${blockId}, which is not in the file.` });
      continue;
    }
    if (str(b.Type) === "Trash") continue;
    const options = isObj(b.Options) ? b.Options : {};
    const randomize = str(options.RandomizeQuestions);
    if (randomize !== "" && randomize !== "false") findings.push({ severity: "blocker", code: "randomized_block", message: `Block "${str(b.Description)}" randomizes its questions, which is not supported yet.` });
    if (str(options.Looping) !== "" && str(options.Looping) !== "None") findings.push({ severity: "blocker", code: "loop_and_merge", message: `Block "${str(b.Description)}" uses loop and merge.` });

    for (const el of listOf(b.BlockElements).filter(isObj)) {
      if (str(el.Type) !== "Question") continue;
      const qid = str(el.QuestionID);
      const p = questions.get(qid);
      if (!p) {
        findings.push({ severity: "blocker", code: "missing_question", itemId: qid, message: `Block "${str(b.Description)}" names ${qid}, which is not in the file.` });
        continue;
      }
      try {
        const item = readQuestion({ ...p, QuestionID: qid }, blockId, findings);
        if (!item) continue;
        // Older exports keep skip logic on the block element rather than the question.
        const blockSkips = listOf(el.SkipLogic).filter(isObj).map(parseSkip);
        if (blockSkips.length > 0) item.skips = [...(item.skips ?? []), ...blockSkips];
        items.push(item);
        findings.push(...lintItem(item));
      } catch (err) {
        if (!(err instanceof Refusal)) throw err;
        findings.push({ severity: "blocker", code: err.code, itemId: qid, message: err.message });
      }
    }
  }

  if (!findings.some((f) => f.severity === "blocker")) validateLogic(items, findings);
  if (items.every((it) => it.kind === "statement") && !findings.some((f) => f.severity === "blocker")) {
    findings.push({ severity: "blocker", code: "no_questions", message: "The survey has no questions that can be asked." });
  }
  const surveyName = str(doc.SurveyEntry.SurveyName);
  if (findings.some((f) => f.severity === "blocker")) return { instrument: null, findings, surveyName };

  return {
    instrument: { platform: "qualtrics", surveyId: str(doc.SurveyEntry.SurveyID), name: surveyName, items, embeddedFields },
    findings,
    surveyName,
  };
}
