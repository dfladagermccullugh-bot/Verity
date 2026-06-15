import { describe, it, expect } from "vitest";
import { classifyDimension, DIMENSIONS, TRACKED_DIMENSIONS } from "@/lib/dimensions";

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
