import { describe, it, expect } from "vitest";
import {
  classifyDimension,
  DIMENSIONS,
  TRACKED_DIMENSIONS,
  isMirrorQuestion,
} from "@/lib/dimensions";

describe("classifyDimension", () => {
  it("maps a user-targeting question to primary_user", () => {
    expect(classifyDimension("Is this mainly for parents?")).toBe("primary_user");
  });

  it("maps a device question to platform_context", () => {
    expect(classifyDimension("Will people use this on a phone?")).toBe(
      "platform_context"
    );
  });

  it("maps a privacy question to data_sensitivity", () => {
    expect(classifyDimension("Will it store sensitive personal data?")).toBe(
      "data_sensitivity"
    );
  });

  it("maps an integration question to integrations", () => {
    expect(classifyDimension("Should it connect to your calendar?")).toBe(
      "integrations"
    );
  });

  it("maps a success-metric question to success_signal", () => {
    expect(classifyDimension("Is long-term retention the key measure of success?")).toBe(
      "success_signal"
    );
  });

  it("returns unclassified when no keyword matches", () => {
    expect(classifyDimension("Hmm?")).toBe("unclassified");
  });
});

describe("dimension tables", () => {
  it("tracks exactly ten substantive dimensions", () => {
    expect(TRACKED_DIMENSIONS).toHaveLength(10);
    expect(DIMENSIONS).toHaveLength(10);
  });
});

describe("isMirrorQuestion", () => {
  it("recognizes the skill's mirror turn", () => {
    expect(isMirrorQuestion("So you want a bottle that reminds you to drink. Ready?")).toBe(true);
    expect(isMirrorQuestion("A habit tracker for kids — ready ?")).toBe(true);
  });
  it("does not match ordinary questions", () => {
    expect(isMirrorQuestion("Is this for adults?")).toBe(false);
    expect(isMirrorQuestion("Is it ready for launch soon?")).toBe(false);
  });
});
