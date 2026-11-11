import { describe, expect, it } from "vitest";
import {
  DEFAULT_RULES,
  DISPOSITIONS,
  finalDisposition,
  outcomeRates,
  summarizeDispositions,
  temporaryDisposition,
  type Attempt,
  type AttemptOutcome,
  type DispositionCode,
  type OutcomeCounts,
  type RateName,
} from "../src/quality/dispositions.js";

const a = (outcome: AttemptOutcome, completion?: number): Attempt => (completion === undefined ? { outcome } : { outcome, completion });
const code = (attempts: Attempt[], rules = DEFAULT_RULES): DispositionCode => finalDisposition(attempts, rules).code;

describe("AAPOR codes for a phone survey of a list of named people", () => {
  it("carries the labels of Standard Definitions, 10th edition, Tables 1 and 1.1 to 1.3", () => {
    expect(DISPOSITIONS["1.1"].label).toBe("Complete");
    expect(DISPOSITIONS["1.2"].label).toBe("Partial");
    expect(DISPOSITIONS["2.11"].label).toBe("Refusal");
    expect(DISPOSITIONS["2.12"].label).toBe("Break-off");
    expect(DISPOSITIONS["2.1132"].label).toBe("Named respondent set appointment but did not keep it (phone or in-person)");
    expect(DISPOSITIONS["2.21"].label).toBe("Named respondent never available during field period");
    expect(DISPOSITIONS["2.332"].label).toBe("Respondent language problem");
    expect(DISPOSITIONS["3.2151"].label).toBe("Always busy (Phone)");
    expect(DISPOSITIONS["3.2152"].label).toBe("No answer (Phone)");
    expect(DISPOSITIONS["3.2153"].label).toBe("Phone answering device (Phone)");
    expect(DISPOSITIONS["3.2155"].label).toBe("Technical phone problems (Phone)");
    expect(DISPOSITIONS["3.216"].label).toBe("Non-working/disconnected number");
    expect(DISPOSITIONS["3.23"].label).toBe("Not attempted or worked");
  });

  it("groups each code under the rate term its number puts it in", () => {
    const expected: Record<string, string> = { "1": "IP", "2.1": "R", "2.2": "NC", "2.3": "O", "2.9": "O", "3.2": "UR", "3.9": "UO", "4": "NE" };
    for (const [c, d] of Object.entries(DISPOSITIONS)) {
      const prefix = Object.keys(expected).find((p) => c.startsWith(p));
      expect(prefix, c).toBeDefined();
      expect(expected[prefix!], c).toContain(d.group);
    }
  });

  it("has no number-based not-eligible code: in a list sample the person is the unit, not the number", () => {
    const notEligible = Object.entries(DISPOSITIONS).filter(([, d]) => d.group === "NE").map(([c]) => c);
    expect(notEligible).toEqual(["4.10", "4.11", "4.80", "4.81", "4.90"]);
    expect(DISPOSITIONS["3.216"].group).toBe("UR");
    expect(DISPOSITIONS["2.37"]).toEqual({ label: "Wrong number", group: "O" });
  });
});

describe("one attempt", () => {
  it("maps every product outcome", () => {
    const expected: Record<AttemptOutcome, [string, DispositionCode]> = {
      complete: ["interview", "1.1"],
      breakoff: ["refusal", "2.12"],
      consent_declined: ["refusal", "2.11"],
      opt_out: ["refusal", "2.11"],
      callback: ["callback", "2.21"],
      no_answer: ["no_contact", "3.2152"],
      busy: ["no_contact", "3.2151"],
      answering_machine: ["no_contact", "3.2153"],
      invalid_number: ["no_contact", "3.216"],
      carrier_error: ["no_contact", "3.2155"],
      not_dialed: ["not_attempted", "3.23"],
    };
    for (const [outcome, [kind, c]] of Object.entries(expected) as [AttemptOutcome, [string, DispositionCode]][]) {
      expect(temporaryDisposition({ outcome }), outcome).toEqual({ kind, code: c });
    }
  });

  it("splits an interview by the share of questions answered: over 80% complete, 50% to 80% partial, less a break-off", () => {
    expect(temporaryDisposition(a("breakoff", 0.49))).toEqual({ kind: "refusal", code: "2.12" });
    expect(temporaryDisposition(a("breakoff", 0.5))).toEqual({ kind: "interview", code: "1.2" });
    expect(temporaryDisposition(a("breakoff", 0.8))).toEqual({ kind: "interview", code: "1.2" });
    expect(temporaryDisposition(a("breakoff", 0.81))).toEqual({ kind: "interview", code: "1.1" });
    // Reaching the last question is not enough if most answers were don't know or declined.
    expect(temporaryDisposition(a("complete", 0.6)).code).toBe("1.2");
    expect(temporaryDisposition(a("complete", 0.3)).code).toBe("2.12");
  });

  it("takes the thresholds as parameters", () => {
    const strict = { ...DEFAULT_RULES, completeAbove: 0.95, partialFrom: 0.7 };
    expect(temporaryDisposition(a("breakoff", 0.9), strict).code).toBe("1.2");
    expect(temporaryDisposition(a("breakoff", 0.6), strict).code).toBe("2.12");
    expect(temporaryDisposition(a("complete"), strict).code).toBe("1.1");
  });
});

describe("a case's attempts reduced to one final disposition", () => {
  it("an interview outranks everything, before or after it", () => {
    expect(code([a("no_answer"), a("consent_declined"), a("complete")])).toBe("1.1");
    expect(code([a("breakoff", 0.6), a("opt_out")])).toBe("1.2");
    expect(code([a("breakoff", 0.3), a("callback"), a("breakoff", 0.9), a("no_answer")])).toBe("1.1");
    expect(finalDisposition([a("breakoff", 0.6), a("breakoff", 0.7), a("no_answer")]).decidedBy).toBe(1);
  });

  it("a refusal stands: later no-answers or a dead number do not undo it", () => {
    expect(code([a("consent_declined"), a("no_answer"), a("no_answer")])).toBe("2.11");
    expect(code([a("opt_out"), a("invalid_number")])).toBe("2.11");
    expect(code([a("breakoff", 0.3), a("callback"), a("answering_machine")])).toBe("2.12");
  });

  it("the last refusal or break-off gives the code", () => {
    expect(code([a("breakoff", 0.2), a("consent_declined")])).toBe("2.11");
    expect(code([a("consent_declined"), a("breakoff", 0.2)])).toBe("2.12");
  });

  it("a call-back request that later calls could not turn into an interview is an implicit refusal", () => {
    expect(code([a("callback"), a("no_answer"), a("busy")])).toBe("2.1132");
    expect(code([a("no_answer"), a("callback"), a("answering_machine")])).toBe("2.1132");
    expect(code([a("callback"), a("no_answer")], { ...DEFAULT_RULES, brokenCallback: "non_contact" })).toBe("2.21");
  });

  it("a call-back request nobody followed up is 'never available', not a refusal", () => {
    expect(code([a("callback")])).toBe("2.21");
    expect(code([a("no_answer"), a("callback"), a("not_dialed")])).toBe("2.21");
    expect(code([a("callback"), a("no_answer"), a("callback")])).toBe("2.21");
  });

  it("with nobody reached, an answering device outranks no answer and busy; otherwise the last call decides", () => {
    expect(code([a("no_answer"), a("busy"), a("answering_machine"), a("no_answer")])).toBe("3.2153");
    expect(code([a("busy"), a("no_answer")])).toBe("3.2152");
    expect(code([a("no_answer"), a("busy")])).toBe("3.2151");
    expect(code([a("no_answer"), a("invalid_number")])).toBe("3.216");
    expect(code([a("carrier_error")])).toBe("3.2155");
  });

  it("calls never placed are not non-contacts: a case with none placed is 'not attempted'", () => {
    expect(code([])).toBe("3.23");
    expect(code([a("not_dialed"), a("not_dialed")])).toBe("3.23");
    expect(finalDisposition([a("not_dialed")])).toEqual({ code: "3.23", label: "Not attempted or worked", countsAs: "UR", decidedBy: null });
    expect(code([a("not_dialed"), a("no_answer"), a("not_dialed")])).toBe("3.2152");
  });

  it("counts unreached cases as unknown eligibility by default, as eligible non-contacts when the list is known eligible", () => {
    expect(finalDisposition([a("no_answer")]).countsAs).toBe("UR");
    const assumed = { ...DEFAULT_RULES, eligibility: "assumed" as const };
    expect(finalDisposition([a("no_answer")], assumed)).toMatchObject({ code: "3.2152", countsAs: "NC" });
    expect(finalDisposition([a("consent_declined")], assumed).countsAs).toBe("R");
  });
});

describe("outcome rates", () => {
  // I=40 P=10 R=20 NC=15 O=5, unknown 2+6+2=10, e=0.5.
  // Known eligible = 90; with all unknowns = 100; with e x unknowns = 95.
  const counts: OutcomeCounts = { I: 40, P: 10, R: 20, NC: 15, O: 5, UH: 2, UR: 6, UO: 2 };

  it("matches a worked example for every rate", () => {
    const r = outcomeRates(counts, 0.5);
    const expected: Record<RateName, number> = {
      RR1: 40 / 100,
      RR2: 50 / 100,
      RR3: 40 / 95,
      RR4: 50 / 95,
      RR5: 40 / 90,
      RR6: 50 / 90,
      COOP1: 40 / 75,
      COOP2: 50 / 75,
      COOP3: 40 / 70,
      COOP4: 50 / 70,
      REF1: 20 / 100,
      REF2: 20 / 95,
      REF3: 20 / 90,
      CON1: 75 / 100,
      CON2: 75 / 95,
      CON3: 75 / 90,
    };
    expect(Object.keys(r).sort()).toEqual(Object.keys(expected).sort());
    for (const name of Object.keys(expected) as RateName[]) expect(r[name], name).toBeCloseTo(expected[name], 12);
  });

  it("e = 1 makes RR3 equal RR1; e = 0 makes it equal RR5", () => {
    expect(outcomeRates(counts, 1).RR3).toBeCloseTo(0.4, 12);
    expect(outcomeRates(counts, 1).CON2).toBeCloseTo(0.75, 12);
    expect(outcomeRates(counts, 0).RR4).toBeCloseTo(50 / 90, 12);
    expect(outcomeRates(counts, 0).REF2).toBeCloseTo(20 / 90, 12);
  });

  it("returns null for a rate whose denominator is zero", () => {
    const zero: OutcomeCounts = { I: 0, P: 0, R: 0, NC: 0, O: 0, UH: 0, UR: 0, UO: 0 };
    for (const v of Object.values(outcomeRates(zero, 1))) expect(v).toBeNull();

    // Only unknown cases: rates over all cases are 0, the rest have nothing to divide by.
    const r = outcomeRates({ ...zero, UR: 8 }, 0);
    expect(r.RR1).toBe(0);
    expect(r.REF1).toBe(0);
    expect(r.CON1).toBe(0);
    for (const name of ["RR3", "RR4", "RR5", "RR6", "COOP1", "COOP2", "COOP3", "COOP4", "REF2", "REF3", "CON2", "CON3"] as const) expect(r[name], name).toBeNull();

    // Only non-contacts: nobody was reached, so there is no cooperation rate.
    const nc = outcomeRates({ ...zero, NC: 5 }, 1);
    expect(nc.COOP1).toBeNull();
    expect(nc.COOP4).toBeNull();
    expect(nc.RR1).toBe(0);
    expect(nc.CON3).toBe(0);
  });

  it("refuses an impossible e or a negative count", () => {
    expect(() => outcomeRates(counts, 1.2)).toThrow(RangeError);
    expect(() => outcomeRates(counts, -0.1)).toThrow(RangeError);
    expect(() => outcomeRates(counts, Number.NaN)).toThrow(RangeError);
    expect(() => outcomeRates({ ...counts, R: -1 }, 1)).toThrow(RangeError);
  });
});

describe("summary of a set of cases", () => {
  const cases = [
    { attempts: [a("no_answer"), a("complete")] }, // 1.1
    { attempts: [a("complete", 0.9)] }, // 1.1
    { attempts: [a("breakoff", 0.6)] }, // 1.2
    { attempts: [a("consent_declined")] }, // 2.11
    { attempts: [a("breakoff", 0.1), a("no_answer")] }, // 2.12
    { attempts: [a("callback")] }, // 2.21
    { attempts: [a("no_answer"), a("busy"), a("no_answer")] }, // 3.2152
    { attempts: [a("invalid_number")] }, // 3.216
    { attempts: [a("not_dialed")] }, // 3.23
    { attempts: [a("complete")], assigned: "2.332" as const }, // a person found the interview unusable
    { attempts: [a("no_answer")], assigned: "4.11" as const }, // not eligible
  ];

  it("counts cases by final code, in code order", () => {
    const s = summarizeDispositions(cases);
    expect(s.cases).toBe(11);
    expect(s.byCode.map((c) => [c.code, c.count])).toEqual([
      ["1.1", 2],
      ["1.2", 1],
      ["2.11", 1],
      ["2.12", 1],
      ["2.21", 1],
      ["2.332", 1],
      ["3.2152", 1],
      ["3.216", 1],
      ["3.23", 1],
      ["4.11", 1],
    ]);
    expect(s.byCode.find((c) => c.code === "2.332")?.label).toBe("Respondent language problem");
    expect(s.counts).toEqual({ I: 2, P: 1, R: 2, NC: 1, O: 1, UH: 0, UR: 3, UO: 0 });
    expect(s.notEligible).toBe(1);
  });

  it("computes the rates from those counts, with e = 1 unless told otherwise", () => {
    const s = summarizeDispositions(cases);
    // Known eligible 7, unknown 3; the not-eligible case is in no rate.
    expect(s.e).toBe(1);
    expect(s.rates.RR1).toBeCloseTo(2 / 10, 12);
    expect(s.rates.RR3).toBeCloseTo(2 / 10, 12);
    expect(s.rates.RR6).toBeCloseTo(3 / 7, 12);
    expect(s.rates.COOP1).toBeCloseTo(2 / 6, 12);
    expect(s.rates.REF1).toBeCloseTo(2 / 10, 12);
    expect(s.rates.CON1).toBeCloseTo(6 / 10, 12);
    expect(summarizeDispositions(cases, { e: 0.5 }).rates.RR3).toBeCloseTo(2 / 8.5, 12);
  });

  it("counts calls placed per case, leaving out calls never placed", () => {
    const s = summarizeDispositions(cases);
    expect(s.attempts).toEqual({ total: 14, mean: 14 / 11, max: 3 });
    expect(summarizeDispositions([]).attempts).toEqual({ total: 0, mean: null, max: 0 });
    expect(summarizeDispositions([]).rates.RR1).toBeNull();
  });

  it("with eligibility assumed, unknown cases become non-contacts and RR5 no longer flatters", () => {
    const s = summarizeDispositions(cases, { rules: { eligibility: "assumed" } });
    expect(s.counts).toEqual({ I: 2, P: 1, R: 2, NC: 4, O: 1, UH: 0, UR: 0, UO: 0 });
    expect(s.rates.RR5).toBeCloseTo(2 / 10, 12);
    expect(s.rates.RR5).toBe(s.rates.RR1);
    expect(s.byCode.find((c) => c.code === "3.23")?.count).toBe(1);
  });
});
