/** Reading a contact list: phone numbers, where each person is, and proof of consent. */

import { parseCsvObjects } from "../util/csv.js";
import { STATE_ZONES, isValidTimeZone } from "./hours.js";
import { CONSENT_METHODS, type ConsentRecord } from "./rules.js";
import type { NewContact } from "./store.js";

export type PhoneResult = { ok: true; e164: string } | { ok: false; reason: string };

/**
 * US numbers only, for now. Refuses numbers that must never be auto-dialled: emergency and N11
 * service codes, and premium-rate (900/976) numbers.
 */
export function normalizeUsPhone(raw: string): PhoneResult {
  const digits = raw.replace(/[^\d+]/g, "").replace(/^\+/, "");
  const ten = digits.length === 11 && digits[0] === "1" ? digits.slice(1) : digits;
  if (/^\d11$/.test(digits) || ["911", "112", "999"].includes(digits)) return { ok: false, reason: "emergency and service codes are never called" };
  if (ten.length !== 10) return { ok: false, reason: "not a 10-digit US number" };
  const area = ten.slice(0, 3);
  const exchange = ten.slice(3, 6);
  if (!/^[2-9]/.test(area) || !/^[2-9]/.test(exchange)) return { ok: false, reason: "not a valid US number" };
  if (/^[2-9]11$/.test(area) || /^[2-9]11$/.test(exchange)) return { ok: false, reason: "emergency and service codes are never called" };
  if (area === "900" || area === "976" || exchange === "976") return { ok: false, reason: "premium-rate numbers are never called" };
  return { ok: true, e164: `+1${ten}` };
}

export interface ContactRow extends NewContact {
  /** 1-based line number in the file, for error messages. */
  line: number;
  problems: string[];
}

/**
 * Columns (header names, any order): phone (required); state; timezone; external_ref;
 * consent_source, consent_at, consent_method, consent_scope. A row without complete consent
 * columns is kept, but with no consent on file it can never be called.
 */
export function readContactsCsv(text: string): ContactRow[] {
  return parseCsvObjects(text).map((r, i) => {
    const problems: string[] = [];
    const phone = r.phone ?? "";
    const check = normalizeUsPhone(phone);
    if (!check.ok) problems.push(`phone: ${check.reason}`);
    const stateCode = (r.state ?? "").toUpperCase() || null;
    if (stateCode && !STATE_ZONES[stateCode]) problems.push(`state "${r.state}" is not a US state code`);
    const timezone = r.timezone || null;
    if (timezone && !isValidTimeZone(timezone)) problems.push(`timezone "${timezone}" is not recognised`);
    let consent: ConsentRecord | null = null;
    const given = [r.consent_source, r.consent_at, r.consent_method, r.consent_scope].filter((v) => v && v !== "").length;
    if (given === 4) {
      const method = r.consent_method as ConsentRecord["method"];
      if (!(CONSENT_METHODS as readonly string[]).includes(method)) problems.push(`consent_method must be one of ${CONSENT_METHODS.join(", ")}`);
      else if (!Number.isFinite(Date.parse(r.consent_at!))) problems.push("consent_at is not a date");
      else consent = { source: r.consent_source!, obtainedAt: new Date(r.consent_at!).toISOString(), method, scope: r.consent_scope! };
    } else if (given > 0) problems.push("consent columns are incomplete; treated as no consent");
    else problems.push("no consent on file; this person cannot be called");
    return { line: i + 2, phone, externalRef: r.external_ref || null, timezone: timezone && isValidTimeZone(timezone) ? timezone : null, stateCode: stateCode && STATE_ZONES[stateCode] ? stateCode : null, consent, problems };
  });
}
