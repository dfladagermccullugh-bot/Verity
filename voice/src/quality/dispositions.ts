/**
 * Call outcomes and outcome rates, following AAPOR Standard Definitions.
 *
 * Source: The American Association for Public Opinion Research. 2023. Standard Definitions: Final
 * Dispositions of Case Codes and Outcome Rates for Surveys. 10th edition. AAPOR.
 * https://aapor.org/wp-content/uploads/2023/05/Standards-Definitions-10th-edition.pdf (read 10 Nov 2026).
 * Codes and labels are from its Table 1 (interviews) and Tables 1.1 to 1.3 (list samples), which its
 * section 1.3 applies to phone surveys of lists of specifically named persons. The precedence rules
 * are from "Temporary vs. Final Disposition Codes" in its introduction; the rates from its section 7.
 *
 * Three things here differ from the older, RDD-centred way of coding phone outcomes:
 *
 * - The sampled unit is a named person, not a phone number. A dead, fax or wrong number says nothing
 *   about whether that person is eligible, so it is never "not eligible": a non-working number is
 *   3.216 (unknown eligibility) and a wrong number is 2.37. The 4.2x/4.3x number codes exist only in
 *   the RDD tables (Table 3.3). Table 1.3 leaves a list sample with screened out, deceased, quota
 *   filled, duplicate and other.
 * - The 10th edition splits unknown eligibility into three terms: UH (3.10), UR (3.20) and UO (3.90).
 *   Every phone code in the list tables sits under 3.20, so here the unknown cases are UR.
 * - Where every listed person can be taken as eligible (no screening needed), section 1 says unknown
 *   eligibility "does not apply" and those dispositions "should instead be classified as eligible
 *   nonrespondent codes". `eligibility: "assumed"` does that. People who signed up in advance
 *   arguably are such a list. The default still keeps the tables as printed, because AAPOR asks the
 *   researcher to state and justify the eligibility assumption, not the software to make it.
 *
 * Limits a reader should know about:
 *
 * - The call protocol does not ask "am I speaking with ...?". Codes that need the named person to be
 *   confirmed (2.112, 2.21, 2.22) are therefore not fully established by a call outcome alone; see
 *   the notes on each mapping.
 * - These are rates for the calling phase only. A list of people who agreed in advance to be called
 *   is in effect the second phase of a two-phase design, and AAPOR asks complex designs to report
 *   each component and the cumulative rate, so the sign-up rate belongs beside these. For volunteers
 *   (not a probability sample) the standard says response rate calculations "make little sense";
 *   report the figures as participation among the people listed.
 * - Codes no call outcome can establish (language barrier, deceased, wrong number, screened out) are
 *   listed so that a person can assign them after review, through `CaseHistory.assigned`.
 */

type Group = "I" | "P" | "R" | "NC" | "O" | "UR" | "UO" | "NE";

/**
 * Final disposition codes for a phone survey of a list of named people, with AAPOR's labels.
 * `group` is the term of the rate formulas the code counts under (section 7): I = 1.1, P = 1.2,
 * R = 2.10, NC = 2.20, O = 2.30 and 2.90, UR = 3.20, UO = 3.90. NE (4.x, not eligible) is in no rate.
 * Sub-codes follow their parent by number (3.23 under 3.20, and so on). The split between the
 * unknown terms never changes a rate: every formula uses their sum.
 * Labels are as printed, except a stray space removed in 3.216 and a plain apostrophe in 3.2156.
 */
export const DISPOSITIONS = {
  // Table 1: interview (1.0).
  "1.1": { label: "Complete", group: "I" },
  "1.2": { label: "Partial", group: "P" },
  // Table 1.1: eligible, non-interview (2.0).
  "2.10": { label: "Refusal and break-off", group: "R" },
  "2.11": { label: "Refusal", group: "R" },
  "2.111": { label: "Household-level (or proxy) Refusal", group: "R" },
  "2.112": { label: "Known Respondent Refusal", group: "R" },
  "2.113": { label: "Other Implicit Refusal", group: "R" },
  "2.1132": { label: "Named respondent set appointment but did not keep it (phone or in-person)", group: "R" },
  "2.12": { label: "Break-off", group: "R" },
  "2.20": { label: "Non-contact", group: "NC" },
  "2.21": { label: "Named respondent never available during field period", group: "NC" },
  "2.22": { label: "Phone answering device (Phone)", group: "NC" },
  "2.221": { label: "Answering machine - no message left (phone)", group: "NC" },
  "2.222": { label: "Answering machine - message left (phone)", group: "NC" },
  "2.23": { label: "Other non-contact", group: "NC" },
  // Printed as "2.3" in Table 1.1 and as 2.30 in the text and in section 7.
  "2.30": { label: "Other", group: "O" },
  "2.31": { label: "Deceased respondent", group: "O" },
  "2.32": { label: "Physically or mentally unable/incompetent", group: "O" },
  "2.33": { label: "Language or Technical Barrier", group: "O" },
  "2.332": { label: "Respondent language problem", group: "O" },
  "2.34": { label: "Inadequate audio quality or literacy issues", group: "O" },
  "2.35": { label: "Location/Activity not allowing interview", group: "O" },
  "2.36": { label: "Someone other than respondent completes questionnaire or interview", group: "O" },
  "2.37": { label: "Wrong number", group: "O" },
  "2.90": { label: "Miscellaneous, non-interview", group: "O" },
  // Table 1.2: unknown eligibility, non-interview (3.0).
  "3.20": { label: "No Screener Completed, Unknown", group: "UR" },
  "3.21": { label: "Unreachable/screener not completed", group: "UR" },
  "3.215": { label: "Unreachable (Phone)", group: "UR" },
  "3.2151": { label: "Always busy (Phone)", group: "UR" },
  "3.2152": { label: "No answer (Phone)", group: "UR" },
  "3.2153": { label: "Phone answering device (Phone)", group: "UR" },
  "3.2154": { label: "Telecommunication technological barriers (Phone)", group: "UR" },
  "3.2155": { label: "Technical phone problems (Phone)", group: "UR" },
  "3.2156": { label: "Ambiguous operator's message (Phone)", group: "UR" },
  "3.216": { label: "Non-working/disconnected number", group: "UR" },
  "3.23": { label: "Not attempted or worked", group: "UR" },
  "3.90": { label: "Other", group: "UO" },
  // Table 1.3: not eligible (4.0).
  "4.10": { label: "Selected Respondent Screened Out of Sample", group: "NE" },
  "4.11": { label: "Deceased", group: "NE" },
  "4.80": { label: "Quota Filled", group: "NE" },
  "4.81": { label: "Duplicate listing", group: "NE" },
  "4.90": { label: "Other", group: "NE" },
} as const satisfies Record<string, { label: string; group: Group }>;

export type DispositionCode = keyof typeof DISPOSITIONS;

/** How one call attempt ended, as the product records it. */
// One definition for the whole product: the dialer decides these, this module interprets them.
export type { AttemptOutcome } from "../dialer/rules.js";
import type { AttemptOutcome } from "../dialer/rules.js";

export interface Attempt {
  outcome: AttemptOutcome;
  /**
   * For `complete` and `breakoff`: the share of applicable questions answered when the call ended,
   * 0 to 1, counting answers carried over from earlier calls (`completionShare` in `analysis.ts`
   * computes it). Left out, a `complete` counts as 1 (every applicable question was asked, AAPOR's
   * standard b) and a `breakoff` as 0.
   */
  completion?: number;
}

function completionOf(a: Attempt): number {
  return a.completion ?? (a.outcome === "complete" ? 1 : 0);
}

export interface DispositionRules {
  /**
   * More than this share of applicable questions answered is a complete (1.1). AAPOR requires the
   * researcher to fix the definition before fieldwork and gives "more than 80%" as its example
   * (Table 1, example A); it is an example, not a rule.
   */
  completeAbove: number;
  /** At least this share is a partial (1.2); less is a break-off (2.12). AAPOR's example: 50% to 80%. */
  partialFrom: number;
  /**
   * A call-back request followed by more calls that never reached an interview. AAPOR: a case with
   * an appointment that did not end as an interview is best classified as a refusal unless there is
   * specific evidence to suggest otherwise (code 2.1132). `non_contact` codes it 2.21 instead.
   */
  brokenCallback: "refusal" | "non_contact";
  /**
   * `unknown`: Table 1.2 as printed; unreached and never-dialled cases are of unknown eligibility.
   * `assumed`: everyone on the list is known to be eligible, so those cases count as eligible
   * nonrespondents. AAPOR gives no replacement code numbers, so the code stays and only the term it
   * counts under changes: UR to NC (nobody was reached), UO to O.
   */
  eligibility: "unknown" | "assumed";
}

export const DEFAULT_RULES: DispositionRules = { completeAbove: 0.8, partialFrom: 0.5, brokenCallback: "refusal", eligibility: "unknown" };

/**
 * What an attempt established, for deciding between attempts:
 * `interview` a complete or partial; `refusal` a refusal or break-off; `callback` a person asked to
 * be called another time; `no_contact` dialled, no person reached; `not_attempted` no call placed.
 */
export type AttemptKind = "interview" | "refusal" | "callback" | "no_contact" | "not_attempted";

export interface TemporaryDisposition {
  kind: AttemptKind;
  /** The code the case would take if this were its only attempt. */
  code: DispositionCode;
}

/** Outcomes of a dialled call that reached nobody, with their Table 1.2 codes. */
const NO_CONTACT: Partial<Record<AttemptOutcome, DispositionCode>> = {
  no_answer: "3.2152",
  busy: "3.2151",
  // 2.22/2.221 would need a greeting that names the respondent; machine detection does not check that.
  answering_machine: "3.2153",
  // "Includes Fax/Data line". Not 4.3x: that is an RDD code, where the number itself is the sampled unit.
  invalid_number: "3.216",
  carrier_error: "3.2155",
};

function interviewCode(completion: number, rules: DispositionRules): DispositionCode {
  if (completion > rules.completeAbove) return "1.1";
  return completion >= rules.partialFrom ? "1.2" : "2.12";
}

/**
 * The disposition of one attempt taken alone.
 *
 * - `complete`, `breakoff`: complete, partial or break-off by the share of questions answered, not by
 *   whether the last question was reached. A break-off is a kind of refusal (AAPOR, introduction).
 * - `consent_declined`, `opt_out`: 2.11 Refusal. The sub-codes say who refused (2.111 someone else,
 *   2.112 the named respondent), which the call does not establish.
 * - `callback`: a contact without a refusal. Alone it is 2.21; `finalDisposition` handles the rest.
 * - `not_dialed`: no call was placed (outside calling hours, cap reached). AAPOR wants attempt codes
 *   to record the outcome of a contact attempt and treats "maximum call limit met" as a status, not
 *   an outcome. So it is 3.23 Not attempted or worked, never a non-contact (2.2x), which would say
 *   that a call to an eligible person went unanswered.
 */
export function temporaryDisposition(attempt: Attempt, rules: DispositionRules = DEFAULT_RULES): TemporaryDisposition {
  const o = attempt.outcome;
  if (o === "complete" || o === "breakoff") {
    const code = interviewCode(completionOf(attempt), rules);
    return { kind: code === "2.12" ? "refusal" : "interview", code };
  }
  if (o === "consent_declined" || o === "opt_out") return { kind: "refusal", code: "2.11" };
  if (o === "callback") return { kind: "callback", code: "2.21" };
  const code = NO_CONTACT[o];
  return code ? { kind: "no_contact", code } : { kind: "not_attempted", code: "3.23" };
}

/** A term of the rate formulas (AAPOR section 7). */
export type CountKey = "I" | "P" | "R" | "NC" | "O" | "UH" | "UR" | "UO";

export interface FinalDisposition {
  code: DispositionCode;
  label: string;
  /** The term of the rate formulas this case counts under; null when not eligible (in no rate). */
  countsAs: CountKey | null;
  /** Index of the attempt that decided the code; null when no call was placed or a person assigned it. */
  decidedBy: number | null;
}

function countsAs(code: DispositionCode, eligibility: DispositionRules["eligibility"]): CountKey | null {
  const group: Group = DISPOSITIONS[code].group;
  if (group === "NE") return null;
  if (eligibility === "assumed" && group === "UR") return "NC";
  if (eligibility === "assumed" && group === "UO") return "O";
  return group;
}

function final(code: DispositionCode, decidedBy: number | null, rules: DispositionRules): FinalDisposition {
  return { code, label: DISPOSITIONS[code].label, countsAs: countsAs(code, rules.eligibility), decidedBy };
}

/**
 * Reduce a case's attempts, oldest first, to one final disposition. AAPOR's order (introduction,
 * "Temporary vs. Final Disposition Codes"), applied top down:
 *
 * 1. An interview outranks everything. Answers carry over between calls, so the largest share
 *    answered decides between complete and partial, even if the person later refused or opted out.
 * 2. "once there was a refusal, the case would ultimately be classified as a refusal" unless it
 *    became an interview. Later no-answers or a later dead number do not undo it. The last refusal
 *    or break-off gives the code.
 * 3. Otherwise the last attempt that reached a person decides. That can only be a call-back
 *    request: 2.1132 (or 2.21, see `brokenCallback`) if later calls failed to reach an interview,
 *    2.21 if no later call was placed, because then the survey, not the respondent, let it lapse.
 * 4. With no person reached on any attempt, the most informative outcome decides. AAPOR ranks only
 *    the answering device above no-answer and busy; among the rest the last call decides. All of
 *    these sit under 3.21, so this choice changes the label but no rate.
 * 5. Calls that were never placed are ignored; a case with none placed is 3.23.
 *
 * Step "definitive information that the case is not eligible" has no call outcome here; a person
 * can record it through `CaseHistory.assigned`.
 */
export function finalDisposition(attempts: readonly Attempt[], rules: DispositionRules = DEFAULT_RULES): FinalDisposition {
  const temps = attempts.map((a) => temporaryDisposition(a, rules));
  const last = (pred: (t: TemporaryDisposition, i: number) => boolean) => temps.findLastIndex(pred);

  let best = -1;
  attempts.forEach((a, i) => {
    if (temps[i]!.kind !== "interview") return;
    if (best < 0 || completionOf(a) >= completionOf(attempts[best]!)) best = i;
  });
  if (best >= 0) return final(temps[best]!.code, best, rules);

  const refusal = last((t) => t.kind === "refusal");
  if (refusal >= 0) return final(temps[refusal]!.code, refusal, rules);

  const callback = last((t) => t.kind === "callback");
  if (callback >= 0) {
    const calledAgain = temps.slice(callback + 1).some((t) => t.kind === "no_contact");
    return final(calledAgain && rules.brokenCallback === "refusal" ? "2.1132" : "2.21", callback, rules);
  }

  const machine = last((t) => t.code === "3.2153");
  const dialed = machine >= 0 ? machine : last((t) => t.kind === "no_contact");
  if (dialed >= 0) return final(temps[dialed]!.code, dialed, rules);

  return final("3.23", null, rules);
}

/** Final-disposition counts in the terms of the rate formulas. */
export type OutcomeCounts = Record<CountKey, number>;

export type RateName = "RR1" | "RR2" | "RR3" | "RR4" | "RR5" | "RR6" | "COOP1" | "COOP2" | "COOP3" | "COOP4" | "REF1" | "REF2" | "REF3" | "CON1" | "CON2" | "CON3";

/** Each rate as a proportion, or null when its denominator is zero. */
export type OutcomeRates = Record<RateName, number | null>;

/**
 * AAPOR outcome rates (Standard Definitions, 10th edition, section 7). With U = UH + UR + UO and
 * e = the estimated share of unknown-eligibility cases that are eligible:
 *
 *   RR1 = I / ((I+P) + (R+NC+O) + U)            RR2 = (I+P) / ((I+P) + (R+NC+O) + U)
 *   RR3 = I / ((I+P) + (R+NC+O) + e·U)          RR4 = (I+P) / ((I+P) + (R+NC+O) + e·U)
 *   RR5 = I / ((I+P) + (R+NC+O))                RR6 = (I+P) / ((I+P) + (R+NC+O))
 *
 *   COOP1 = I / ((I+P) + R + O)                 COOP2 = (I+P) / ((I+P) + R + O)
 *   COOP3 = I / ((I+P) + R)                     COOP4 = (I+P) / ((I+P) + R)
 *
 *   REF1 = R / ((I+P) + (R+NC+O) + U)           REF2 = R / ((I+P) + (R+NC+O) + e·U)
 *   REF3 = R / ((I+P) + (R+NC+O))
 *
 *   CON1 = ((I+P) + R + O) / ((I+P) + (R+NC+O) + U)
 *   CON2 = ((I+P) + R + O) / ((I+P) + (R+NC+O) + e·U)
 *   CON3 = ((I+P) + R + O) / ((I+P) + (R+NC+O))
 *
 * RR5, RR6, REF3 and CON3 drop the unknown cases; AAPOR allows that only when none of them can be
 * eligible or there are none. AAPOR also requires the basis for `e` to be stated, and a report to
 * name the rate ("Response Rate 3 was ..."), never just "the response rate".
 */
export function outcomeRates(counts: OutcomeCounts, e: number): OutcomeRates {
  if (!(e >= 0 && e <= 1)) throw new RangeError("e must be between 0 and 1.");
  const { I, P, R, NC, O, UH, UR, UO } = counts;
  if ([I, P, R, NC, O, UH, UR, UO].some((n) => !(n >= 0) || !Number.isFinite(n))) throw new RangeError("Counts must be zero or more.");
  const interviews = I + P;
  const known = interviews + R + NC + O;
  const unknown = UH + UR + UO;
  const all = known + unknown;
  const estimated = known + e * unknown;
  const contacted = interviews + R + O;
  const rate = (n: number, d: number) => (d === 0 ? null : n / d);
  return {
    RR1: rate(I, all),
    RR2: rate(interviews, all),
    RR3: rate(I, estimated),
    RR4: rate(interviews, estimated),
    RR5: rate(I, known),
    RR6: rate(interviews, known),
    COOP1: rate(I, contacted),
    COOP2: rate(interviews, contacted),
    COOP3: rate(I, interviews + R),
    COOP4: rate(interviews, interviews + R),
    REF1: rate(R, all),
    REF2: rate(R, estimated),
    REF3: rate(R, known),
    CON1: rate(contacted, all),
    CON2: rate(contacted, estimated),
    CON3: rate(contacted, known),
  };
}

export interface CaseHistory {
  /** Call attempts, oldest first. */
  attempts: Attempt[];
  /**
   * A final code a person assigned after review (for example 2.332 after listening to the call, or
   * 4.11 on learning the respondent died before fieldwork). It replaces the code derived from the calls.
   */
  assigned?: DispositionCode;
}

export interface SummaryOptions {
  rules?: Partial<DispositionRules>;
  /**
   * Estimated share of unknown-eligibility cases that are eligible. Default 1: every listed person
   * agreed to be called, so an unreached one is presumed eligible. That makes RR3 equal RR1, the
   * conservative end. A lower value needs a stated basis.
   */
  e?: number;
}

export interface DispositionSummary {
  cases: number;
  /** Cases by final code, in AAPOR's code order; codes with no cases are left out. */
  byCode: { code: DispositionCode; label: string; count: number }[];
  counts: OutcomeCounts;
  /** Cases coded not eligible (4.x); they are in no rate. */
  notEligible: number;
  e: number;
  rates: OutcomeRates;
  /** Calls actually placed per case. `not_dialed` entries are not calls. Mean is null with no cases. */
  attempts: { total: number; mean: number | null; max: number };
}

/** Final dispositions, outcome rates and calls per case for a set of cases. */
export function summarizeDispositions(cases: readonly CaseHistory[], options: SummaryOptions = {}): DispositionSummary {
  const rules = { ...DEFAULT_RULES, ...options.rules };
  const e = options.e ?? 1;
  const counts: OutcomeCounts = { I: 0, P: 0, R: 0, NC: 0, O: 0, UH: 0, UR: 0, UO: 0 };
  const perCode = new Map<DispositionCode, number>();
  let notEligible = 0;
  let total = 0;
  let max = 0;
  for (const c of cases) {
    const d = c.assigned === undefined ? finalDisposition(c.attempts, rules) : final(c.assigned, null, rules);
    perCode.set(d.code, (perCode.get(d.code) ?? 0) + 1);
    if (d.countsAs === null) notEligible += 1;
    else counts[d.countsAs] += 1;
    const dialed = c.attempts.filter((a) => a.outcome !== "not_dialed").length;
    total += dialed;
    max = Math.max(max, dialed);
  }
  const byCode = (Object.keys(DISPOSITIONS) as DispositionCode[]).filter((code) => perCode.has(code)).map((code) => ({ code, label: DISPOSITIONS[code].label, count: perCode.get(code)! }));
  return { cases: cases.length, byCode, counts, notEligible, e, rates: outcomeRates(counts, e), attempts: { total, mean: cases.length === 0 ? null : total / cases.length, max } };
}
