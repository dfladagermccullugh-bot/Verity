import { describe, it, expect } from "vitest";
import { MAX_ANSWER_MS, isTurnId, sanitizeParadata } from "@/lib/action-input";

describe("isTurnId", () => {
  it("accepts a uuid", () => {
    expect(isTurnId("3f2b8c1e-9a4d-4c7e-8f1a-2b3c4d5e6f70")).toBe(true);
  });
  it("rejects anything else", () => {
    for (const v of ["", "abc", 42, null, undefined, "3f2b8c1e-9a4d-4c7e-8f1a-2b3c4d5e6f70; drop"])
      expect(isTurnId(v)).toBe(false);
  });
});

describe("sanitizeParadata", () => {
  it("keeps plausible values", () => {
    expect(
      sanitizeParadata({ timeToAnswerMs: 1234.6, deviceClass: "mobile", viewport: "390x844" })
    ).toEqual({ timeToAnswerMs: 1235, deviceClass: "mobile", viewport: "390x844" });
  });

  it("clamps an idle-tab latency", () => {
    expect(sanitizeParadata({ timeToAnswerMs: 9e12 }).timeToAnswerMs).toBe(MAX_ANSWER_MS);
  });

  it("nulls negative, non-finite and non-numeric latencies", () => {
    for (const v of [-1, NaN, Infinity, "500", null])
      expect(sanitizeParadata({ timeToAnswerMs: v }).timeToAnswerMs).toBeNull();
  });

  it("nulls unknown device classes and malformed viewports", () => {
    const p = sanitizeParadata({ deviceClass: "fridge", viewport: "<script>" });
    expect(p.deviceClass).toBeNull();
    expect(p.viewport).toBeNull();
  });

  it("tolerates a missing or non-object payload", () => {
    const empty = { timeToAnswerMs: null, deviceClass: null, viewport: null };
    expect(sanitizeParadata(undefined)).toEqual(empty);
    expect(sanitizeParadata("x")).toEqual(empty);
  });
});
