import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/anthropic", () => ({
  callModelOneShot: vi.fn(),
}));

import { callModelOneShot } from "@/lib/anthropic";
import { parseCritic, critiqueRound } from "@/lib/critic";

const mocked = callModelOneShot as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  mocked.mockReset();
});

describe("parseCritic", () => {
  it("parses a well-formed open-round result", () => {
    const r = parseCritic(
      JSON.stringify({
        openNewRound: true,
        gaps: ["pricing", "scale"],
        focus: "Probe pricing model and expected user volume.",
      })
    );
    expect(r.openNewRound).toBe(true);
    expect(r.gaps).toHaveLength(2);
    expect(r.focus).toMatch(/pricing/);
  });

  it("parses a stop result", () => {
    const r = parseCritic(JSON.stringify({ openNewRound: false, gaps: [], focus: "" }));
    expect(r.openNewRound).toBe(false);
  });

  it("refuses to open a round without a focus to steer it", () => {
    const r = parseCritic(JSON.stringify({ openNewRound: true, gaps: ["x"], focus: "" }));
    expect(r.openNewRound).toBe(false);
  });

  it("tolerates a fenced JSON block", () => {
    const r = parseCritic('```json\n{"openNewRound":false,"gaps":[],"focus":""}\n```');
    expect(r.openNewRound).toBe(false);
  });

  it("fails safe (no new round) on malformed output", () => {
    expect(parseCritic("not json at all").openNewRound).toBe(false);
    expect(parseCritic("{").openNewRound).toBe(false);
  });
});

describe("critiqueRound", () => {
  it("returns the parsed critic decision", async () => {
    mocked.mockResolvedValueOnce(
      JSON.stringify({ openNewRound: true, gaps: ["g"], focus: "Probe g." })
    );
    const r = await critiqueRound("seed", "Q1: ?\nA: yes", "===PRD===\nbody");
    expect(r.openNewRound).toBe(true);
  });

  it("fails safe when the model call throws", async () => {
    mocked.mockRejectedValueOnce(new Error("boom"));
    const r = await critiqueRound("seed", "transcript", "prd");
    expect(r.openNewRound).toBe(false);
  });
});
