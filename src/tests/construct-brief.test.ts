import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the Anthropic helper before the module under test imports it.
vi.mock("@/lib/anthropic", () => ({
  callModelOneShot: vi.fn(),
}));

import { callModelOneShot } from "@/lib/anthropic";
import {
  buildConstructBrief,
  briefToMarkdown,
  type ConstructBriefJson,
} from "@/lib/construct-brief";

const mocked = callModelOneShot as unknown as ReturnType<typeof vi.fn>;

const SEED = "A puzzle app for 6–8 year olds that teaches multiplication.";

const FIXTURE: ConstructBriefJson = {
  goal: "A PRD for a children's educational puzzle game focused on multiplication facts.",
  scope:
    "In bounds: gameplay, age-appropriate difficulty, parent-visible progress. Out of bounds: monetization, hardware design, classroom LMS integration.",
  inBoundsExamples: ["target age range", "difficulty progression", "session length"],
  outOfBoundsExamples: ["business model", "physical packaging"],
};

beforeEach(() => {
  mocked.mockReset();
});

describe("briefToMarkdown", () => {
  const md = briefToMarkdown(FIXTURE);

  it("renders all four required sections as h2 headings", () => {
    expect(md).toMatch(/## Goal/);
    expect(md).toMatch(/## Scope/);
    expect(md).toMatch(/## In bounds/);
    expect(md).toMatch(/## Out of bounds/);
  });

  it("includes the goal sentence verbatim", () => {
    expect(md).toContain(FIXTURE.goal);
  });

  it("includes the scope sentence verbatim", () => {
    expect(md).toContain(FIXTURE.scope);
  });

  it("renders examples as markdown list items", () => {
    for (const ex of FIXTURE.inBoundsExamples) expect(md).toContain(`- ${ex}`);
    for (const ex of FIXTURE.outOfBoundsExamples) expect(md).toContain(`- ${ex}`);
  });
});

describe("buildConstructBrief", () => {
  it("returns markdown when the model returns valid JSON", async () => {
    mocked.mockResolvedValueOnce(JSON.stringify(FIXTURE));
    const md = await buildConstructBrief(SEED);
    expect(md).not.toBeNull();
    expect(md).toMatch(/## Goal/);
    expect(md).toMatch(/## Scope/);
    expect(md).toMatch(/## In bounds/);
    expect(md).toMatch(/## Out of bounds/);
  });

  it("accepts JSON wrapped in a ```json fence", async () => {
    mocked.mockResolvedValueOnce("```json\n" + JSON.stringify(FIXTURE) + "\n```");
    const md = await buildConstructBrief(SEED);
    expect(md).toContain(FIXTURE.goal);
  });

  it("returns null on unparseable model output rather than throwing", async () => {
    mocked.mockResolvedValueOnce("I don't really feel like answering that.");
    const md = await buildConstructBrief(SEED);
    expect(md).toBeNull();
  });

  it("returns null when required fields are missing", async () => {
    mocked.mockResolvedValueOnce(
      JSON.stringify({ goal: "...", scope: "..." }), // examples arrays missing
    );
    const md = await buildConstructBrief(SEED);
    expect(md).toBeNull();
  });

  it("returns null when examples are not string arrays", async () => {
    mocked.mockResolvedValueOnce(
      JSON.stringify({
        goal: "g",
        scope: "s",
        inBoundsExamples: [1, 2, 3],
        outOfBoundsExamples: ["x"],
      }),
    );
    const md = await buildConstructBrief(SEED);
    expect(md).toBeNull();
  });

  it("passes the seed through to the model call", async () => {
    mocked.mockResolvedValueOnce(JSON.stringify(FIXTURE));
    await buildConstructBrief(SEED);
    const [, userMessage] = mocked.mock.calls[0];
    expect(userMessage).toContain(SEED);
  });
});
