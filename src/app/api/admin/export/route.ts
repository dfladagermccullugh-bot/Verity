import { NextResponse } from "next/server";
import { asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { sessions, turns } from "@/lib/db/schema";
import { isAdmin } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await isAdmin())) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const allSessions = await db.select().from(sessions);
  const completed_sessions: unknown[] = [];
  const abandoned_sessions: unknown[] = [];
  const versions = new Set<string>();

  for (const s of allSessions) {
    versions.add(s.skillVersion);
    const rows = await db
      .select()
      .from(turns)
      .where(eq(turns.sessionId, s.id))
      .orderBy(asc(turns.step));

    const transcript = rows.map((t) => ({
      step: t.step,
      question: t.questionText,
      answer: t.answer,
      time_to_answer_ms: t.timeToAnswerMs,
    }));

    if (s.completedAt) {
      const answered = rows.filter((t) => t.answer != null).length;
      completed_sessions.push({
        session_id: s.id,
        seed: s.seed,
        skill_version: s.skillVersion,
        started_at: s.startedAt,
        completed_at: s.completedAt,
        total_questions: answered,
        total_duration_seconds: Math.round(
          (new Date(s.completedAt).getTime() -
            new Date(s.startedAt).getTime()) /
            1000
        ),
        transcript,
        prd_markdown: s.prdMarkdown,
      });
    } else {
      const lastStep = rows.reduce((m, r) => Math.max(m, r.step), 0) || null;
      const durMs = rows.reduce(
        (sum, r) => sum + (r.timeToAnswerMs ?? 0),
        0
      );
      abandoned_sessions.push({
        session_id: s.id,
        seed: s.seed,
        skill_version: s.skillVersion,
        started_at: s.startedAt,
        abandoned_at_step: lastStep,
        total_duration_seconds: Math.round(durMs / 1000),
        transcript,
      });
    }
  }

  const payload = {
    exported_at: new Date().toISOString(),
    skill_versions_seen: [...versions],
    completed_sessions,
    abandoned_sessions,
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
