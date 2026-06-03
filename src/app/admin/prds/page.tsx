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
    <main className="mx-auto max-w-5xl p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-primary">PRDs</h1>
        <form action={logout}>
          <button className="text-sm text-on-surface-variant hover:underline">
            Sign out
          </button>
        </form>
      </div>

      <div className="mt-6">
        <NewInvite />
      </div>

      <div className="mt-8 overflow-x-auto rounded-md3-lg border border-outline-variant">
        <table className="w-full text-left text-sm">
          <thead className="bg-surface-container text-on-surface-variant">
            <tr>
              <th className="p-3">Invitee</th>
              <th className="p-3">Seed</th>
              <th className="p-3">Started</th>
              <th className="p-3">Questions</th>
              <th className="p-3">Status</th>
              <th className="p-3">PRD</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="p-6 text-center text-on-surface-variant">
                  No sessions yet.
                </td>
              </tr>
            )}
            {rows.map(({ session, invite }) => {
              const qCount = answeredBySession.get(session.id) ?? 0;
              const completed = !!session.completedAt;
              const durationS = completed
                ? Math.round(
                    (new Date(session.completedAt!).getTime() -
                      new Date(session.startedAt).getTime()) /
                      1000
                  )
                : null;
              return (
                <tr key={session.id} className="border-t border-outline-variant">
                  <td className="p-3">{invite.inviteeName}</td>
                  <td className="max-w-[18rem] truncate p-3 text-on-surface-variant">
                    {session.seed}
                  </td>
                  <td className="p-3 text-on-surface-variant">
                    {fmtDate(session.startedAt)}
                  </td>
                  <td className="p-3">{qCount}</td>
                  <td className="p-3">
                    {completed ? (
                      <span className="text-primary">
                        done · {durationS}s
                      </span>
                    ) : (
                      <span className="text-on-surface-variant">in progress</span>
                    )}
                  </td>
                  <td className="p-3">
                    {completed ? (
                      <span className="flex gap-3">
                        <Link
                          href={`/admin/prds/${session.id}`}
                          className="text-primary hover:underline"
                        >
                          View
                        </Link>
                        <a
                          href={`/api/admin/prd/${session.id}`}
                          className="text-primary hover:underline"
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

      <div className="mt-6 flex justify-end">
        <a
          href="/api/admin/export"
          className="rounded-full border border-outline px-4 py-2 text-sm text-primary hover:bg-primary/10"
        >
          Export training data
        </a>
      </div>
    </main>
  );
}
