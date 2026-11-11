/**
 * Phone-number parsing and the "never dial" rules.
 *
 * Origin: phone_map `server/util/phone.ts`. Changed here: the fictional 555-01xx demo numbers
 * and demo mode are gone (they served the IVR simulator). `checkCallable` is stricter, because
 * this product calls people, not company switchboards: toll-free numbers are no longer exempt
 * from the country rule, a number whose country cannot be determined is refused, and an empty
 * country list allows nothing instead of everything.
 */

import { parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js/max";

export interface NormalizedNumber {
  e164: string;
  country: string | null;
  national: string;
  display: string;
  tollFree: boolean;
  type: string | null;
}

const US_TOLL_FREE = /^\+1(800|833|844|855|866|877|888)\d{7}$/;

export function normalizePhone(input: string, defaultCountry: CountryCode = "US"): NormalizedNumber | null {
  // U+2010 to U+2015 are the typographic hyphens and dashes that pasted numbers often carry.
  const cleaned = input.trim().replace(/^tel:/i, "").replace(/[\u2010-\u2015]/g, "-");
  // Convert vanity letters (1-800-FLOWERS) to digits, but only if the input has some digits.
  const devanitized = /\d{3}/.test(cleaned) ? vanityToDigits(cleaned) : cleaned;
  const parsed = parsePhoneNumberFromString(devanitized, defaultCountry);
  if (!parsed || !parsed.isValid()) return null;
  const e164 = parsed.number;
  const type = parsed.getType() ?? null;
  return {
    e164,
    country: parsed.country ?? null,
    national: parsed.formatNational(),
    display: parsed.country === "US" || parsed.country === "CA" ? parsed.formatNational() : parsed.formatInternational(),
    tollFree: type === "TOLL_FREE" || US_TOLL_FREE.test(e164),
    type,
  };
}

export function vanityToDigits(s: string): string {
  const map: Record<string, string> = {
    A: "2", B: "2", C: "2", D: "3", E: "3", F: "3", G: "4", H: "4", I: "4", J: "5", K: "5", L: "5",
    M: "6", N: "6", O: "6", P: "7", Q: "7", R: "7", S: "7", T: "8", U: "8", V: "8", W: "9", X: "9", Y: "9", Z: "9",
  };
  return s.replace(/[A-Za-z]/g, (ch) => map[ch.toUpperCase()] ?? ch);
}

export function displayPhone(e164: string): string {
  return normalizePhone(e164)?.display ?? e164;
}

export interface CallableCheck {
  ok: boolean;
  reason?: string;
}

/** Guard rails: never dial emergency, premium-rate, or out-of-region numbers. */
export function checkCallable(e164: string, allowedCountries: string[]): CallableCheck {
  const digits = e164.replace(/\D/g, "");
  // Checked before validity so the reason is the specific one.
  if (/^1?(\d11)$/.test(digits) || ["911", "112", "999", "000", "110", "119"].includes(digits)) {
    return { ok: false, reason: "Emergency and N11 service numbers are never called." };
  }
  const n = normalizePhone(e164);
  if (!n) return { ok: false, reason: "Not a valid phone number." };
  if (/^\+1(900|976)\d{7}$/.test(e164) || n.type === "PREMIUM_RATE" || n.type === "SHARED_COST") {
    return { ok: false, reason: "Premium-rate numbers are never called." };
  }
  if (!n.country || !allowedCountries.includes(n.country)) {
    return { ok: false, reason: `Calling numbers in ${n.country ?? "an unknown country"} is not enabled.` };
  }
  return { ok: true };
}
