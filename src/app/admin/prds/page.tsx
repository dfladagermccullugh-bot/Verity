import Link from "next/link";
import { and, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { invites, sessions, turns } from "@/lib/db/schema";
import { logout, archiveSession, unarchiveSession } from "@/actions/admin";
import NewInvite from "./new-invite";
import ThemeToggle from "@/components/theme-toggle";

export const dynamic = "force-dynamic";

// Goal-directed admin table — paginated rather than unbounded (source-of-truth
// §4). 25 rows/page sits inside the 20–50 desktop guidance.
const PAGE_SIZE = 25;

function fmtDate(d: Date | null): string {
  if (!d) return "—";
  return new Date(d).toLocaleString(undefined, {
    year: "2-digit",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

type StatusMeta = { label: string; dot: string; pulse: boolean; title: string };

function statusMeta(status: string, durationS: number | null): StatusMeta {
  if (status === "complete")
    return {
      label: `Complete${durationS != null ? ` · ${durationS}s` : ""}`,
      dot: "bg-success",
      pulse: false,
      title: "Session complete — invite consumed",
    };
  if (status === "awaiting_review")
    return {
      label: "Awaiting review",
      dot: "bg-primary",
      pulse: true,
      title: "Round finalized — open another round or mark complete",
    };
  return {
    label: "Awaiting user",
    dot: "bg-warning",
    pulse: false,
    title: "Respondent has an open question — no operator action yet",
  };
}

/** Dot + text status — color is never the sole cue (label always present). */
function StatusBadge({ meta }: { meta: StatusMeta }) {
  return (
    <span
      className="inline-flex items-center gap-2 text-label-sm text-on-surface"
      title={meta.title}
    >
      <span
        className={`inline-block h-1.5 w-1.5 rounded-full ${meta.dot} ${
          meta.pulse ? "animate-pulse" : ""
        }`}
      />
      {meta.label}
    </span>
  );
}

export default async function PrdsPage({
  searchParams,
}: {
  searchParams?: { archived?: string; page?: string };
}) {
  const showArchived = searchParams?.archived === "1";
  const filter = showArchived
    ? isNotNull(sessions.archivedAt)
    : isNull(sessions.archivedAt);

  const [{ total }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(sessions)
    .where(filter);

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const requested = Number(searchParams?.page ?? "1");
  const page = Number.isFinite(requested)
    ? Math.min(Math.max(1, Math.trunc(requested)), pageCount)
    : 1;
  const offset = (page - 1) * PAGE_SIZE;

  const rows = await db
    .select({
      session: sessions,
      invite: invites,
    })
    .from(sessions)
    .innerJoin(invites, eq(sessions.inviteId, invites.id))
    .where(filter)
    .orderBy(desc(sessions.startedAt))
    .limit(PAGE_SIZE)
    .offset(offset);

  // Per-session answered counts as a grouped aggregate, scoped to the rows on
  // this page — never load (or scan) every turn.
  const pageSessionIds = rows.map((r) => r.session.id);
  const counts = pageSessionIds.length
    ? await db
        .select({
          sessionId: turns.sessionId,
          n: sql<number>`count(*)::int`,
        })
        .from(turns)
        .where(
          and(isNotNull(turns.answer), inArray(turns.sessionId, pageSessionIds))
        )
        .groupBy(turns.sessionId)
    : [];
  const answeredBySession = new Map<string, number>(
    counts.map((c) => [c.sessionId, c.n])
  );

  const pageHref = (p: number) =>
    `/admin/prds?${showArchived ? "archived=1&" : ""}page=${p}`;
  const firstRow = total === 0 ? 0 : offset + 1;
  const lastRow = offset + rows.length;

  return (
    <main className="mx-auto max-w-6xl px-margin-mobile py-16 md:px-margin-desktop">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-primary" />
          <h1 className="text-label-sm text-on-surface">
            <span className="font-semibold">Verity</span>
            <span className="text-on-surface-variant">
              {" · "}
              {showArchived ? "Archived sessions" : "PRD registry"}
            </span>
          </h1>
        </div>
        <div className="flex items-center gap-5">
          <Link
            href={showArchived ? "/admin/prds" : "/admin/prds?archived=1"}
            className="text-label-sm text-on-surface-variant underline-offset-2 transition-colors hover:text-on-surface hover:underline focus-visible:underline"
          >
            {showArchived ? "← Active" : "Archived"}
          </Link>
          <ThemeToggle />
          <form action={logout}>
            <button className="text-label-sm text-on-surface-variant transition-colors hover:text-on-surface">
              Sign out
            </button>
          </form>
        </div>
      </div>

      <div className="mt-10">
        <NewInvite />
      </div>

      {/* Mobile: card list (the table would overflow a phone width). */}
      <div className="mt-10 space-y-4 md:hidden">
        {rows.length === 0 && (
          <p className="rounded-lg border border-hairline bg-surface-container-lowest p-6 text-center text-label-sm text-on-surface-variant">
            {showArchived ? "No archived sessions" : "No sessions on record"}
          </p>
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
          const meta = statusMeta(session.status, durationS);
          return (
            <div
              key={session.id}
              className="rounded-lg border border-hairline bg-surface-container-lowest p-5 shadow-elevation-1"
            >
              <div className="flex items-start justify-between gap-3">
                <span className="font-semibold text-on-surface">
                  {invite.inviteeName}
                </span>
                <StatusBadge meta={meta} />
              </div>
              <p className="mt-3 line-clamp-2 text-body-md text-on-surface-variant">
                {session.seed}
              </p>
              <div className="mt-4 flex items-center justify-between gap-3">
                <span className="text-label-sm text-on-surface-variant">
                  {qCount} turns · {fmtDate(session.startedAt)}
                </span>
                {hasBrief ? (
                  <Link
                    href={`/admin/prds/${session.id}`}
                    className="text-label-sm font-medium text-primary underline underline-offset-2"
                  >
                    View brief →
                  </Link>
                ) : (
                  <span className="text-label-sm text-on-surface-variant">
                    In progress
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Desktop: full table. */}
      <div className="mt-12 hidden overflow-x-auto rounded-xl border border-hairline shadow-elevation-1 md:block">
        <table className="w-full text-left align-top text-body-md">
          <caption className="sr-only">
            {showArchived ? "Archived" : "Active"} interview sessions — page {page}{" "}
            of {pageCount}
          </caption>
          <thead>
            <tr className="border-b border-hairline text-label-sm text-on-surface-variant">
              <th scope="col" className="whitespace-nowrap p-3 font-semibold">
                Invitee
              </th>
              <th scope="col" className="p-3 font-semibold">
                Seed premise
              </th>
              <th scope="col" className="whitespace-nowrap p-3 font-semibold">
                Started
              </th>
              <th
                scope="col"
                className="whitespace-nowrap p-3 font-semibold"
                title="Cumulative answered questions across all rounds"
              >
                Turns
              </th>
              <th scope="col" className="whitespace-nowrap p-3 font-semibold">
                Status
              </th>
              <th scope="col" className="whitespace-nowrap p-3 font-semibold">
                PRD
              </th>
              <th
                scope="col"
                className="whitespace-nowrap p-3 text-right font-semibold"
              >
                Manage
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td
                  colSpan={7}
                  className="p-8 text-center text-label-sm text-on-surface-variant"
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
                  className="border-t border-hairline align-top text-on-surface"
                >
                  <td className="whitespace-nowrap p-3">{invite.inviteeName}</td>
                  <td
                    className="max-w-[16rem] truncate p-3 text-on-surface-variant"
                    title={session.seed}
                  >
                    {session.seed}
                  </td>
                  <td className="whitespace-nowrap p-3 text-on-surface-variant">
                    {fmtDate(session.startedAt)}
                  </td>
                  <td className="p-3 font-mono">{qCount}</td>
                  <td className="whitespace-nowrap p-3">
                    <StatusBadge meta={statusMeta(session.status, durationS)} />
                  </td>
                  <td className="whitespace-nowrap p-3">
                    {hasBrief ? (
                      <span className="flex gap-4 text-label-sm">
                        <Link
                          href={`/admin/prds/${session.id}`}
                          className="text-primary underline underline-offset-2 transition-colors hover:brightness-110"
                        >
                          View
                        </Link>
                        <a
                          href={`/api/admin/prd/${session.id}`}
                          className="text-on-surface-variant underline-offset-2 transition-colors hover:text-on-surface hover:underline focus-visible:underline"
                        >
                          .md
                        </a>
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="whitespace-nowrap p-3 text-right">
                    <form action={showArchived ? unarchiveSession : archiveSession}>
                      <input type="hidden" name="id" value={session.id} />
                      <button
                        type="submit"
                        className="text-label-sm text-on-surface-variant underline-offset-2 transition-colors hover:text-on-surface hover:underline focus-visible:underline"
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

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <p className="text-label-sm text-on-surface-variant">
          Turns = answered questions, cumulative across all rounds
        </p>
        {total > 0 && (
          <div className="flex items-center gap-4 text-label-sm text-on-surface-variant">
            <span aria-live="polite">
              {firstRow}–{lastRow} of {total}
            </span>
            <span className="flex items-center gap-2">
              {page > 1 ? (
                <Link
                  href={pageHref(page - 1)}
                  rel="prev"
                  className="rounded-md border border-hairline px-3 py-1.5 underline-offset-2 transition-colors hover:border-on-surface-variant hover:text-on-surface hover:underline focus-visible:underline"
                >
                  ← Prev
                </Link>
              ) : (
                <span className="rounded-md border border-hairline px-3 py-1.5 opacity-40">
                  ← Prev
                </span>
              )}
              {page < pageCount ? (
                <Link
                  href={pageHref(page + 1)}
                  rel="next"
                  className="rounded-md border border-hairline px-3 py-1.5 underline-offset-2 transition-colors hover:border-on-surface-variant hover:text-on-surface hover:underline focus-visible:underline"
                >
                  Next →
                </Link>
              ) : (
                <span className="rounded-md border border-hairline px-3 py-1.5 opacity-40">
                  Next →
                </span>
              )}
            </span>
          </div>
        )}
      </div>

      <div className="mt-8 flex justify-end">
        <a
          href="/api/admin/export"
          className="rounded-md border border-hairline px-5 py-2.5 text-label-sm text-on-surface-variant underline-offset-2 transition-colors hover:border-on-surface-variant hover:text-on-surface"
        >
          Export training data
        </a>
      </div>
    </main>
  );
}
