import { describe, it, expect } from "vitest";
import { guardOutput, STOP_CONFIRM } from "@/lib/guard";

describe("guardOutput — PRD path", () => {
  it("recognizes a PRD payload and strips the marker", () => {
    const r = guardOutput("===PRD===\n# One-line pitch\nA thing.");
    expect(r.kind).toBe("prd");
    if (r.kind === "prd") expect(r.markdown).toBe("# One-line pitch\nA thing.");
  });

  it("strips the marker plus surrounding whitespace", () => {
    const r = guardOutput("   ===PRD===   \n\nbody here");
    expect(r.kind).toBe("prd");
    if (r.kind === "prd") expect(r.markdown).toBe("body here");
  });
});

describe("guardOutput — stop confirmation path", () => {
  it("matches the exact confirmation string", () => {
    expect(guardOutput(STOP_CONFIRM).kind).toBe("stop_confirm");
  });

  it("matches case-insensitively", () => {
    expect(guardOutput(STOP_CONFIRM.toUpperCase()).kind).toBe("stop_confirm");
  });

  it("matches with surrounding whitespace", () => {
    expect(guardOutput(`  ${STOP_CONFIRM}  `).kind).toBe("stop_confirm");
  });
});

describe("guardOutput — valid question path", () => {
  it("accepts a single plain yes/no question", () => {
    const r = guardOutput("Is this meant for parents?");
    expect(r.kind).toBe("question");
    if (r.kind === "question") expect(r.text).toBe("Is this meant for parents?");
  });

  it("trims whitespace around an accepted question", () => {
    const r = guardOutput("  Will people use this on a phone?  ");
    expect(r.kind).toBe("question");
    if (r.kind === "question") expect(r.text).toBe("Will people use this on a phone?");
  });
});

describe("guardOutput — rejections", () => {
  it("rejects when there is no question mark", () => {
    expect(guardOutput("This is a statement.")).toEqual({
      kind: "reject",
      reason: "no_question_mark",
    });
  });

  it("rejects multiline output (commentary stapled to a question)", () => {
    expect(guardOutput("Great!\nIs it for kids?")).toEqual({
      kind: "reject",
      reason: "multiline",
    });
  });

  it("rejects questions longer than 200 chars", () => {
    const long = "Is " + "x".repeat(220) + "?";
    expect(guardOutput(long)).toEqual({ kind: "reject", reason: "too_long" });
  });

  it("rejects batched questions joined with 'and' (two question marks after 'and')", () => {
    expect(guardOutput("Is it for kids and adults? Is it free?")).toEqual({
      kind: "reject",
      reason: "batched",
    });
  });

  it("rejects batched questions joined with 'or' (two question marks after 'or')", () => {
    expect(guardOutput("Is it for kids or adults? Is it free?")).toEqual({
      kind: "reject",
      reason: "batched",
    });
  });

  it("rejects multiple question marks when no and/or is between them", () => {
    expect(guardOutput("Really? Is it for kids?")).toEqual({
      kind: "reject",
      reason: "multiple_questions",
    });
  });

  it("documents the spec gap: a single-'?' 'and'-stapled question slips through as a question", () => {
    // The spec's batched rule requires TWO '?' after the and/or, so a
    // single-sentence staple with one '?' is accepted. Implemented exactly
    // as specified; the SKILL.md instruction is the primary defense here.
    const r = guardOutput("Is it for kids and is it also for adults?");
    expect(r.kind).toBe("question");
  });

  it("rejects jargon questions (database)", () => {
    expect(guardOutput("Should this use a database?")).toEqual({
      kind: "reject",
      reason: "jargon:database",
    });
  });

  it("rejects jargon questions (framework)", () => {
    expect(guardOutput("Do you want a specific framework?")).toEqual({
      kind: "reject",
      reason: "jargon:framework",
    });
  });

  it("documents the spec's substring matching: 'api' inside an ordinary word is rejected", () => {
    // Per spec the blocklist uses includes(); 'capitalize' contains 'api'.
    // Implemented exactly as specified — this test pins that behavior.
    expect(guardOutput("Should names be capitalized?")).toEqual({
      kind: "reject",
      reason: "jargon:api",
    });
  });
});

describe("guardOutput — precedence", () => {
  it("PRD marker wins even if body would otherwise look like a question", () => {
    expect(guardOutput("===PRD===\nIs this a question?").kind).toBe("prd");
  });

  it("rejects a question-mark string that contains jargon before accepting", () => {
    const r = guardOutput("Will it connect to an external API?");
    expect(r.kind).toBe("reject");
  });
});
