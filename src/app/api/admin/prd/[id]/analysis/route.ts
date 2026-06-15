import { NextResponse } from "next/server";
import { and, desc, eq, isNotNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { rounds } from "@/lib/db/schema";
import { isAdmin } from "@/lib/session";
import { analysisFilename } from "@/lib/disclosure";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: { id: string } }
) {
  if (!(await isAdmin())) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  // Serve the latest round's analysis for this session.
  const [round] = await db
    .select()
    .from(rounds)
    .where(and(eq(rounds.sessionId, params.id), isNotNull(rounds.analysisMarkdown)))
    .orderBy(desc(rounds.roundNumber));

  if (!round || !round.analysisMarkdown) {
    return new NextResponse("Not found", { status: 404 });
  }

  return new NextResponse(round.analysisMarkdown, {
    status: 200,
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="${analysisFilename(params.id)}"`,
    },
  });
}
