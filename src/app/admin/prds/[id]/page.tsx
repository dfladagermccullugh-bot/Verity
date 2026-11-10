import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { sessions, invites, rounds, turns } from "@/lib/db/schema";
import { deriveOperatorState, latestPrdRound } from "@/lib/lifecycle";
import RoundActions from "./round-actions";
import StalledActions from "./stalled-actions";
import Markdown from "@/components/markdown";

export const dynamic = "force-dynamic";
// Hosts the open-round / resume actions, which call the model.
export const maxDuration = 60;

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
  // Renders without a PRD too: a stalled or failed first round must still
  // be visible to the operator, with its recovery controls.
  if (!session) notFound();

  const invite = await db.query.invites.findFirst({
    where: eq(invites.id, session!.inviteId),
  });

  const sessionRounds = await db
    .select()
    .from(rounds)
    .where(eq(rounds.sessionId, session!.id))
    .orderBy(asc(rounds.roundNumber));
  const warnings = parseStringArray(session!.seedWarnings);
  const [pending] = await db
    .select({ id: turns.id })
    .from(turns)
    .where(and(eq(turns.sessionId, session!.id), isNull(turns.answer)))
    .limit(1);
  const operatorState = deriveOperatorState({
    status: session!.status,
    hasPendingTurn: !!pending,
  });
  // Label the PRD with the version of the round that produced it, not the
  // latest round (which may have failed or still be open).
  const prdRound = latestPrdRound(sessionRounds);
  const hasAnalysis = sessionRounds.some((r) => r.analysisMarkdown && r.prdMarkdown);

  return (
    <main className="mx-auto max-w-3xl px-margin-mobile py-16 md:px-margin-desktop">
      <div className="flex items-center justify-between">
        <Link
          href="/admin/prds"
          className="text-label-sm text-on-surface-variant underline-offset-2 transition-colors hover:text-on-surface hover:underline focus-visible:underline"
        >
          ← Registry
        </Link>
        <div className="flex gap-5 text-label-sm">
          {session!.prdMarkdown && (
            <a
              href={`/api/admin/prd/${session!.id}`}
              className="text-primary underline underline-offset-2 transition-colors hover:brightness-110"
            >
              Download PRD
            </a>
          )}
          {session!.methodologyMarkdown && (
            <a
              href={`/api/admin/prd/${session!.id}/methodology`}
              className="text-on-surface-variant underline-offset-2 transition-colors hover:text-on-surface hover:underline focus-visible:underline"
            >
              Methodology
            </a>
          )}
          {hasAnalysis && (
            <a
              href={`/api/admin/prd/${session!.id}/analysis`}
              className="text-on-surface-variant underline-offset-2 transition-colors hover:text-on-surface hover:underline focus-visible:underline"
            >
              Analysis
            </a>
          )}
        </div>
      </div>

      <p className="mt-10 text-body-md text-on-surface-variant">
        {invite?.inviteeName} · seed: {session!.seed}
      </p>
      <p className="mt-1 font-mono text-label-sm text-on-surface-variant">
        session: {session!.id} · status: {session!.status} · rounds:{" "}
        {sessionRounds.length}
        {session!.resumePhrase ? ` · resume: ${session!.resumePhrase}` : ""}
      </p>

      {warnings.length > 0 && (
        <p className="mt-3 text-label-sm text-error">
          Seed warnings: {warnings.join(", ")}
        </p>
      )}

      {session!.constructBrief && (
        <details className="mt-10 overflow-hidden rounded-xl border border-hairline">
          <summary className="cursor-pointer p-4 text-label-sm text-on-surface-variant">
            Construct brief — validity check (AAPOR §4.3.1)
          </summary>
          <Markdown
            content={session!.constructBrief}
            className="border-t border-hairline p-6 text-body-md"
          />
        </details>
      )}

      {session!.prdMarkdown ? (
        <>
          <h2 className="mt-10 text-label-sm text-on-surface-variant">
            PRD — latest version (v{prdRound?.prdVersion ?? 1})
          </h2>
          <Markdown
            content={session!.prdMarkdown}
            className="mt-3 rounded-xl border border-hairline bg-surface-container-low p-8 text-body-md"
          />
        </>
      ) : (
        <div className="mt-10 rounded-xl border border-hairline bg-surface-container-low p-8">
          <p className="text-label-sm text-on-surface-variant">No PRD yet</p>
          <p className="mt-3 text-body-md text-on-surface-variant">
            No round of this session has produced a PRD so far.
          </p>
        </div>
      )}

      {operatorState === "awaiting_review" ? (
        <RoundActions sessionId={session!.id} />
      ) : operatorState === "stalled" ? (
        <StalledActions sessionId={session!.id} />
      ) : operatorState === "awaiting_respondent" ? (
        <div className="mt-10 rounded-lg border border-hairline bg-surface-container-low p-6">
          <p className="text-label-sm text-on-surface-variant">
            Awaiting respondent
          </p>
          <p className="mt-3 text-body-md text-on-surface-variant">
            Round{" "}
            {[...sessionRounds].reverse().find((r) => r.status === "in_progress")?.roundNumber ??
              sessionRounds.length}{" "}
            is open and the respondent has a pending
            question on their durable link. Operator controls (open another round
            / mark complete) reappear here once they finish and the round
            finalizes for review.
          </p>
        </div>
      ) : operatorState === "complete" ? (
        <div className="mt-10 rounded-lg border border-hairline bg-surface-container-low p-6">
          <p className="text-label-sm text-primary">
            Complete
          </p>
          <p className="mt-3 text-body-md text-on-surface-variant">
            This session is closed and its single-use invite has been consumed —
            the respondent&rsquo;s link now shows the closing screen and accepts no
            more answers.{" "}
            {session!.prdMarkdown
              ? "The PRD above is the final version."
              : "It closed without a PRD."}
          </p>
        </div>
      ) : (
        <div className="mt-10 rounded-lg border border-error/40 bg-surface-container-low p-6">
          <p className="text-label-sm text-error">Unknown status</p>
          <p className="mt-3 text-body-md text-on-surface-variant">
            This session has an unrecognised status (&ldquo;{session!.status}
            &rdquo;). No operator controls are offered.
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
            <summary className="cursor-pointer p-4 text-label-sm text-on-surface-variant transition-colors hover:text-on-surface">
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
                <Markdown
                  content={r.analysisMarkdown}
                  className="mt-2 border-t border-hairline pt-4 text-body-md"
                />
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
          <Markdown
            content={session!.methodologyMarkdown}
            className="border-t border-hairline p-6 text-body-md"
          />
        </details>
      )}
    </main>
  );
}
