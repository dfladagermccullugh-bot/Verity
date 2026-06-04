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
        <div className="flex gap-4 text-sm">
          <a
            href={`/api/admin/prd/${session!.id}`}
            className="text-primary hover:underline"
          >
            Download PRD
          </a>
          {session!.methodologyMarkdown && (
            <a
              href={`/api/admin/prd/${session!.id}/methodology`}
              className="text-primary hover:underline"
            >
              Download methodology
            </a>
          )}
        </div>
      </div>
      <p className="mt-4 text-sm text-on-surface-variant">
        {invite?.inviteeName} · seed: {session!.seed}
      </p>
      <p className="mt-1 font-mono text-xs text-on-surface-variant">
        session: {session!.id}
      </p>

      <h2 className="mt-6 text-xs font-semibold uppercase tracking-wider text-on-surface-variant">
        PRD
      </h2>
      <pre className="mt-2 whitespace-pre-wrap rounded-md3-lg border border-outline-variant bg-surface-container-high p-6 text-sm leading-relaxed text-on-surface">
        {session!.prdMarkdown}
      </pre>

      {session!.methodologyMarkdown && (
        <details className="mt-6 rounded-md3-lg border border-outline-variant bg-surface-container-low">
          <summary className="cursor-pointer p-4 text-xs font-semibold uppercase tracking-wider text-on-surface-variant">
            Methodology disclosure (AAPOR 2026) — companion document
          </summary>
          <pre className="whitespace-pre-wrap border-t border-outline-variant p-6 text-sm leading-relaxed text-on-surface">
            {session!.methodologyMarkdown}
          </pre>
        </details>
      )}
    </main>
  );
}
