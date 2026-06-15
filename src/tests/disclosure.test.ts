import { describe, it, expect } from "vitest";
import {
  buildPrdHeader,
  buildMethodologyDocument,
  buildAnalysisDocument,
  prdFilename,
  methodologyFilename,
  analysisFilename,
} from "@/lib/disclosure";
import { computeAnalysis } from "@/lib/analysis";
import { getSkillVersion } from "@/lib/skill/version";
import { getModelName } from "@/lib/anthropic";

const SESSION_ID = "11111111-2222-3333-4444-555555555555";
const DATE = "2026-06-03";

describe("filename helpers", () => {
  it("derives the PRD filename from the session ID", () => {
    expect(prdFilename(SESSION_ID)).toBe(`prd-${SESSION_ID}.md`);
  });

  it("derives the methodology filename from the session ID", () => {
    expect(methodologyFilename(SESSION_ID)).toBe(`methodology-${SESSION_ID}.md`);
  });
});

describe("buildPrdHeader — invisible link to companion methodology", () => {
  const header = buildPrdHeader({ sessionId: SESSION_ID, date: DATE });

  it("is an HTML comment so it does not render in markdown viewers", () => {
    const firstLine = header.split("\n")[0];
    expect(firstLine.startsWith("<!--")).toBe(true);
    expect(firstLine.endsWith("-->")).toBe(true);
  });

  it("includes the session ID for cross-document linking", () => {
    expect(header).toContain(SESSION_ID);
  });

  it("names the companion methodology filename", () => {
    expect(header).toContain(methodologyFilename(SESSION_ID));
  });

  it("includes the generation date", () => {
    expect(header).toContain(DATE);
  });

  it("ends with a blank line so the comment is not glued to the PRD body", () => {
    expect(header.endsWith("\n\n")).toBe(true);
  });
});

describe("buildMethodologyDocument — AAPOR Required Disclosures", () => {
  const doc = buildMethodologyDocument({ sessionId: SESSION_ID, date: DATE });

  it("opens with an HTML-comment header linking back to the companion PRD", () => {
    const firstLine = doc.split("\n")[0];
    expect(firstLine).toContain(SESSION_ID);
    expect(firstLine).toContain(prdFilename(SESSION_ID));
  });

  it("uses a clear top-level heading", () => {
    expect(doc).toMatch(/^<!--.*-->\n\n# Methodology Disclosure\n/);
  });

  it("includes a visible human-readable companion PRD reference", () => {
    expect(doc).toContain(`**Companion PRD:** \`${prdFilename(SESSION_ID)}\``);
  });

  it("cites the AAPOR 2026 framework by name", () => {
    expect(doc).toMatch(/AAPOR Task Force on Responsible AI Integration/);
  });

  it("discloses the AI tasks performed (Interviewer + Analyst)", () => {
    expect(doc).toMatch(/## Tasks performed by AI/);
    expect(doc).toMatch(/Interviewer/);
    expect(doc).toMatch(/Analyst/);
  });

  it("includes a plain-language role description", () => {
    expect(doc).toMatch(/## Description of AI's role/);
  });

  it("discloses human oversight and validation", () => {
    expect(doc).toMatch(/## Human oversight and validation/);
  });

  it("discloses N = 1 human respondent and absence of synthetic data", () => {
    expect(doc).toMatch(/## Human respondents/);
    expect(doc).toMatch(/N = 1/);
    expect(doc).toMatch(/No synthetic responses/);
  });

  it("interpolates the live model name", () => {
    expect(doc).toContain(`\`${getModelName()}\``);
  });

  it("interpolates the system-prompt SHA-256 fingerprint", () => {
    expect(doc).toContain(`\`${getSkillVersion()}\``);
  });

  it("interpolates the supplied date verbatim", () => {
    expect(doc).toContain(DATE);
  });

  it("defaults to today's date when none is supplied", () => {
    const d = buildMethodologyDocument({ sessionId: SESSION_ID });
    const today = new Date().toISOString().slice(0, 10);
    expect(d).toContain(today);
  });

  it("omits the construct-validity probe line by default", () => {
    expect(doc).not.toMatch(/Construct-validity probe/);
  });

  it("includes the construct-validity probe line only when one was logged", () => {
    const withProbe = buildMethodologyDocument({
      sessionId: SESSION_ID,
      date: DATE,
      constructBriefPresent: true,
    });
    expect(withProbe).toMatch(/\*\*Construct-validity probe:\*\*/);
    expect(withProbe).toMatch(/AAPOR §4\.3\.1/);
  });

  it("discloses adaptive tailoring as a deliberate departure", () => {
    expect(doc).toMatch(/adaptively tailored/);
  });

  it("discloses the deterministic anti-leading check", () => {
    expect(doc).toMatch(/anti-leading/);
  });

  it("defaults the PRD version to 1 and reflects a supplied version", () => {
    expect(doc).toMatch(/\*\*PRD version \(round\):\*\* 1/);
    const v2 = buildMethodologyDocument({
      sessionId: SESSION_ID,
      date: DATE,
      prdVersion: 2,
    });
    expect(v2).toMatch(/\*\*PRD version \(round\):\*\* 2/);
  });

  it("references the analysis companion only when present", () => {
    expect(doc).not.toMatch(/Response-quality analysis/);
    const withAnalysis = buildMethodologyDocument({
      sessionId: SESSION_ID,
      date: DATE,
      analysisPresent: true,
    });
    expect(withAnalysis).toMatch(/Response-quality analysis/);
    expect(withAnalysis).toContain(analysisFilename(SESSION_ID));
  });
});

describe("buildAnalysisDocument — companion analysis file", () => {
  const analysis = computeAnalysis([
    { answer: "yes", timeToAnswerMs: 1500, constructDimension: "problem", leadingVerdict: "clean" },
    { answer: "no", timeToAnswerMs: 2500, constructDimension: "scale", leadingVerdict: "clean" },
  ]);
  const doc = buildAnalysisDocument({ sessionId: SESSION_ID, date: DATE, analysis, prdVersion: 2 });

  it("derives the analysis filename from the session ID", () => {
    expect(analysisFilename(SESSION_ID)).toBe(`analysis-${SESSION_ID}.md`);
  });

  it("opens with an HTML-comment header linking to the companion PRD and version", () => {
    const firstLine = doc.split("\n")[0];
    expect(firstLine.startsWith("<!--")).toBe(true);
    expect(firstLine).toContain(SESSION_ID);
    expect(firstLine).toContain("PRD v2");
    expect(firstLine).toContain(prdFilename(SESSION_ID));
  });

  it("renders the analysis body", () => {
    expect(doc).toMatch(/# Response-Quality Analysis/);
  });
});
