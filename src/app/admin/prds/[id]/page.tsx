import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { sessions, invites } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

export default async function PrdView({ params }: { params: { id: string } }) {
  const session = await db.query.sessions.findFirst({
    where: eq(sessions.id, params.id),
  });
  if (!session || !session.prdMarkdown) notFound();

  const invite = await db.query.invites.findFirst({
    where: eq(invites.id, session!.inviteId),
  });

  return (
    <main className="mx-auto max-w-3xl p-6">
      <div className="flex items-center justify-between">
        <Link href="/admin/prds" className="text-sm text-primary hover:underline">
          ← Back
        </Link>
        <a
          href={`/api/admin/prd/${session!.id}`}
          className="text-sm text-primary hover:underline"
        >
          Download .md
        </a>
      </div>
      <p className="mt-4 text-sm text-on-surface-variant">
        {invite?.inviteeName} · seed: {session!.seed}
      </p>
      <pre className="mt-4 whitespace-pre-wrap rounded-md3-lg border border-outline-variant bg-surface-container-high p-6 text-sm leading-relaxed text-on-surface">
        {session!.prdMarkdown}
      </pre>
    </main>
  );
}
