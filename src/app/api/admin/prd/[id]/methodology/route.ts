import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { sessions } from "@/lib/db/schema";
import { isAdmin } from "@/lib/session";
import { methodologyFilename } from "@/lib/disclosure";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: { id: string } }
) {
  if (!(await isAdmin())) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const session = await db.query.sessions.findFirst({
    where: eq(sessions.id, params.id),
  });
  if (!session || !session.methodologyMarkdown) {
    return new NextResponse("Not found", { status: 404 });
  }

  return new NextResponse(session.methodologyMarkdown, {
    status: 200,
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="${methodologyFilename(session.id)}"`,
    },
  });
}
