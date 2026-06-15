import { describe, it, expect } from "vitest";
import { seedWarnings } from "@/lib/seed-quality";

describe("seedWarnings", () => {
  it("flags a double-barreled seed", () => {
    expect(seedWarnings("A CRM and a billing tool for freelancers")).toContain(
      "double_barreled"
    );
  });

  it("flags a coercive presupposition", () => {
    expect(
      seedWarnings("The best app everyone needs for tracking water intake daily")
    ).toContain("presupposition");
  });

  it("flags a vague seed", () => {
    expect(seedWarnings("An app for stuff and things")).toContain("vague");
  });

  it("flags a too-short seed", () => {
    expect(seedWarnings("a todo app")).toContain("too_short");
  });

  it("returns no warnings for a clean, specific seed", () => {
    expect(
      seedWarnings("A puzzle app for 6-8 year olds that teaches multiplication")
    ).toEqual([]);
  });
});
