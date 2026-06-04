import { describe, it, expect } from "vitest";
import { buildMethodologyFooter } from "@/lib/disclosure";
import { getSkillVersion } from "@/lib/skill/version";
import { getModelName } from "@/lib/anthropic";

describe("buildMethodologyFooter — AAPOR Required Disclosures", () => {
  const footer = buildMethodologyFooter({ date: "2026-06-03" });

  it("starts with a horizontal rule and a Methodology heading", () => {
    expect(footer).toMatch(/\n---\n\n## Methodology\n/);
  });

  it("cites the AAPOR 2026 framework by name", () => {
    expect(footer).toMatch(/AAPOR Task Force on Responsible AI Integration/);
  });

  it("discloses the AI tasks performed (Interviewer + Analyst)", () => {
    expect(footer).toMatch(/Tasks performed by AI/);
    expect(footer).toMatch(/Interviewer/);
    expect(footer).toMatch(/Analyst/);
  });

  it("includes a plain-language role description", () => {
    expect(footer).toMatch(/Description of AI's role/);
  });

  it("discloses human oversight and validation", () => {
    expect(footer).toMatch(/Human oversight and validation/);
  });

  it("discloses N = 1 human respondent and absence of synthetic data", () => {
    expect(footer).toMatch(/Human respondents.*N = 1/s);
    expect(footer).toMatch(/No synthetic responses/);
  });

  it("interpolates the live model name", () => {
    expect(footer).toContain(`\`${getModelName()}\``);
  });

  it("interpolates the system-prompt SHA-256 fingerprint", () => {
    expect(footer).toContain(`\`${getSkillVersion()}\``);
  });

  it("interpolates the supplied date verbatim", () => {
    expect(footer).toContain("2026-06-03");
  });

  it("defaults to today's date when none is supplied", () => {
    const f = buildMethodologyFooter();
    const today = new Date().toISOString().slice(0, 10);
    expect(f).toContain(today);
  });
});
