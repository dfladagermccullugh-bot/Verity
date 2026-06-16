import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { invites, sessions, turns } from "@/lib/db/schema";
import { logout } from "@/actions/admin";
import NewInvite from "./new-invite";

export const dynamic = "force-dynamic";

function fmtDate(d: Date | null): string {
  return d ? new Date(d).toLocaleString() : "—";
}

export default async function PrdsPage() {
  const rows = await db
    .select({
      session: sessions,
      invite: invites,
    })
    .from(sessions)
    .innerJoin(invites, eq(sessions.inviteId, invites.id))
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
            Verity // Brief Registry
          </h1>
        </div>
        <form action={logout}>
          <button className="text-label-sm uppercase tracking-engrave text-on-surface-variant transition-colors hover:text-on-surface">
            Sign out
          </button>
        </form>
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
              <th className="p-4 font-semibold">Turns</th>
              <th className="p-4 font-semibold">Status</th>
              <th className="p-4 font-semibold">Brief</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td
                  colSpan={6}
                  className="p-8 text-center text-label-sm uppercase tracking-engrave text-on-surface-variant opacity-60"
                >
                  No sessions on record
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
                  <td className="max-w-[18rem] truncate p-4 text-on-surface-variant">
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
                        Done{durationS != null ? ` · ${durationS}s` : ""}
                      </span>
                    ) : session.status === "awaiting_review" ? (
                      <span className="inline-flex items-center gap-2 text-label-sm uppercase tracking-engrave text-primary opacity-80">
                        <span className="inline-block h-1.5 w-1.5 animate-pulse bg-primary" />
                        Awaiting review
                      </span>
                    ) : (
                      <span className="text-label-sm uppercase tracking-engrave text-on-surface-variant">
                        In progress
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
