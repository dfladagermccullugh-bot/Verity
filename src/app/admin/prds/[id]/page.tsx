import Link from "next/link";
import { notFound } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { sessions, invites, rounds } from "@/lib/db/schema";
import RoundActions from "./round-actions";

export const dynamic = "force-dynamic";

/** Naive line-level diff between two PRD versions — enough to show what the
 *  follow-up round changed. */
function lineDiff(oldText: string, newText: string): { added: string[]; removed: string[] } {
  const norm = (s: string) =>
    s
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
  const oldLines = new Set(norm(oldText));
  const newLines = new Set(norm(newText));
  const added = [...newLines].filter((l) => !oldLines.has(l));
  const removed = [...oldLines].filter((l) => !newLines.has(l));
  return { added, removed };
}

function parseStringArray(s: string | null): string[] {
  if (!s) return [];
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

export default async function PrdView({ params }: { params: { id: string } }) {
  const session = await db.query.sessions.findFirst({
    where: eq(sessions.id, params.id),
  });
  if (!session || !session.prdMarkdown) notFound();

  const invite = await db.query.invites.findFirst({
    where: eq(invites.id, session!.inviteId),
  });

  const sessionRounds = await db
    .select()
    .from(rounds)
    .where(eq(rounds.sessionId, session!.id))
    .orderBy(asc(rounds.roundNumber));
  const warnings = parseStringArray(session!.seedWarnings);
  const awaitingReview = session!.status === "awaiting_review";

  return (
    <main className="mx-auto max-w-3xl px-margin-mobile py-16 md:px-margin-desktop">
      <div className="flex items-center justify-between">
        <Link
          href="/admin/prds"
          className="text-label-sm text-on-surface-variant transition-colors hover:text-on-surface"
        >
          ← Registry
        </Link>
        <div className="flex gap-5 text-label-sm">
          <a
            href={`/api/admin/prd/${session!.id}`}
            className="text-primary transition-colors hover:brightness-110"
          >
            Download PRD
          </a>
          {session!.methodologyMarkdown && (
            <a
              href={`/api/admin/prd/${session!.id}/methodology`}
              className="text-on-surface-variant transition-colors hover:text-on-surface"
            >
              Methodology
            </a>
          )}
          <a
            href={`/api/admin/prd/${session!.id}/analysis`}
            className="text-on-surface-variant transition-colors hover:text-on-surface"
          >
            Analysis
          </a>
        </div>
      </div>

      <p className="mt-10 text-body-md text-on-surface-variant">
        {invite?.inviteeName} · seed: {session!.seed}
      </p>
      <p className="mt-1 font-mono text-label-sm text-on-surface-variant opacity-60">
        session: {session!.id} · status: {session!.status} · rounds:{" "}
        {sessionRounds.length}
        {session!.resumePhrase ? ` · resume: ${session!.resumePhrase}` : ""}
      </p>

      {warnings.length > 0 && (
        <p className="mt-3 text-label-sm text-error opacity-80">
          Seed warnings: {warnings.join(", ")}
        </p>
      )}

      {session!.constructBrief && (
        <details className="mt-10 overflow-hidden rounded-xl border border-hairline">
          <summary className="cursor-pointer p-4 text-label-sm text-on-surface-variant">
            Construct brief — validity check (AAPOR §4.3.1)
          </summary>
          <pre className="whitespace-pre-wrap border-t border-hairline p-6 text-body-md leading-relaxed text-on-surface">
            {session!.constructBrief}
          </pre>
        </details>
      )}

      <h2 className="mt-10 text-label-sm text-on-surface-variant">
        PRD — latest version (v
        {sessionRounds.length > 0
          ? sessionRounds[sessionRounds.length - 1].prdVersion
          : 1}
        )
      </h2>
      <pre className="mt-3 whitespace-pre-wrap rounded-xl border border-hairline bg-surface-container-low p-8 text-body-md leading-relaxed text-on-surface">
        {session!.prdMarkdown}
      </pre>

      {awaitingReview ? (
        <RoundActions sessionId={session!.id} />
      ) : session!.status === "active" ? (
        <div className="mt-10 rounded-lg border border-hairline bg-surface-container-low p-6">
          <p className="text-label-sm text-on-surface-variant">
            Awaiting respondent
          </p>
          <p className="mt-3 text-body-md text-on-surface-variant">
            Round {sessionRounds.length} is open and the respondent has a pending
            question on their durable link. Operator controls (open another round
            / mark complete) reappear here once they finish and the round
            finalizes for review.
          </p>
        </div>
      ) : (
        <div className="mt-10 rounded-lg border border-hairline bg-surface-container-low p-6">
          <p className="text-label-sm text-primary">
            Complete
          </p>
          <p className="mt-3 text-body-md text-on-surface-variant">
            This session is closed and its single-use invite has been consumed —
            the durable link no longer resolves. The PRD below is the final
            version.
          </p>
        </div>
      )}

      {/* Round / version history. */}
      {sessionRounds.map((r, i) => {
        const prev = i > 0 ? sessionRounds[i - 1] : null;
        const diff =
          prev && prev.prdMarkdown && r.prdMarkdown
            ? lineDiff(prev.prdMarkdown, r.prdMarkdown)
            : null;
        return (
          <details key={r.id} className="mt-6 overflow-hidden rounded-xl border border-hairline">
            <summary className="cursor-pointer p-4 text-label-sm text-on-surface-variant">
              Round {r.roundNumber} · PRD v{r.prdVersion} ·{" "}
              {r.terminationReason ?? r.status}
            </summary>
            <div className="border-t border-hairline p-6 text-body-md leading-relaxed text-on-surface">
              {r.focusBrief && (
                <p className="mb-4 text-on-surface-variant">
                  Opened to probe: {r.focusBrief}
                </p>
              )}
              {r.criticRecommendOpen != null && (
                <div className="mb-4 border-l border-hairline pl-4 text-on-surface-variant">
                  <p className="text-label-sm">
                    Critic verdict (advisory):{" "}
                    {r.criticRecommendOpen
                      ? "recommends another round"
                      : "no further round needed"}
                  </p>
                  {parseStringArray(r.criticGaps).length > 0 && (
                    <p className="mt-2">
                      Gaps: {parseStringArray(r.criticGaps).join("; ")}
                    </p>
                  )}
                  {r.criticFocus && <p className="mt-1">Focus: {r.criticFocus}</p>}
                </div>
              )}
              {diff && (
                <div className="mb-4 font-mono text-label-sm">
                  <p className="text-primary">+ {diff.added.length} lines added</p>
                  <p className="text-on-surface-variant">
                    − {diff.removed.length} lines removed
                  </p>
                </div>
              )}
              {r.analysisMarkdown && (
                <pre className="mt-2 whitespace-pre-wrap border-t border-hairline pt-4 text-body-md">
                  {r.analysisMarkdown}
                </pre>
              )}
            </div>
          </details>
        );
      })}

      {session!.methodologyMarkdown && (
        <details className="mt-10 overflow-hidden rounded-xl border border-hairline">
          <summary className="cursor-pointer p-4 text-label-sm text-on-surface-variant">
            Methodology disclosure (AAPOR 2026) — companion document
          </summary>
          <pre className="whitespace-pre-wrap border-t border-hairline p-6 text-body-md leading-relaxed text-on-surface">
            {session!.methodologyMarkdown}
          </pre>
        </details>
      )}
    </main>
  );
}
