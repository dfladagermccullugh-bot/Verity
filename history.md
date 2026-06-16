# Verity — Development History

The long-form archive. When [handoff.md](handoff.md) accumulates stale notes or
completed to-dos, they land here so the handoff stays lean. Newest first.

---

## 2026-06-16 — Admin login restored (password rotated)

The admin lockout (open since 2026-06-14) is resolved. User rotated
`ADMIN_PASSWORD` in Vercel — set as a **non-sensitive** var this time so it stays
viewable and can't become unrecoverable again — and redeployed; `/admin/*` is
reachable. No code change (the value is read from `process.env.ADMIN_PASSWORD`);
the secret is deliberately never committed. This unblocks issuing invites, which
in turn unblocks the to-do #1 live QA.

---

## 2026-06-16 — Cleanup: retire NEXT-SESSION.md + drop puppy/lottie

Cleared the two self-contained handoff to-dos that didn't need a live env (DB /
API key were absent in the container, so to-dos 1–3 stayed blocked).

- **Retired `NEXT-SESSION.md`** — fully stale (its AAPOR iterations 2 & 3 both
  shipped long ago). Removed the file and the two references that cited it:
  the tolerances comment in `src/lib/canaries/compare.ts` and the test name in
  `src/tests/canary-compare.test.ts` ("matches the NEXT-SESSION.md tolerances" →
  "matches the documented tolerances"). Behavior unchanged — only prose/labels.
- **Reskin loose ends** — deleted the orphaned `public/puppy.json` and dropped
  the unused `lottie-react` dependency (regenerated `package-lock.json`; both
  `lottie-react` and `lottie-web` gone, −31 lockfile lines). The README "Stack"
  line + branding were already current as of `c4bc1ef`, so nothing remained
  there; also corrected the handoff's own stale "Material 3 tokens" stack line.
- **Verification:** `npm ci` clean, `npm run typecheck` clean, `npm test`
  109/109, `npm run build` passes (all routes compile, no missing-import fallout
  from the dropped dep).

---

## 2026-06-15 — Survey-methodology measurement layer + multi-round (shipped)

Translated the applicable rules from *Survey Methodology* (Groves et al.) — the
measurement-inference half only; the representation half (sampling/weighting/
coverage) was deliberately excluded as meaningless for an n=1 tool — into 15
features, all built in one effort. The respondent surface stayed exactly
yes/no/done; everything new is backend/operator-side.

**Decisions locked with the user:** all-at-once scope; **zero typing ever** (no
escape-hatch text box, no fourth button — the critic carries all gap-catching);
**anonymous durable-link identity** (no contact stored; revisit resumes the next
round, pull-based); **fully automated critic** (opens the next round itself, no
operator approval, fail-safe on error).

**What shipped:**
- *Question quality:* deterministic anti-leading check (`anti-leading.ts`) wired
  into the generation retry loop next to the guard; construct-dimension tagging
  (`dimensions.ts`) per turn. Both deterministic ⇒ no per-turn model call.
- *Seed phase:* construct brief extended with decision + unit; non-blocking
  seed-quality warnings (`seed-quality.ts`).
- *Multi-round:* new `rounds` table; `sessions` became the durable respondent
  container (status lifecycle, `resumePhrase`, latest-round mirror); `turns`
  gained `roundId` + measurement metadata. `interview-engine.ts` rewritten to be
  round-aware (`finalizeRound` freezes per-round PRD/methodology/analysis,
  versioned). Between-round critic (`critic.ts`) off the hot path. Durable-link
  resume routing driven by pending-turn presence; `/done` sticky; invite consumed
  only at true completion.
- *Backend data:* per-round analysis (`analysis.ts` — acquiescence,
  straightlining, latency/satisficing, leading rate, coverage, triangulation
  reliability) shipped as a third companion doc with download route, email
  attachment, admin version-history/diff view, and a richer per-session→rounds→
  turns export.
- *Disclosure:* methodology doc now discloses adaptive tailoring, the
  anti-leading check, PRD version, and the analysis companion.

**Verification:** typecheck clean; `npm test` 109/109 (was 65; +44 across
anti-leading, dimensions, analysis, critic, seed-quality, disclosure); `npm run
build` passes incl. the new analysis route. Migration `0003` generated, not
applied (no DB in container). Not run live: dev-server multi-round E2E and the
canary's model run (need `DATABASE_URL`/`ANTHROPIC_API_KEY`) — carried into the
handoff to-dos. Supersedes the 2026-06-15 "Product direction discussed" entry
below: that vision is now built.

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

## 2026-06-15 — Product direction discussed (no code)

Explored the multi-round feedback-loop vision: gated escape hatch for end-of-
survey capture, rounds + critic/gap-analysis loop with versioned PRDs, and
link-as-identity tracking (no typed code). Full proposal + the three open
decisions live in handoff.md under "Next focus." Nothing built yet.

---

## 2026-06-14 — Post-reskin cleanup + admin-access finding

- Landing (`/`): stripped the instrument chrome (brand header, scanline,
  telemetry footer); now just grid + centered `Verity` wordmark + "Verity is
  invite-only" line.
- Admin login (`/admin/login`): brought in line with the landing page — removed
  scanline and the context-tag/"Restricted access" chrome; simplified language
  ("Authenticate"→"Login", "CREDENTIAL"→"Password").
- **Admin password investigation:** confirmed `ADMIN_PASSWORD` is read from env
  (`src/actions/admin.ts`), never hard-coded or committed. A prior agent generated
  it via `crypto.randomBytes(9).toString('base64url')` (trace in
  `.claude/settings.local.json` allowlist) and set it directly in Vercel as a
  *Sensitive* var — so it's unrecoverable. Login is effectively locked until
  rotated; user deferred. (Carried as a to-do; secret intentionally NOT stored
  in-repo.)

---

## 2026-06-14 — Midnight Precision reskin

Full experiential refashion of the UI from the green Material 3 theme to
**Midnight Precision** (Technical Minimalism), driven by a provided `design.md`
(source of truth) with a screenshot + inspiration HTML for the instrument chrome.
Decisions: full reskin, flat M3-style color treatment, "precision" tone.

- **Foundation:** `globals.css` → dark-only Midnight Precision `--md-*` palette
  (+ new `hairline` token); `tailwind.config.ts` → Inter, sharp radii, shadows
  neutralized, display/label type scale, `tracking-engrave`, spacing tokens,
  scanline/pulse animations; `layout.tsx` → Inter + forced dark, theme toggle
  removed, title "VERITY".
- **Chrome:** new `src/components/chrome.tsx` (brand header, faint 12-col grid,
  scanline, context tag, status dot, telemetry footer). Footer `PROTOCOL` is the
  real skill-prompt fingerprint, threaded from the server; no fake latency.
- **Surfaces restyled:** landing, seed form, interview card (centerpiece —
  context tag = turn counter, big display question, YES=gold / NO=hairline / done
  link), done screen, and the full admin set (login, registry list, brief detail,
  new-invite).
- **Tone:** retired the puppy (`puppy.tsx` deleted, `lottie-react`/`puppy.json`
  now orphaned) and the gardening loading words (now telemetry verbs); copy is
  engraved-uppercase.
- **Conflicts resolved:** `design.md` prose contradicted its own tokens/screenshot
  (white-vs-gold primary; pure-black-vs-#131313); followed tokens + screenshot.
  The screenshot's `DECLINE/CONFIRM CHOICE` was a mock — kept the real yes/no/done
  product contract, applied only the aesthetic.
- **Verification:** typecheck clean, `npm run build` passes, 65 tests still green,
  landing route smoke-tested at HTTP 200. DB-backed routes not yet screenshotted.

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
