// Origin: the phone-number cases in phone_map `test/discovery.test.ts`, without the demo numbers.

import { describe, expect, it } from "vitest";
import { checkCallable, displayPhone, normalizePhone, vanityToDigits } from "../src/util/phone.js";

describe("normalizePhone", () => {
  it("reads the ways a US number is commonly written", () => {
    for (const written of ["+12025550143", "(202) 555-0143", "202-555-0143", "1 202 555 0143", "tel:+1-202-555-0143", "+1‐202–555—0143"]) {
      expect(normalizePhone(written)?.e164, written).toBe("+12025550143");
    }
  });

  it("reports country, display form and toll-free status", () => {
    expect(normalizePhone("+12025550143")).toMatchObject({ country: "US", display: "(202) 555-0143", tollFree: false });
    expect(normalizePhone("+44 20 7946 0958")).toMatchObject({ e164: "+442079460958", country: "GB", display: "+44 20 7946 0958" });
    expect(normalizePhone("1-800-FLOWERS")).toMatchObject({ e164: "+18003569377", tollFree: true });
  });

  it("returns null for anything that is not a valid number", () => {
    for (const bad of ["", "hello", "12345", "+1 202 555", "+19765551234"]) expect(normalizePhone(bad), bad).toBeNull();
  });

  it("turns vanity letters into digits and formats for display", () => {
    expect(vanityToDigits("1-800-FLOWERS")).toBe("1-800-3569377");
    expect(displayPhone("+12025550143")).toBe("(202) 555-0143");
    expect(displayPhone("not a number")).toBe("not a number");
  });
});

describe("checkCallable", () => {
  it("allows an ordinary number in an enabled country", () => {
    expect(checkCallable("+12025550143", ["US"])).toEqual({ ok: true });
  });

  it("never allows emergency or N11 service numbers", () => {
    for (const n of ["911", "+1911", "1411", "112", "999"]) {
      expect(checkCallable(n, ["US", "GB"]), n).toEqual({ ok: false, reason: "Emergency and N11 service numbers are never called." });
    }
  });

  it("never allows premium-rate numbers", () => {
    expect(checkCallable("+19005551234", ["US"])).toEqual({ ok: false, reason: "Premium-rate numbers are never called." });
  });

  it("refuses countries that are not enabled", () => {
    expect(checkCallable("+442079460958", ["US"])).toEqual({ ok: false, reason: "Calling numbers in GB is not enabled." });
    expect(checkCallable("+14165550123", ["US"]).ok).toBe(false);
    expect(checkCallable("+14165550123", ["US", "CA"]).ok).toBe(true);
  });

  it("allows nothing when no country is enabled", () => {
    expect(checkCallable("+12025550143", []).ok).toBe(false);
  });

  it("refuses what is not a phone number", () => {
    expect(checkCallable("hello", ["US"])).toEqual({ ok: false, reason: "Not a valid phone number." });
  });
});
