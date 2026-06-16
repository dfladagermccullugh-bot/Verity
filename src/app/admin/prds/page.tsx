import Link from "next/link";
import { desc, eq, isNotNull, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { invites, sessions, turns } from "@/lib/db/schema";
import { logout, archiveSession, unarchiveSession } from "@/actions/admin";
import NewInvite from "./new-invite";

export const dynamic = "force-dynamic";

function fmtDate(d: Date | null): string {
  return d ? new Date(d).toLocaleString() : "—";
}

export default async function PrdsPage({
  searchParams,
}: {
  searchParams?: { archived?: string };
}) {
  const showArchived = searchParams?.archived === "1";

  const rows = await db
    .select({
      session: sessions,
      invite: invites,
    })
    .from(sessions)
    .innerJoin(invites, eq(sessions.inviteId, invites.id))
    .where(
      showArchived
        ? isNotNull(sessions.archivedAt)
        : isNull(sessions.archivedAt)
    )
    .orderBy(desc(sessions.startedAt));

  const allTurns = await db.select().from(turns);
  const answeredBySession = new Map<string, number>();
  for (const t of allTurns) {
    if (t.answer != null)
      answeredBySession.set(
        t.sessionId,
        (answeredBySession.get(t.sessionId) ?? 0) + 1
      );
  }

  return (
    <main className="mx-auto max-w-5xl px-margin-mobile py-16 md:px-margin-desktop">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="inline-block h-1.5 w-1.5 bg-primary-container" />
          <h1 className="text-label-sm uppercase tracking-engrave text-on-surface-variant">
            Verity // PRD Registry{showArchived ? " · Archived" : ""}
          </h1>
        </div>
        <div className="flex items-center gap-5">
          <Link
            href={showArchived ? "/admin/prds" : "/admin/prds?archived=1"}
            className="text-label-sm uppercase tracking-engrave text-on-surface-variant transition-colors hover:text-on-surface"
          >
            {showArchived ? "← Active" : "Archived"}
          </Link>
          <form action={logout}>
            <button className="text-label-sm uppercase tracking-engrave text-on-surface-variant transition-colors hover:text-on-surface">
              Sign out
            </button>
          </form>
        </div>
      </div>

      <div className="mt-10">
        <NewInvite />
      </div>

      <div className="mt-12 overflow-x-auto border border-hairline">
        <table className="w-full text-left text-body-md">
          <thead>
            <tr className="border-b border-hairline text-label-sm uppercase tracking-engrave text-on-surface-variant">
              <th className="p-4 font-semibold">Invitee</th>
              <th className="p-4 font-semibold">Seed</th>
              <th className="p-4 font-semibold">Started</th>
              <th className="p-4 font-semibold" title="Cumulative answered questions across all rounds">
                Turns · all rounds
              </th>
              <th className="p-4 font-semibold">Status</th>
              <th className="p-4 font-semibold">PRD</th>
              <th className="p-4 font-semibold" />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td
                  colSpan={7}
                  className="p-8 text-center text-label-sm uppercase tracking-engrave text-on-surface-variant opacity-60"
                >
                  {showArchived ? "No archived sessions" : "No sessions on record"}
                </td>
              </tr>
            )}
            {rows.map(({ session, invite }) => {
              const qCount = answeredBySession.get(session.id) ?? 0;
              const hasBrief = !!session.prdMarkdown;
              const durationS = session.completedAt
                ? Math.round(
                    (new Date(session.completedAt).getTime() -
                      new Date(session.startedAt).getTime()) /
                      1000
                  )
                : null;
              return (
                <tr
                  key={session.id}
                  className="border-t border-hairline text-on-surface"
                >
                  <td className="p-4">{invite.inviteeName}</td>
                  <td
                    className="max-w-[18rem] truncate p-4 text-on-surface-variant"
                    title={session.seed}
                  >
                    {session.seed}
                  </td>
                  <td className="p-4 text-on-surface-variant">
                    {fmtDate(session.startedAt)}
                  </td>
                  <td className="p-4 font-mono">{qCount}</td>
                  <td className="p-4">
                    {session.status === "complete" ? (
                      <span className="inline-flex items-center gap-2 text-label-sm uppercase tracking-engrave text-primary">
                        <span className="inline-block h-1.5 w-1.5 bg-primary-container" />
                        Complete{durationS != null ? ` · ${durationS}s` : ""}
                      </span>
                    ) : session.status === "awaiting_review" ? (
                      <span
                        className="inline-flex items-center gap-2 text-label-sm uppercase tracking-engrave text-primary opacity-80"
                        title="Round finalized — open another round or mark complete"
                      >
                        <span className="inline-block h-1.5 w-1.5 animate-pulse bg-primary" />
                        Awaiting your review
                      </span>
                    ) : (
                      <span
                        className="text-label-sm uppercase tracking-engrave text-on-surface-variant"
                        title="Respondent has an open question — no operator action yet"
                      >
                        Awaiting respondent
                      </span>
                    )}
                  </td>
                  <td className="p-4">
                    {hasBrief ? (
                      <span className="flex gap-4 text-label-sm uppercase tracking-engrave">
                        <Link
                          href={`/admin/prds/${session.id}`}
                          className="text-primary transition-colors hover:brightness-110"
                        >
                          View
                        </Link>
                        <a
                          href={`/api/admin/prd/${session.id}`}
                          className="text-on-surface-variant transition-colors hover:text-on-surface"
                        >
                          .md
                        </a>
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="p-4 text-right">
                    <form action={showArchived ? unarchiveSession : archiveSession}>
                      <input type="hidden" name="id" value={session.id} />
                      <button
                        type="submit"
                        className="text-label-sm uppercase tracking-engrave text-on-surface-variant opacity-60 transition-opacity hover:opacity-100"
                      >
                        {showArchived ? "Restore" : "Archive"}
                      </button>
                    </form>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-8 flex justify-end">
        <a
          href="/api/admin/export"
          className="rounded border border-hairline px-5 py-3 text-label-sm uppercase tracking-engrave text-on-surface-variant transition-colors hover:border-on-surface-variant hover:text-on-surface"
        >
          Export training data
        </a>
      </div>
    </main>
  );
}
