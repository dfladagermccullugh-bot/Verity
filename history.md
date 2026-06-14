# Verity — Development History

The long-form archive. When [handoff.md](handoff.md) accumulates stale notes or
completed to-dos, they land here so the handoff stays lean. Newest first.

---

## 2026-06-14 — Handoff/history split

- Reviewed the full project (method, capabilities, directive). Established the
  session-to-session handoff convention: lean `handoff.md` (≤5k tokens) for live
  notes + to-dos, this `history.md` as the archive.
- Verified health on a fresh clone: `npm ci`, then `npm run typecheck` clean and
  `npm test` 65/65 passing (guard 19, canary-compare 15, disclosure 21,
  construct-brief 10).
- Found the one outstanding gap: the canary `baseline.json` is still the
  unbaselined sentinel (`model: null`, `seeds: {}`), so the weekly drift workflow
  is wired but not yet meaningful. Carried into handoff as the top to-do.
- `NEXT-SESSION.md` identified as fully stale (its iterations 2 & 3 both shipped);
  superseded by `handoff.md`.
- Followed up with a comprehensive read of every source file (auth/middleware,
  moderation, tokens, session, admin actions, email, download/export routes,
  client components, canary compare). Captured the full surface map and a few
  minor residue findings (in-memory rate limiter, `idea-seeder`→Verity naming,
  a stale `NEXT-SESSION.md` reference in `compare.ts`) in the handoff.

---

## AAPOR survey-methodology arc (PRs #5–#12, 2026-06-03)

Verity's defining work: mapping runtime behavior 1:1 to three recommendations
from the AAPOR Task Force on Responsible AI Integration in Survey Research (2026).
All three iterations shipped.

### Iteration 3 — Continuous reliability monitoring (PR #11, `a7d1e31`)
AAPOR §4.1.3 + §4.2.4. Weekly reliability canary suite.
- `src/lib/canaries/` — `seeds.json` (5 reference seeds across B2C / B2B SaaS /
  service / physical product / ambiguous-short, each with a deterministic
  answer script), `baseline.json`, `run-one.ts` (DB-free replay mirroring the
  engine's shape/retry logic), `compare.ts`, `types.ts`.
- `scripts/canary.ts` + `npm run canary` / `npm run canary:rebaseline`.
- `.github/workflows/canary.yml` — Monday 13:00 UTC cron + manual dispatch;
  opens a labelled GitHub Issue on drift; uses the production model id so silent
  provider-side changes surface as drift. Deliberately no `pull_request` trigger
  (API-credit cost). Rebaseline must always be explicit.
- Caveat carried forward: baseline.json shipped as an unbaselined sentinel.

### Iteration 2 — Pre-flight construct-validity probe (PR #10, `ef93e83`)
AAPOR §4.3.1. A sidecar LLM call before the first interview question restates the
seed's goal, scope, and in/out-of-bounds examples.
- `src/lib/construct-brief.ts` — `callModelOneShot` with its own auditor system
  prompt; tolerant JSON parse → markdown; returns `null` (non-fatal) on parse
  failure.
- Schema: `sessions.construct_brief` column (migration `0002_construct_brief.sql`).
- Engine: `persistConstructBrief()` awaited at the top of `beginInterview()`;
  swallows errors so the interview always proceeds.
- Surfaced in the admin PRD view (`src/app/admin/prds/[id]/page.tsx`) and
  referenced (when present) in the methodology doc.
- **Log-only by design** — not fed back into the interview prompt, to keep
  brief-vs-interview drift auditable.

### Iteration 1 — Required Disclosures as a companion document (PRs #5–#8)
AAPOR Required Disclosures (Table 4) + Enhanced Disclosures (Table 5).
- `5fbfb57` — first appended an AAPOR methodology disclosure to every PRD.
- `f2ae1ac` (PR #7) — split it into a standalone companion document
  (`methodology-<id>.md`) so the PRD stays clean for downstream AI agents; the
  PRD carries only an invisible HTML-comment header linking the two by session id.
  Schema: `sessions.methodology_markdown` (migration `0001_methodology_markdown.sql`).
- `src/lib/disclosure.ts` — `buildPrdHeader` + `buildMethodologyDocument`;
  provenance (model id, SHA-256 prompt fingerprint, sampling params, date) frozen
  at finalization, not read from live config.
- `b939d2a` (PR #8) — `vercel-build` runs `drizzle-kit migrate && next build` so
  schema travels with code on every deploy (`DATABASE_URL` needed at build time).

### README as portfolio piece
- `7b780b0` (PR #5) — rewrote README as a portfolio piece.
- `25c06da` (PR #12) — tightened to a problem / approach / how-it-works / result
  structure; the "Survey methodology" section enumerates all three AAPOR
  iterations under one heading.

---

## UI & latency pass (PRs #1–#4, 2026-06-02/03)

- `dae8f60` (PR #1) — redesigned UI with Material 3 design tokens, light/dark theme.
- `29d0f0d` (PR #2) — replaced landing page with the Verity display title.
- `b9fd8dd` (PR #3) — Vercel build fix: drop font weight when using axes on Fraunces.
- `88c14aa` (PR #4) — reduced and masked interview turn latency: optimistic card
  transitions + a cycling loading word (`src/lib/loading-words.ts`,
  `src/app/i/[token]/q/interview.tsx`).

---

## Foundation (2026-05-18)

- `a0e639e` / `4b909ec` — initial build of the web app (then "Idea Seeder").
  Core stack established: Next.js 14 App Router + server actions, React 18, TS;
  Postgres via Drizzle (`invites`, `sessions`, `turns` — migration
  `0000_luxuriant_eternity.sql`); Anthropic SDK with prompt caching; iron-session
  admin auth; Resend transactional email; Tailwind.
- Core engine primitives landed: `interview-engine.ts` (turn loop, 40-turn
  runaway ceiling, `forcePrd` fallback), `guard.ts` (deterministic output
  classifier), `idea-seeding-agent.md` (system prompt + output contract).
- `916b78a` — inline the skill markdown into the bundle via webpack
  (`next.config.mjs`) to fix a serverless ENOENT on Vercel; `version.ts` derives
  the SHA-256 prompt fingerprint from the inlined text.
