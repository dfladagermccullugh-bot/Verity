import { NextResponse } from "next/server";
import { asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { rounds, sessions, turns } from "@/lib/db/schema";
import { isAdmin } from "@/lib/session";
import { computeAnalysis } from "@/lib/analysis";

export const dynamic = "force-dynamic";

function parseJsonArray(s: string | null): unknown[] {
  if (!s) return [];
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

export async function GET() {
  if (!(await isAdmin())) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const allSessions = await db.select().from(sessions);
  const versions = new Set<string>();
  const exported: unknown[] = [];

  for (const s of allSessions) {
    versions.add(s.skillVersion);

    const sessionRounds = await db
      .select()
      .from(rounds)
      .where(eq(rounds.sessionId, s.id))
      .orderBy(asc(rounds.roundNumber));

    const sessionTurns = await db
      .select()
      .from(turns)
      .where(eq(turns.sessionId, s.id))
      .orderBy(asc(turns.step));

    const roundPayloads = sessionRounds.map((r) => {
      const roundTurns = sessionTurns.filter((t) => t.roundId === r.id);
      const transcript = roundTurns.map((t) => ({
        step: t.step,
        question: t.questionText,
        answer: t.answer,
        time_to_answer_ms: t.timeToAnswerMs,
        construct_dimension: t.constructDimension,
        regen_count: t.regenCount,
        guard_rejections: parseJsonArray(t.guardRejections),
        leading_verdict: t.leadingVerdict,
        is_triangulation_probe: t.isTriangulationProbe,
        device_class: t.deviceClass,
        viewport: t.viewport,
      }));
      const analysis = computeAnalysis(
        roundTurns.map((t) => ({
          answer: t.answer,
          timeToAnswerMs: t.timeToAnswerMs,
          constructDimension: t.constructDimension,
          leadingVerdict: t.leadingVerdict,
        }))
      );
      return {
        round_number: r.roundNumber,
        prd_version: r.prdVersion,
        status: r.status,
        termination_reason: r.terminationReason,
        focus_brief: r.focusBrief,
        started_at: r.startedAt,
        completed_at: r.completedAt,
        transcript,
        analysis,
        prd_markdown: r.prdMarkdown,
      };
    });

    exported.push({
      session_id: s.id,
      seed: s.seed,
      skill_version: s.skillVersion,
      status: s.status,
      seed_warnings: parseJsonArray(s.seedWarnings),
      started_at: s.startedAt,
      completed_at: s.completedAt,
      rounds: roundPayloads,
    });
  }

  const payload = {
    exported_at: new Date().toISOString(),
    skill_versions_seen: [...versions],
    sessions: exported,
  };

  const date = new Date().toISOString().slice(0, 10);
  return new NextResponse(JSON.stringify(payload, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="training-data-${date}.json"`,
    },
  });
}
