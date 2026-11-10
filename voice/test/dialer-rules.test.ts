import { describe, expect, it } from "vitest";
import { normalizeUsPhone, readContactsCsv } from "../src/dialer/contacts.js";
import { ALL_US_ZONES, DEFAULT_WINDOW, localTime, nextPermitted, withinWindow, zonesFor } from "../src/dialer/hours.js";
import { DEFAULT_SETTINGS, afterAttempt, canDial, consentProblem, type AttemptOutcome, type ConsentRecord, type DialCandidate } from "../src/dialer/rules.js";
import { rng } from "./helpers.js";

const at = (iso: string) => new Date(iso);
const CONSENT: ConsentRecord = { source: "Qualtrics R_abc123", obtainedAt: "2026-11-01T12:00:00.000Z", method: "web_form", scope: "A phone survey about your local library, conducted by an AI interviewer." };
const candidate = (over: Partial<DialCandidate> = {}): DialCandidate => ({ phone: "+12025550143", status: "pending", consent: CONSENT, attempts: 0, nextAttemptAt: null, timezone: "America/New_York", stateCode: null, ...over });
const NOON_ET = at("2026-11-10T17:00:00Z");
const decide = (over: Partial<Parameters<typeof canDial>[0]> = {}) => canDial({ candidate: candidate(), campaignStatus: "running", settings: DEFAULT_SETTINGS, onDnc: false, minutesUsed: 0, now: NOON_ET, ...over });

describe("calling hours", () => {
  it("converts to local time, including daylight saving", () => {
    expect(localTime(at("2026-11-10T15:00:00Z"), "America/New_York")).toEqual({ hour: 10, minute: 0, day: 2 });
    expect(localTime(at("2026-11-10T15:00:00Z"), "America/Los_Angeles")).toMatchObject({ hour: 7 });
    expect(localTime(at("2026-07-01T13:30:00Z"), "America/New_York")).toMatchObject({ hour: 9, minute: 30 });
    expect(localTime(at("2026-11-10T03:00:00Z"), "Pacific/Honolulu")).toEqual({ hour: 17, minute: 0, day: 1 });
  });

  it("allows 9am up to, not including, 8pm local time", () => {
    const ny = ["America/New_York"];
    expect(withinWindow(at("2026-11-10T13:59:00Z"), ny)).toBe(false);
    expect(withinWindow(at("2026-11-10T14:00:00Z"), ny)).toBe(true);
    expect(withinWindow(at("2026-11-11T00:59:00Z"), ny)).toBe(true);
    expect(withinWindow(at("2026-11-11T01:00:00Z"), ny)).toBe(false);
    expect(withinWindow(NOON_ET, [])).toBe(false);
  });

  it("when nothing is known about location, every US zone must be inside the window", () => {
    expect(zonesFor({})).toEqual(ALL_US_ZONES);
    expect(withinWindow(at("2026-11-10T15:00:00Z"), ALL_US_ZONES)).toBe(false); // 7am Pacific
    expect(withinWindow(at("2026-11-10T18:30:00Z"), ALL_US_ZONES)).toBe(false); // 8:30am Hawaii
    expect(withinWindow(at("2026-11-10T19:30:00Z"), ALL_US_ZONES)).toBe(true); // 2:30pm Eastern, 9:30am Hawaii
    expect(withinWindow(at("2026-11-11T01:00:00Z"), ALL_US_ZONES)).toBe(false); // 8pm Eastern
  });

  it("a state that straddles two zones uses both", () => {
    expect(zonesFor({ stateCode: "fl" })).toEqual(["America/New_York", "America/Chicago"]);
    expect(withinWindow(at("2026-07-01T13:30:00Z"), zonesFor({ stateCode: "FL" }))).toBe(false); // 8:30am Central
    expect(withinWindow(at("2026-07-01T14:00:00Z"), zonesFor({ stateCode: "FL" }))).toBe(true);
    expect(zonesFor({ stateCode: "ZZ", timezone: "Not/AZone" })).toEqual(ALL_US_ZONES);
    expect(zonesFor({ stateCode: "CA", timezone: "America/New_York" }).sort()).toEqual(["America/Los_Angeles", "America/New_York"]);
  });

  it("finds the next permitted moment, and honours permitted days", () => {
    expect(nextPermitted(at("2026-11-10T03:00:00Z"), ["America/New_York"])!.toISOString()).toBe("2026-11-10T14:00:00.000Z");
    expect(nextPermitted(NOON_ET, ["America/New_York"])).toEqual(NOON_ET);
    const weekdays = { ...DEFAULT_WINDOW, days: [1, 2, 3, 4, 5] };
    expect(nextPermitted(at("2026-11-14T17:00:00Z"), ["America/New_York"], weekdays)!.toISOString()).toBe("2026-11-16T14:00:00.000Z");
    expect(nextPermitted(NOON_ET, ["America/New_York"], { ...DEFAULT_WINDOW, days: [] })).toBeNull();
  });
});

describe("may this person be called?", () => {
  it("yes, when every rule is met", () => {
    expect(decide()).toEqual({ ok: true });
  });

  it("each rule blocks on its own", () => {
    expect(decide({ candidate: candidate({ consent: null }) })).toEqual({ ok: false, reason: "no_consent" });
    expect(decide({ candidate: candidate({ consent: { ...CONSENT, scope: " " } }) })).toEqual({ ok: false, reason: "consent_invalid" });
    expect(decide({ candidate: candidate({ consent: { ...CONSENT, obtainedAt: "2027-01-01T00:00:00Z" } }) })).toEqual({ ok: false, reason: "consent_invalid" });
    expect(decide({ candidate: candidate({ consent: { ...CONSENT, method: "assumed" as never } }) })).toEqual({ ok: false, reason: "consent_invalid" });
    expect(decide({ candidate: candidate({ consent: { ...CONSENT, obtainedAt: "2026-07-01T00:00:00Z" } }) })).toEqual({ ok: false, reason: "consent_expired" });
    expect(decide({ onDnc: true })).toEqual({ ok: false, reason: "on_do_not_call_list" });
    expect(decide({ campaignStatus: "paused" })).toEqual({ ok: false, reason: "campaign_not_running" });
    expect(decide({ candidate: candidate({ status: "final" }) })).toEqual({ ok: false, reason: "case_closed" });
    expect(decide({ candidate: candidate({ status: "in_call" }) })).toEqual({ ok: false, reason: "call_in_progress" });
    expect(decide({ candidate: candidate({ attempts: 4 }) })).toEqual({ ok: false, reason: "max_attempts" });
    expect(decide({ minutesUsed: 600 })).toEqual({ ok: false, reason: "minutes_cap_reached" });
    expect(decide({ candidate: candidate({ nextAttemptAt: at("2026-11-10T18:00:00Z") }) })).toEqual({ ok: false, reason: "not_due" });
    expect(decide({ now: at("2026-11-10T12:00:00Z") })).toEqual({ ok: false, reason: "outside_hours" });
  });

  it("no consent and do-not-call outrank everything else", () => {
    expect(decide({ candidate: candidate({ consent: null, status: "final" }), campaignStatus: "closed", onDnc: true })).toEqual({ ok: false, reason: "no_consent" });
    expect(decide({ onDnc: true, campaignStatus: "closed" })).toEqual({ ok: false, reason: "on_do_not_call_list" });
  });

  it("across 5,000 random situations: never without valid consent, never on the do-not-call list, never outside hours", () => {
    const rand = rng(42);
    const pick = <T,>(xs: T[]): T => xs[Math.floor(rand() * xs.length)]!;
    let allowed = 0;
    for (let i = 0; i < 5000; i++) {
      const consent = pick<ConsentRecord | null>([null, CONSENT, CONSENT, CONSENT, { ...CONSENT, obtainedAt: "2026-06-01T00:00:00Z" }, { ...CONSENT, source: "" }]);
      const c = candidate({ consent, status: pick(["pending", "pending", "pending", "in_call", "final"] as const), attempts: Math.floor(rand() * 6), timezone: pick([null, "America/New_York", "America/Los_Angeles", "Pacific/Honolulu"]), stateCode: pick([null, "TX", "FL", "AK"]) });
      const now = new Date(Date.parse("2026-11-08T00:00:00Z") + Math.floor(rand() * 7 * 24 * 60) * 60_000);
      const onDnc = rand() < 0.2;
      const d = canDial({ candidate: c, campaignStatus: pick(["running", "running", "paused"]), settings: DEFAULT_SETTINGS, onDnc, minutesUsed: rand() * 700, now });
      if (!d.ok) continue;
      allowed += 1;
      expect(consentProblem(c.consent, now, DEFAULT_SETTINGS.consentValidDays)).toBeNull();
      expect(onDnc).toBe(false);
      for (const z of zonesFor(c)) {
        const t = localTime(now, z);
        expect(t.hour >= 9 && t.hour < 20).toBe(true);
      }
    }
    expect(allowed).toBeGreaterThan(50);
  });
});

describe("after an attempt", () => {
  const after = (outcome: AttemptOutcome, attemptsMade = 1) => afterAttempt({ outcome, attemptsMade, candidate: candidate(), settings: DEFAULT_SETTINGS, now: NOON_ET });

  it("complete, declined, opt-out and bad numbers are never called again", () => {
    for (const o of ["complete", "consent_declined", "opt_out", "invalid_number"] as const) expect(after(o)).toMatchObject({ final: true, nextAttemptAt: null });
    expect(after("opt_out").addToDnc).toBe(true);
    expect(after("consent_declined").addToDnc).toBe(false);
  });

  it("no answer, busy, machine, call-back and break-off are retried later, inside calling hours", () => {
    for (const o of ["no_answer", "busy", "answering_machine", "callback", "breakoff", "carrier_error"] as const) {
      const r = after(o);
      expect(r.final).toBe(false);
      expect(r.nextAttemptAt!.getTime()).toBeGreaterThan(NOON_ET.getTime());
      expect(withinWindow(r.nextAttemptAt!, ["America/New_York"])).toBe(true);
    }
    // A retry that would land at night moves to the next morning.
    const late = afterAttempt({ outcome: "callback", attemptsMade: 1, candidate: candidate(), settings: { ...DEFAULT_SETTINGS, retryHours: { ...DEFAULT_SETTINGS.retryHours, callback: 10 } }, now: NOON_ET });
    expect(late.nextAttemptAt!.toISOString()).toBe("2026-11-11T14:00:00.000Z");
  });

  it("stops at the attempt limit", () => {
    expect(after("no_answer", 4)).toMatchObject({ final: true, nextAttemptAt: null });
    expect(after("no_answer", 3).final).toBe(false);
  });
});

describe("contact lists", () => {
  it("normalises US numbers and refuses numbers that must never be dialled", () => {
    expect(normalizeUsPhone("(202) 555-0143")).toEqual({ ok: true, e164: "+12025550143" });
    expect(normalizeUsPhone("+1 202-555-0143")).toEqual({ ok: true, e164: "+12025550143" });
    for (const bad of ["911", "411", "202-555", "+44 20 7946 0958", "900-555-0143", "202-976-0143", "211-555-0143", "202-911-0143", "123-555-0143", ""]) {
      expect(normalizeUsPhone(bad).ok, bad).toBe(false);
    }
  });

  it("reads a contact file and reports what is wrong with each row", () => {
    const csv = [
      "phone,state,timezone,external_ref,consent_source,consent_at,consent_method,consent_scope",
      '202-555-0143,DC,,R_1,Qualtrics R_1,2026-11-01T12:00:00Z,web_form,"Phone survey, by an AI interviewer"',
      "202-555-0144,XX,Mars/Olympus,R_2,,,,",
      "202-555-0145,TX,,R_3,Qualtrics R_3,2026-11-01,phone_call,Phone survey",
      "911,,,,,,,",
    ].join("\r\n");
    const rows = readContactsCsv(csv);
    expect(rows[0]).toMatchObject({ line: 2, stateCode: "DC", externalRef: "R_1", problems: [], consent: { method: "web_form", obtainedAt: "2026-11-01T12:00:00.000Z", scope: "Phone survey, by an AI interviewer" } });
    expect(rows[1]).toMatchObject({ consent: null, stateCode: null, timezone: null });
    expect(rows[1]!.problems).toEqual(['state "XX" is not a US state code', 'timezone "Mars/Olympus" is not recognised', "no consent on file; this person cannot be called"]);
    expect(rows[2]!.consent).toBeNull();
    expect(rows[2]!.problems[0]).toMatch(/consent_method must be one of/);
    expect(rows[3]!.problems[0]).toMatch(/never called/);
  });
});
