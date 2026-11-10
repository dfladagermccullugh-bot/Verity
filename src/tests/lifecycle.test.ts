import { describe, it, expect } from "vitest";
import {
  ANSWERS,
  SESSION_STATUSES,
  SESSION_TRANSITIONS,
  canTransition,
  canTransitionRound,
  deriveOperatorState,
  deriveRespondentView,
  isAnswer,
  isSessionStatus,
} from "@/lib/lifecycle";

const future = new Date(Date.now() + 86_400_000);
const past = new Date(Date.now() - 86_400_000);
const invite = { consumedAt: null, expiresAt: future };

describe("vocabularies", () => {
  it("accepts only yes/no/done as answers", () => {
    for (const a of ANSWERS) expect(isAnswer(a)).toBe(true);
    expect(isAnswer("maybe")).toBe(false);
    expect(isAnswer("YES")).toBe(false);
    expect(isAnswer(undefined)).toBe(false);
    expect(isAnswer(1)).toBe(false);
  });

  it("recognizes session statuses", () => {
    for (const s of SESSION_STATUSES) expect(isSessionStatus(s)).toBe(true);
    expect(isSessionStatus("abandoned")).toBe(false);
  });
});

describe("transitions", () => {
  it("allows the documented session edges", () => {
    expect(canTransition("active", "awaiting_review")).toBe(true);
    expect(canTransition("awaiting_review", "active")).toBe(true);
    expect(canTransition("awaiting_review", "complete")).toBe(true);
    expect(canTransition("active", "complete")).toBe(true);
  });

  it("makes complete terminal", () => {
    for (const s of SESSION_STATUSES) expect(canTransition("complete", s)).toBe(false);
    expect(SESSION_TRANSITIONS.complete).toEqual([]);
  });

  it("forbids self-loops", () => {
    for (const s of SESSION_STATUSES) expect(canTransition(s, s)).toBe(false);
  });

  it("rounds only go in_progress → complete", () => {
    expect(canTransitionRound("in_progress", "complete")).toBe(true);
    expect(canTransitionRound("complete", "in_progress")).toBe(false);
  });
});

describe("deriveRespondentView", () => {
  it("is invalid without an invite", () => {
    expect(deriveRespondentView({ invite: null, session: null, hasPendingTurn: false })).toBe(
      "invalid"
    );
  });

  it("shows the seed form for a fresh invite", () => {
    expect(deriveRespondentView({ invite, session: null, hasPendingTurn: false })).toBe("seed");
  });

  it("distinguishes consumed and expired invites without a session", () => {
    expect(
      deriveRespondentView({
        invite: { consumedAt: past, expiresAt: future },
        session: null,
        hasPendingTurn: false,
      })
    ).toBe("consumed");
    expect(
      deriveRespondentView({
        invite: { consumedAt: null, expiresAt: past },
        session: null,
        hasPendingTurn: false,
      })
    ).toBe("expired");
  });

  it("lets an existing session outrank invite expiry", () => {
    expect(
      deriveRespondentView({
        invite: { consumedAt: null, expiresAt: past },
        session: { status: "active" },
        hasPendingTurn: true,
      })
    ).toBe("question");
  });

  it("routes an active session with no pending turn to preparing (resume)", () => {
    expect(
      deriveRespondentView({ invite, session: { status: "active" }, hasPendingTurn: false })
    ).toBe("preparing");
  });

  it("rests on done while awaiting review, and returns to the question once a round opens", () => {
    expect(
      deriveRespondentView({
        invite,
        session: { status: "awaiting_review" },
        hasPendingTurn: false,
      })
    ).toBe("done");
    expect(
      deriveRespondentView({ invite, session: { status: "active" }, hasPendingTurn: true })
    ).toBe("question");
  });

  it("is done for a complete session even if a stray turn is pending", () => {
    expect(
      deriveRespondentView({ invite, session: { status: "complete" }, hasPendingTurn: true })
    ).toBe("done");
  });

  it("never routes an unknown status to generation", () => {
    expect(
      deriveRespondentView({ invite, session: { status: "weird" }, hasPendingTurn: false })
    ).toBe("done");
  });
});

describe("deriveOperatorState", () => {
  it("maps statuses and pending turns", () => {
    expect(deriveOperatorState({ status: "active", hasPendingTurn: true })).toBe(
      "awaiting_respondent"
    );
    expect(deriveOperatorState({ status: "active", hasPendingTurn: false })).toBe("stalled");
    expect(deriveOperatorState({ status: "awaiting_review", hasPendingTurn: false })).toBe(
      "awaiting_review"
    );
    expect(deriveOperatorState({ status: "complete", hasPendingTurn: false })).toBe("complete");
  });

  it("does not label an unknown status as complete", () => {
    expect(deriveOperatorState({ status: "legacy", hasPendingTurn: false })).toBe("unknown");
  });
});
