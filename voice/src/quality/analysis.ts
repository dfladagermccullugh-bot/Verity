/**
 * Answer-quality signals for any closed-ended survey, computed from the recorded answers alone.
 * Pure functions: nothing here speaks, listens, calls a model or touches storage.
 *
 * It generalises the yes/no analysis of the original Verity app (`src/lib/analysis.ts` at the repo
 * root) to the `Instrument` model: any answer scale, grids, skip logic.
 *
 * The signals are the standard indicators of satisficing: giving an answer that is merely
 * acceptable when a careful one would take effort. Krosnick (1991) lists agreeing with an
 * assertion (acquiescence), failing to differentiate among objects in ratings (non-differentiation,
 * or straightlining when every answer in a battery is identical) and saying "don't know" (one form
 * of item nonresponse) among its forms. Extreme responding (extreme response style) is the habit
 * of choosing the end points of a scale. Every one of these also has innocent explanations, so
 * they are screening signals: a reason to look at an interview, never proof that its data is poor.
 *
 * References, each checked to exist on 10 Nov 2026:
 * - Krosnick, J. A. (1991). Response strategies for coping with the cognitive demands of attitude
 *   measures in surveys. Applied Cognitive Psychology, 5(3), 213-236.
 * - Kim, Dykema, Stevenson, Black & Moberg. Straightlining: Overview of measurement, comparison of
 *   indicators, and effects in mail-web mixed-mode surveys. Social Science Computer Review, 37(2),
 *   214-233 (online 2018). The grid check here is their "simple nondifferentiation".
 * - Greenleaf, E. A. (1992). Measuring extreme response style. Public Opinion Quarterly, 56(3).
 * - Levinson, S. C., & Torreira, F. (2015). Timing in turn-taking and its implications for
 *   processing models of language. Frontiers in Psychology, 6, 731.
 *
 * What the instrument model cannot tell us, and how that limits each signal:
 * - It does not say which statements are worded in the opposite direction. Agreeing with every
 *   statement, or giving one answer down a whole grid, is far stronger evidence when the set mixes
 *   directions; when every statement points the same way it can be a sincere opinion.
 * - It does not say whether a single-choice question's options are ordered. Only number scales,
 *   grids and agree/disagree questions are treated as ordinal unless the caller names more.
 */

import type { Answer, Choice, Instrument, Item, NonresponseReason, Slot } from "../instrument/types.js";
import { slotsOnPath } from "../engine/flow.js";

export interface InterviewRecord {
  id?: string;
  /** Slot key to answer; a grid row's key is `<itemId>#<rowCode>`. */
  answers: Record<string, Answer>;
  /** Slots flagged for human review. */
  review: string[];
  finished: boolean;
  /** Milliseconds from the end of the question audio to the start of the reply, by slot. May be partial. */
  latencyMs?: Record<string, number>;
}

/**
 * A spoken reply that starts sooner than this after the question audio ends counts as too fast.
 *
 * The 800 ms the original app used for taps does not carry over to speech. In conversation people
 * plan their reply while the other person is still talking: gaps between turns average about
 * 200 ms although producing even one word takes over 600 ms (Levinson & Torreira 2015). A spoken
 * answer 300 ms after the question is therefore ordinary. The same review puts the minimal
 * reaction time for a prepared spoken response at about 200 ms. A reply that starts sooner cannot
 * be a reaction to the end of the audio: the respondent committed before hearing the last words,
 * which in a question read aloud are usually the final answer options. A reply that starts before
 * the audio ends (negative latency) counts as well.
 *
 * It remains a weak signal. Answering early is normal once a scale has been heard several times, as
 * in the later rows of a grid, and the measured value depends on how precisely the speech system
 * detects the start of speech, which has not been measured for this product yet.
 */
export const SPOKEN_TOO_FAST_MS = 200;

/** A grid needs this many rows before identical answers on all of them count as straightlining. */
export const STRAIGHTLINE_MIN_ROWS = 3;

/** Extreme responding is only counted on scales with at least this many points. */
export const EXTREME_MIN_POINTS = 4;

export interface QualityOptions {
  /**
   * An interview is flagged when at least this share of its agree/disagree answers are on the agree
   * side. There is no standard cut-off in the literature; 0.8 over at least 5 answers is carried
   * over from the original Verity analysis as a screening level.
   */
  acquiescenceShare: number;
  /** Fewer agree/disagree answers than this are never flagged: agreeing with all of three statements is common. */
  acquiescenceMinItems: number;
  /** See `SPOKEN_TOO_FAST_MS`. */
  tooFastMs: number;
  /** Single-choice items whose options are ordered, to include in extreme responding. */
  ordinalItemIds: string[];
}

export const DEFAULT_QUALITY_OPTIONS: QualityOptions = { acquiescenceShare: 0.8, acquiescenceMinItems: 5, tooFastMs: SPOKEN_TOO_FAST_MS, ordinalItemIds: [] };

/** Questions asked and how many got no substantive answer. A grid row counts as one question. */
export interface NonresponseCounts {
  asked: number;
  dontKnow: number;
  refused: number;
  /** No usable answer after probing. */
  noAnswer: number;
  total: number;
  /** total / asked; null when nothing was asked. */
  rate: number | null;
}

export interface LatencyStats {
  /** Answers with a recorded latency. */
  n: number;
  medianMs: number | null;
  meanMs: number | null;
  /** Answers that began sooner than `tooFastMs`. */
  tooFast: number;
}

export interface InterviewQuality {
  id: string | null;
  finished: boolean;
  nonresponse: NonresponseCounts;
  /** Grids with at least 3 rows, every row answered on the scale. Others cannot be judged and are left out. */
  grids: { itemId: string; rows: number; straightlined: boolean }[];
  /** Longest run of the same answer over consecutive questions that share one answer scale. */
  longestRun: { length: number; slots: string[] };
  /** Answers on agree/disagree scales, and how many were on the agree side. */
  acquiescence: { items: number; agree: number; share: number | null; flagged: boolean };
  /** Answers on ordinal scales of 4 or more points, and how many were the first or last point. */
  extreme: { items: number; extreme: number; share: number | null };
  latency: LatencyStats;
  /** Unfinished interviews only. */
  breakoff: {
    /** Last question answered; null when it stopped before the first answer. */
    lastAnswered: string | null;
    /** The question that was due when it stopped. */
    stoppedAt: string | null;
    answered: number;
    /** Length of the applicable path; see `applicableSlots`. */
    applicable: number;
    progress: number | null;
  } | null;
  /** Asked questions flagged for human review. */
  review: { flagged: number; share: number | null };
}

export interface ItemQuality {
  itemId: string;
  exportTag: string;
  nonresponse: NonresponseCounts;
  latency: LatencyStats;
}

export interface QualitySummary {
  interviews: number;
  finished: number;
  nonresponse: NonresponseCounts;
  /** Every question in the instrument, in order, including ones nobody was asked. */
  items: ItemQuality[];
  /** Judgeable grids over all interviews, and how many were straightlined. */
  straightlining: { grids: number; straightlined: number; share: number | null };
  /** The longest run in any interview. */
  longestRun: number;
  /** `eligible`: interviews with enough agree/disagree answers to be judged. `share` pools all answers. */
  acquiescence: { eligible: number; flagged: number; items: number; agree: number; share: number | null };
  extreme: { items: number; extreme: number; share: number | null };
  latency: LatencyStats;
  /** Unfinished interviews: how far they got on average, and the last question answered (null: none). */
  breakoffs: { count: number; meanProgress: number | null; after: { itemId: string | null; count: number }[] };
  review: { flagged: number; share: number | null };
}

export interface QualityReport {
  options: QualityOptions;
  interviews: InterviewQuality[];
  summary: QualitySummary;
}

const share = (n: number, d: number): number | null => (d === 0 ? null : n / d);

const mean = (xs: number[]): number | null => (xs.length === 0 ? null : xs.reduce((a, b) => a + b, 0) / xs.length);

function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[mid - 1]! + s[mid]!) / 2 : s[mid]!;
}

type Special = "dont_know" | "refused" | "not_applicable";

const SPECIAL = new Map<string, Special>([
  ["dont know", "dont_know"],
  ["do not know", "dont_know"],
  ["i dont know", "dont_know"],
  ["not sure", "dont_know"],
  ["unsure", "dont_know"],
  ["no opinion", "dont_know"],
  ["cant say", "dont_know"],
  ["prefer not to say", "refused"],
  ["prefer not to answer", "refused"],
  ["rather not say", "refused"],
  ["decline to answer", "refused"],
  ["refused", "refused"],
  ["not applicable", "not_applicable"],
  ["does not apply", "not_applicable"],
  ["n a", "not_applicable"],
]);

/**
 * An answer option that is not a point on the scale, such as "Don't know" listed as a choice.
 * Choosing one counts as item nonresponse (not applicable excepted), and it is never an end point.
 * Only these exact wordings are recognised, alone or joined by "/" or "or".
 */
function special(label: string): Special | null {
  const norm = (s: string) => s.toLowerCase().replace(/['’]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
  const whole = SPECIAL.get(norm(label));
  if (whole) return whole;
  const parts = label.split(/\/|\bor\b/i).map((p) => SPECIAL.get(norm(p)));
  return parts.length > 1 && parts.every((p) => p !== undefined) ? parts[0]! : null;
}

/** Side of an agree/disagree label. "Neither agree nor disagree" and unrelated labels are neutral. */
function agreeSide(label: string): "agree" | "disagree" | "neutral" {
  const l = label.toLowerCase();
  if (!l.includes("agree") || /\b(neither|nor)\b/.test(l)) return "neutral";
  return l.includes("disagree") ? "disagree" : "agree";
}

interface Scale {
  /** Substantive options, in order. */
  points: Choice[];
  /** Equal for two items exactly when their substantive options read the same, in the same order. */
  signature: string;
  agree: boolean;
  ordinal: boolean;
}

function scalesOf(instrument: Instrument, opts: QualityOptions): Map<string, Scale> {
  const scales = new Map<string, Scale>();
  for (const item of instrument.items) {
    if (!item.choices) continue;
    const points = item.choices.filter((c) => special(c.label) === null);
    const agree = points.some((p) => agreeSide(p.label) === "agree");
    const ordinal = item.kind === "scale" || item.kind === "grid" || agree || opts.ordinalItemIds.includes(item.id);
    scales.set(item.id, { points, signature: JSON.stringify(points.map((p) => p.label.trim().toLowerCase())), agree, ordinal });
  }
  return scales;
}

/** One question that was asked and got a recorded outcome. */
interface Row {
  slot: Slot;
  item: Item;
  scale: Scale | null;
  /** Why there is no substantive answer; null when there is one. */
  missing: NonresponseReason | null;
  /** Position of the answer on the item's scale, from 0; -1 when it is not a scale point. */
  position: number;
  latencyMs: number | null;
  flagged: boolean;
}

/**
 * The questions actually asked, in order. `slotsOnPath` follows the survey logic, so a question
 * hidden or skipped for this respondent is never counted as missing. The question that was due
 * when an interview stopped is returned separately: it has no outcome to count.
 */
function rowsOf(instrument: Instrument, interview: InterviewRecord, scales: Map<string, Scale>): { rows: Row[]; pending: Slot | null } {
  const items = new Map(instrument.items.map((i) => [i.id, i]));
  const path = slotsOnPath(instrument, { answers: interview.answers, heard: [] });
  const tail = path.at(-1);
  const pending = tail && interview.answers[tail.key] === undefined ? tail : null;
  const rows = (pending ? path.slice(0, -1) : path).map((slot): Row => {
    const item = items.get(slot.itemId)!;
    const answer = interview.answers[slot.key]!;
    const scale = scales.get(item.id) ?? null;
    let missing: NonresponseReason | null = null;
    let position = -1;
    if (answer.kind === "nonresponse") missing = answer.reason;
    else if (answer.kind === "choice" && scale) {
      const label = item.choices?.find((c) => c.code === answer.code)?.label;
      const sp = label === undefined ? null : special(label);
      if (sp === "dont_know" || sp === "refused") missing = sp;
      position = scale.points.findIndex((p) => p.code === answer.code);
    }
    const ms = interview.latencyMs?.[slot.key];
    return { slot, item, scale, missing, position, latencyMs: typeof ms === "number" && Number.isFinite(ms) ? ms : null, flagged: interview.review.includes(slot.key) };
  });
  return { rows, pending };
}

const NO_ANSWER: Answer = { kind: "nonresponse", reason: "no_answer" };

/**
 * The questions that apply to this respondent, including those not reached yet. For the part not
 * reached, the path is the one the survey logic takes if no later question gets a substantive
 * answer. It is an estimate: a later answer could have opened or closed a branch.
 */
export function applicableSlots(instrument: Instrument, answers: Record<string, Answer>): Slot[] {
  const filled = { ...answers };
  for (;;) {
    const path = slotsOnPath(instrument, { answers: filled, heard: [] });
    const tail = path.at(-1);
    if (!tail || filled[tail.key] !== undefined) return path;
    filled[tail.key] = NO_ANSWER;
  }
}

/**
 * Share of applicable questions completed, for AAPOR's complete / partial / break-off rule (see
 * `dispositions.ts`). `answered` counts substantive answers only (AAPOR's standard a); `asked`
 * also counts recorded don't-knows and refusals (standard b). Null when no question applies.
 */
export function completionShare(instrument: Instrument, answers: Record<string, Answer>, standard: "answered" | "asked" = "answered"): number | null {
  const path = applicableSlots(instrument, answers);
  const done = path.filter((s) => {
    const a = answers[s.key];
    return a !== undefined && (standard === "asked" || a.kind !== "nonresponse");
  });
  return share(done.length, path.length);
}

function nonresponseOf(rows: Row[]): NonresponseCounts {
  const n = (reason: NonresponseReason) => rows.filter((r) => r.missing === reason).length;
  const counts = { dontKnow: n("dont_know"), refused: n("refused"), noAnswer: n("no_answer") };
  const total = counts.dontKnow + counts.refused + counts.noAnswer;
  return { asked: rows.length, ...counts, total, rate: share(total, rows.length) };
}

function latencyOf(rows: Row[], tooFastMs: number): LatencyStats {
  const xs = rows.flatMap((r) => (r.latencyMs === null ? [] : [r.latencyMs]));
  return { n: xs.length, medianMs: median(xs), meanMs: mean(xs), tooFast: xs.filter((x) => x < tooFastMs).length };
}

const onAgreeScale = (r: Row) => r.position >= 0 && r.scale !== null && r.scale.agree;
const saidAgree = (r: Row) => agreeSide(r.scale?.points[r.position]?.label ?? "") === "agree";
const onOrdinalScale = (r: Row) => r.position >= 0 && r.scale !== null && r.scale.ordinal && r.scale.points.length >= EXTREME_MIN_POINTS;
const atEndPoint = (r: Row) => r.position === 0 || r.position === (r.scale?.points.length ?? 0) - 1;

function qualityOf(instrument: Instrument, interview: InterviewRecord, rows: Row[], pending: Slot | null, opts: QualityOptions): InterviewQuality {
  const grids = instrument.items.flatMap((item) => {
    const size = item.rows?.length ?? 0;
    if (item.kind !== "grid" || size < STRAIGHTLINE_MIN_ROWS) return [];
    const own = rows.filter((r) => r.item.id === item.id);
    if (own.length !== size || own.some((r) => r.position < 0)) return [];
    return [{ itemId: item.id, rows: size, straightlined: own.every((r) => r.position === own[0]!.position) }];
  });

  // A run continues only while the scale and the answer both repeat. Anything else ends it: another
  // scale, a number or open question, a don't know.
  let run: string[] = [];
  let longest: string[] = [];
  let prev = "";
  for (const r of rows) {
    const key = r.position < 0 || !r.scale ? "" : `${r.scale.signature}@${r.position}`;
    run = key === "" ? [] : key === prev ? [...run, r.slot.key] : [r.slot.key];
    prev = key;
    if (run.length > longest.length) longest = run;
  }

  const agreeItems = rows.filter(onAgreeScale);
  const agree = agreeItems.filter(saidAgree).length;
  const agreeShare = share(agree, agreeItems.length);
  const ordinal = rows.filter(onOrdinalScale);
  const extreme = ordinal.filter(atEndPoint).length;
  const flagged = rows.filter((r) => r.flagged).length;

  let breakoff: InterviewQuality["breakoff"] = null;
  if (!interview.finished) {
    const applicable = applicableSlots(instrument, interview.answers).length;
    breakoff = { lastAnswered: rows.at(-1)?.slot.key ?? null, stoppedAt: pending?.key ?? null, answered: rows.length, applicable, progress: share(rows.length, applicable) };
  }

  return {
    id: interview.id ?? null,
    finished: interview.finished,
    nonresponse: nonresponseOf(rows),
    grids,
    longestRun: { length: longest.length, slots: longest },
    acquiescence: { items: agreeItems.length, agree, share: agreeShare, flagged: agreeItems.length >= opts.acquiescenceMinItems && agreeShare !== null && agreeShare >= opts.acquiescenceShare },
    extreme: { items: ordinal.length, extreme, share: share(extreme, ordinal.length) },
    latency: latencyOf(rows, opts.tooFastMs),
    breakoff,
    review: { flagged, share: share(flagged, rows.length) },
  };
}

/** Quality signals for one interview. */
export function analyzeInterview(instrument: Instrument, interview: InterviewRecord, options: Partial<QualityOptions> = {}): InterviewQuality {
  const opts = { ...DEFAULT_QUALITY_OPTIONS, ...options };
  const { rows, pending } = rowsOf(instrument, interview, scalesOf(instrument, opts));
  return qualityOf(instrument, interview, rows, pending, opts);
}

/** Quality signals for each interview and for the set as a whole. */
export function analyzeQuality(instrument: Instrument, interviews: readonly InterviewRecord[], options: Partial<QualityOptions> = {}): QualityReport {
  const opts = { ...DEFAULT_QUALITY_OPTIONS, ...options };
  const scales = scalesOf(instrument, opts);
  const all: Row[] = [];
  const each = interviews.map((interview) => {
    const { rows, pending } = rowsOf(instrument, interview, scales);
    all.push(...rows);
    return qualityOf(instrument, interview, rows, pending, opts);
  });

  const total = (pick: (q: InterviewQuality) => number) => each.reduce((n, q) => n + pick(q), 0);
  const grids = each.flatMap((q) => q.grids);
  const straightlined = grids.filter((g) => g.straightlined).length;
  const agreeItems = total((q) => q.acquiescence.items);
  const agree = total((q) => q.acquiescence.agree);
  const ordinal = total((q) => q.extreme.items);
  const extreme = total((q) => q.extreme.extreme);
  const flagged = total((q) => q.review.flagged);
  const stopped = each.flatMap((q) => (q.breakoff ? [q.breakoff] : []));
  const lastItem = (key: string | null) => (key === null ? null : key.split("#")[0]!);
  const after = [null, ...instrument.items.map((i) => i.id)]
    .map((itemId) => ({ itemId, count: stopped.filter((b) => lastItem(b.lastAnswered) === itemId).length }))
    .filter((a) => a.count > 0);

  const summary: QualitySummary = {
    interviews: each.length,
    finished: each.filter((q) => q.finished).length,
    nonresponse: nonresponseOf(all),
    items: instrument.items
      .filter((i) => i.kind !== "statement")
      .map((i) => {
        const own = all.filter((r) => r.item.id === i.id);
        return { itemId: i.id, exportTag: i.exportTag, nonresponse: nonresponseOf(own), latency: latencyOf(own, opts.tooFastMs) };
      }),
    straightlining: { grids: grids.length, straightlined, share: share(straightlined, grids.length) },
    longestRun: Math.max(0, ...each.map((q) => q.longestRun.length)),
    acquiescence: {
      eligible: each.filter((q) => q.acquiescence.items >= opts.acquiescenceMinItems).length,
      flagged: each.filter((q) => q.acquiescence.flagged).length,
      items: agreeItems,
      agree,
      share: share(agree, agreeItems),
    },
    extreme: { items: ordinal, extreme, share: share(extreme, ordinal) },
    latency: latencyOf(all, opts.tooFastMs),
    breakoffs: { count: stopped.length, meanProgress: mean(stopped.flatMap((b) => (b.progress === null ? [] : [b.progress]))), after },
    review: { flagged, share: share(flagged, all.length) },
  };
  return { options: opts, interviews: each, summary };
}

const pct = (x: number | null): string => (x === null ? "n/a" : `${Math.round(x * 100)}%`);
const ms = (x: number | null): string => (x === null ? "n/a" : `${Math.round(x)} ms`);
const outOf = (n: number, d: number): string => (d === 0 ? "none to count" : `${n} of ${d} (${pct(n / d)})`);

/** A short report section in plain language: one table of signals, then nonresponse by question. */
export function renderQualityMarkdown(report: QualityReport): string {
  const s = report.summary;
  const o = report.options;
  const nr = s.nonresponse;
  const out: string[] = ["## Answer quality", ""];
  out.push(`Based on ${s.interviews} interview${s.interviews === 1 ? "" : "s"}, ${s.finished} of them finished.`, "");
  out.push("These are screening signals, not proof of poor data: each has ordinary explanations, so a high figure is a reason to look at the interviews, not to discard them.", "");
  out.push("| Signal | Result | How it is counted |", "|---|---|---|");
  out.push(`| Questions asked that got no answer (item nonresponse) | ${outOf(nr.total, nr.asked)} | Don't know ${nr.dontKnow}, declined ${nr.refused}, no usable answer ${nr.noAnswer}. Questions the survey logic skipped are not counted. |`);
  out.push(`| Grids given the same answer on every line (straightlining) | ${outOf(s.straightlining.straightlined, s.straightlining.grids)} | Grids of ${STRAIGHTLINE_MIN_ROWS} or more statements with every statement answered. |`);
  out.push(`| Longest run of one answer | ${s.longestRun} in a row | Consecutive questions that share the same answer scale. |`);
  const pooled = s.acquiescence.share === null ? "" : ` Across all interviews, ${pct(s.acquiescence.share)} of such answers were "agree".`;
  out.push(`| Interviews that agree with nearly everything (acquiescence) | ${outOf(s.acquiescence.flagged, s.acquiescence.eligible)} | ${pct(o.acquiescenceShare)} or more "agree" answers over at least ${o.acquiescenceMinItems} agree/disagree questions.${pooled} |`);
  out.push(`| Answers at either end of a scale (extreme responding) | ${outOf(s.extreme.extreme, s.extreme.items)} | Ordered scales with ${EXTREME_MIN_POINTS} or more points. |`);
  out.push(`| Time taken to start answering (response latency) | median ${ms(s.latency.medianMs)}, mean ${ms(s.latency.meanMs)} | Timed for ${s.latency.n} of ${nr.asked} questions asked. ${s.latency.tooFast} began less than ${o.tooFastMs} ms after the question ended. |`);
  const progress = s.breakoffs.meanProgress === null ? "" : ` They stopped, on average, ${pct(s.breakoffs.meanProgress)} of the way through the questions that applied.`;
  out.push(`| Interviews not finished (break-offs) | ${outOf(s.breakoffs.count, s.interviews)} | Interviews that ended before the last question.${progress} |`);
  out.push(`| Answers flagged for a person to check | ${outOf(s.review.flagged, nr.asked)} | Answers the interviewer was not sure it had understood. |`);
  out.push("");

  const asked = s.items.filter((i) => i.nonresponse.asked > 0);
  if (asked.length > 0) {
    out.push("### By question", "", "Each statement of a grid counts as one question.", "");
    out.push("| Question | Times asked | Don't know | Declined | No usable answer | No answer, share | Median time to answer |", "|---|---|---|---|---|---|---|");
    for (const i of asked) {
      const n = i.nonresponse;
      out.push(`| ${i.exportTag.replace(/\|/g, "\\|")} | ${n.asked} | ${n.dontKnow} | ${n.refused} | ${n.noAnswer} | ${pct(n.rate)} | ${ms(i.latency.medianMs)} |`);
    }
    out.push("");
  }
  if (s.breakoffs.after.length > 0) {
    const tag = (itemId: string | null) => (itemId === null ? "before the first answer" : `after ${s.items.find((i) => i.itemId === itemId)?.exportTag ?? itemId}`);
    out.push(`Unfinished interviews stopped: ${s.breakoffs.after.map((a) => `${a.count} ${tag(a.itemId)}`).join(", ")}.`, "");
  }
  return out.join("\n");
}
