# Verity — Session Handoff

Lean, session-to-session working memory. Keep this under ~5k tokens. When an
item goes stale or a to-do is done, move it to [history.md](history.md) and
trim it from here.

_Last updated: 2026-06-16 (UI re-skin: Midnight Precision → **Warm Paper Calm**, the Notion-inspired light/dark theme in design.md — token-driven, no logic touched)_

## What Verity is

A constrained-interview tool: a one-sentence "seed" becomes a structured PRD.
The invitee only ever taps **yes / no / done**; the model does all the asking,
one yes/no question per turn, then writes the PRD. Invite-only by design
(single-use admin-issued tokens, no public signup). Package name is still
`idea-seeder`; product name is **Verity**.

**Directive / framing:** portfolio piece that maps its own runtime behavior 1:1
to three specific recommendations from the *AAPOR Task Force on Responsible AI
Integration in Survey Research (2026)*. Verity sits in the highest-risk AAPOR
quadrant — it is both AI Interviewer and AI Analyst — and treats that as a
design constraint, not a disclaimer.

## Method (the two core bets)

1. **Constraint as interface.** Reduce the user to three buttons; a well-aimed
   yes/no is worth a paragraph of vague prose.
2. **Hard guardrails, not soft prompting.** The system prompt asks for good
   behavior; `guard.ts` *enforces* it. Bad output → regenerate → on second
   failure force the PRD path. The model is never trusted to self-format.

## Architecture at a glance

```
seed → seed-quality warnings + construct-validity probe (sidecar) →
  ROUND loop: (model → guard → anti-leading → coverage gate → persist turn w/ metadata)
    → on done / 40-turn ceiling / (model-stop AND coverage met) → force PRD
    → finalize round (freeze PRD + methodology + analysis, vN) → email
    → gap-analysis critic = ADVISORY (verdict persisted; does NOT open rounds)
    → session → `awaiting_review`
  OPERATOR decides in admin: "Open another round" (openFollowupRound) OR
    "Mark complete" (consume invite)
durable anonymous link resumes into the next round on revisit (pull-based)
```

Key files:
- `src/lib/interview-engine.ts` — **round-aware** turn loop, retry policy (guard + anti-leading), **coverage gate** (`enforceCoverage`), 40-turn ceiling, `forcePrd`, `finalizeRound` (per-round docs + advisory critic verdict + `awaiting_review`), and `openFollowupRound` (operator-initiated round N+1).
- `src/lib/coverage.ts` — **pure** content-validity gate: covered/uncovered dimensions + `coverageMet` (`COVERAGE_FLOOR = 7` of 10, tunable). Blocks a *model* stop until coverage met; an explicit "done" always wins.
- `src/lib/guard.ts` — deterministic *form* classifier → `question | stop_confirm | prd | reject`. Rejects multiline, batched, jargon, >200 chars, missing `?`.
- `src/lib/anti-leading.ts` — deterministic *semantic* check; rejects tag questions, loaded openers, presupposition. Runs in the same retry loop; no model call.
- `src/lib/dimensions.ts` — keyword classifier mapping each question to one of 10 coverage dimensions (per-turn tag; drives coverage gate + analysis + triangulation).
- `src/lib/analysis.ts` — pure per-round metrics (acquiescence, straightlining, latency, leading rate, coverage, triangulation reliability) + markdown render.
- `src/lib/critic.ts` — between-round gap-analysis (`callModelOneShot`); **advisory only** now — verdict is persisted on the round but a human opens/closes rounds. Fail-safe (stop on parse/transport error). Off the hot path.
- `src/actions/admin.ts` — `openRound` / `completeSession` server actions (admin-gated); admin UI in `prds/[id]` (`round-actions.tsx`) surfaces them when `awaiting_review`.
- `src/lib/seed-quality.ts` — non-blocking seed warnings (vague / double-barreled / presupposition / too-short).
- `src/lib/construct-brief.ts` — AAPOR §4.3.1 pre-flight probe (now also captures decision + unit); **log-only**, non-fatal.
- `src/lib/disclosure.ts` — PRD header + methodology + **analysis** companion docs; provenance + version **frozen per round**.
- `src/lib/anthropic.ts` — `callModel` (interview, prompt-cached) + `callModelOneShot` (sidecars). Model from `ANTHROPIC_MODEL`, default `claude-sonnet-4-6`; `MAX_TOKENS=4096`.
- `src/lib/canaries/` + `scripts/canary.ts` — weekly drift suite (`run-one.ts` mirrors the anti-leading reject **and the coverage gate** so the canary tracks real engine behavior).

Stack: Next.js 14 (App Router, server actions), React 18, TS. Postgres via
Drizzle (`invites`, `sessions`, `rounds`, `turns` — migrations through `0005`).
iron-session admin auth, Resend email, Tailwind (Warm Paper Calm design
system; `--md-*` token names retained), Framer Motion. Deployed on Vercel
(`vercel-build` = `drizzle-kit migrate && next build`).

**Data model (post-0005):** `sessions` is the durable respondent container
(`status` **active | awaiting_review | complete**, `archivedAt` (migration `0005`,
operator-set list-hide; row retained + still exported), `resumePhrase`, `seedWarnings`,
+ latest-round mirror of `prdMarkdown`/`methodologyMarkdown`/`completedAt`).
`rounds` (canonical per version): `roundNumber`, `prdVersion`, `status`,
`terminationReason`, `focusBrief`, frozen `prd/methodology/analysisMarkdown`, and
(migration `0004`) the persisted advisory critic verdict `criticRecommendOpen` /
`criticGaps` / `criticFocus`. `turns`: `roundId` + measurement metadata
(`constructDimension`, `regenCount`, `guardRejections`, `leadingVerdict`,
`isTriangulationProbe`, `deviceClass`, `viewport`). Routing now keys off
`completedAt` (a finalized round → `/done`; a new pending turn → `/q`).

## Design system — Warm Paper Calm (shipped)

Two governing docs: [design.md](design.md) is the **visual** source of truth
(Warm Paper Calm tokens — color/type/radius/elevation); [ux-source-of-truth.md](ux-source-of-truth.md)
is the **interaction & accessibility** source of truth (Laws of UX, target sizes,
focus, motion, error handling, ethics). All UI work is reviewed against both. The
running gap analysis lives in [ux-audit.md](ux-audit.md) — **as of 2026-06-16 it
has open P0 items (zoom disabled, irreversible "Mark complete" w/o confirm,
unlabeled inputs, no focus ring, color-only links); see that file before UI work.**

Notion-inspired calm, the canonical visual spec is [design.md](design.md) and the
code now conforms to it. Warm off-white **paper page canvas** (`#f6f5f4`) with **white
cards** floating above it; near-black warm **Inter** type with tight negative
tracking and **weight-700 headlines**; a single confident **blue** (`primary
#0075de`, pressed `#005bab`) reserved for actions and links — no second
structural accent. Soft radii (inputs 4px, utility buttons 8px, cards 12px, large
containers 16px, hero CTAs full pills), barely-there layered shadows
(`shadow-elevation-1/2/3`), 1px hairlines (`#e6e6e6`). **Light + dark** both ship:
light is default, dark activates via `[data-theme="dark"]` or OS preference
(token sets in `globals.css`).

The re-skin was **token-driven** and touched **no logic** — `--md-*` token
*names* were retained, so re-coloring happened centrally in `globals.css` while
`tailwind.config.ts` carries the radius/shadow/type scale. The old instrument
chrome (scanline, 12-col grid, engraved-uppercase telemetry) was removed; all
copy is sentence-case. Full before/after in history.md.

- **Decisions (this re-skin):** dropped the Midnight Precision instrument
  metaphor entirely; branding stripped to a quiet "Verity" wordmark (no style
  descriptors in chrome). Respondent **hero CTAs are pills** (YES=blue,
  NO=white utility, Done=secondary pill); **admin actions are 8px utility
  buttons** per spec. Sticker palette left defined in design.md but unused
  (Verity has no illustrations) — kept open for future use.
- **Chrome (`src/components/chrome.tsx`):** `BrandHeader`, `StatusDot`,
  `ContextTag`, `TelemetryFooter` only — quiet, sentence-case; footer `Protocol`
  still = real skill fingerprint. `Scanline`/`GridUnderlay` deleted.
- **Per-page:** landing (`/`) + admin login (`/admin/login`) are minimal
  (centered `Verity` wordmark, no chrome). Invitee flow (seed/interview/done)
  keeps header + footer.
- **No live screenshots:** no headless browser in-container (network-gated);
  verified via `tsc` + `next build` + tests, not pixels. Eyeball with
  `npm run dev`. A user-facing dark-mode **toggle** is not built yet (infra is
  there; OS preference works) — small follow-up if wanted.

## Rest of the surface (reviewed, for orientation)

- **Entry / invitee flow:** `src/actions/interview.ts` — `startSession`
  (validates token, expiry, single-use, moderates seed, inserts session, runs
  `beginInterview`) and `answer`. Seed capped at 1000 chars; one session per
  invite enforced. Client card is `src/app/i/[token]/q/interview.tsx` (optimistic
  transitions, cycling loading word from `loading-words.ts`).
- **Moderation:** `src/lib/moderation.ts` — hard-block keyword prefilter + a
  one-word Claude classifier; **fails open** on error (seed is low-sensitivity).
- **Auth / security:** `middleware.ts` — in-memory IP rate limit (80 req/60s) +
  gates `/admin/*` (except login) by unsealing the iron-session cookie.
  `src/lib/tokens.ts` — HMAC-signed single-use invite tokens (timing-safe verify).
  `src/lib/session.ts` — iron-session admin cookie. `src/actions/admin.ts` —
  password login (timing-safe), `createInvite` (7-day expiry).
- **Admin / output:** `src/app/admin/prds/` list + detail (detail surfaces the
  construct brief, seed warnings, **round/version history with a PRD diff**, and
  the analysis per round). Download routes under `src/app/api/admin/`: `prd/[id]`
  (latest PRD md), `prd/[id]/methodology`, `prd/[id]/analysis` (latest round's
  analysis), `export` (training-data JSON, now **per-session → rounds → turns**
  with full per-turn metadata + computed analysis). `src/lib/email.ts` — Resend:
  PRD in body, methodology + analysis as attachments, versioned subject, to
  `DAVIN_EMAIL`; emails **every round** so Davin always has the latest version;
  fails silently since the PRD is already persisted.

## Current health (verified 2026-06-16)

- `npm run typecheck` — clean. `npm run build` — passes (all routes incl. new
  `prd/[id]/analysis` compile).
- `npm test` — **120 passing** (+11 coverage gate; was 109). Existing suites green.
- **Never run live** (no `DATABASE_URL` / `ANTHROPIC_API_KEY` in the container):
  the dev server, the multi-round + operator flow, and the canary's model run.
  Logic verified by typecheck + unit tests only — **the standing to-do is live QA.**
- Note: a fresh clone needs `npm ci`. The canary under `tsx` also needs the
  `server-only` shim/package (pre-existing; not installed here).
- All three original AAPOR iterations remain shipped (PRs #5–#12); the
  survey-methodology measurement layer (15 features) and the multi-round loop are
  shipped on top — see history.md.

## Multi-round loop — durable design notes

The respondent surface is still exactly yes/no/done; every layer is backend /
operator-side. Full build history in history.md.

**Decisions that hold:**
- **Zero typing ever** — no escape-hatch text box, no fourth button. Yes-drift /
  "it depends" are handled *analytically* (acquiescence + straightlining +
  triangulation) and bounded by the coverage gate, never via UI. Gap-catching
  *across* rounds is operator-decided (the critic is advisory).
- **Anonymous / durable link** — no contact stored. The invite token is the
  durable identity; revisiting the link resumes into the next round (pull-based).
  A `resumePhrase` is generated + stored as a backstop (no resolver route yet).
- **~~Fully automated critic~~ → Operator-gated rounds (changed 2026-06-16).**
  The critic no longer opens rounds. It runs at finalize as an *advisory* analyst
  (verdict persisted on the round); the session goes `awaiting_review` and a human
  opens (`openFollowupRound`) or closes (`completeSession`) rounds in admin. A
  within-round **coverage gate** (`coverage.ts`, content validity) prevents the
  model bailing after one question. Both strengthen AAPOR human-oversight + content
  validity. _Auto-open rationale preserved in history.md._

**Design notes worth remembering:**
- Routing now keys off `completedAt`: a pending turn → `/q`; else `completedAt`
  set (round finalized, `awaiting_review` or `complete`) → `/done`. `/done` is
  sticky; the respondent reaches round N+1 only after the operator opens it (new
  pending turn) and they reopen their link.
- Invite is consumed only at **true** completion, so the durable link keeps
  resolving across rounds.
- Each round freezes its own PRD/methodology/analysis at version `prdVersion`.
- Anti-leading + dimension tagging are deterministic ⇒ **zero added model calls
  per turn**; only the critic adds one call, at finalize, off the hot path.
- Out of scope by design: the representation half of TSE (sampling, weighting,
  coverage) — meaningless for an n=1 tool.

## Open to-dos (priority order)

1. **Live-QA the full multi-round + operator flow.** No DB/API key in the
   container, so this has never run live. Migrations `0003`+`0004` are additive
   and auto-apply on deploy via `vercel-build` (or `npm run db:migrate` locally).
   If the DB holds pre-`0003` completed rows, backfill
   `update sessions set status='complete' where completed_at is not null`
   (admin was locked out, so likely none). Then run an interview end-to-end and
   verify: yes/no/done is the only surface; a leading question is rewritten;
   turns carry dimension/regen metadata; the **coverage gate** keeps the round
   going until ≥7/10 dimensions before the PRD; the round finalizes to
   `awaiting_review` (NOT auto-completed); the critic verdict shows in admin; then
   **Open another round** → respondent resumes via the *same* link → **Mark
   complete** consumes the invite. Check admin detail (version history + diff +
   analysis + critic verdict), the three download routes, and the export JSON.

2. **Re-baseline the canary suite.** Still a sentinel (`"model": null`,
   `"seeds": {}`), AND the generation policy has changed twice now: anti-leading
   reject in `run-one.ts`, and (2026-06-16) the **coverage gate** is mirrored in
   `run-one.ts` too — so the baseline MUST be captured against this behavior
   (coverage-gated stops may raise turn counts vs. the old early-stop runs). Run
   `npm run canary:rebaseline` once with
   `ANTHROPIC_API_KEY` + production `ANTHROPIC_MODEL`, eyeball the per-seed table,
   commit with a message explaining the baseline conditions. Confirm the repo has
   secret `ANTHROPIC_API_KEY` and var `ANTHROPIC_MODEL`.

_Recently closed (full detail in history.md): admin login restored (password
rotated, 2026-06-16); `NEXT-SESSION.md` retired + puppy/lottie removed; operator-
gated rounds + coverage gate shipped._

## Backlog / deferred ideas (not committed work)

- **Close the construct-brief loop?** Still log-only. The audit story it was
  waiting on now exists (per-turn `constructDimension` tagging + the per-round
  analysis/coverage map), so feeding the brief into the interview prompt is now
  more defensible — but still deferred; revisit deliberately.
- **Resume-phrase resolver route.** `resumePhrase` is generated + stored but
  there's no `phrase → token` lookup yet; a respondent who loses the link can't
  self-resume. Low priority (anonymous, pull-based by design).
- **Per-round download routes.** `prd/[id]/analysis` (+ prd/methodology) serve
  the *latest* round only; older versions are viewable inline in admin detail but
  not individually downloadable. Add `?v=` if needed.
- **Ship the construct brief itself as a companion file** (`brief-<id>.md`).
  The analysis companion file already shipped; the brief still lives only in the
  session record + admin view.
- **Subset audit of historical transcripts** — methodology doc still states none
  conducted; a periodic human spot-check would let that line claim more.

## Minor observations (low priority, not blocking)

- **Rate limiter is in-memory and per-instance** (`middleware.ts` `Map`), so on
  Vercel it isn't shared across serverless instances and resets on cold start.
  Fine for an invite-only tool; revisit only if abuse becomes real.
- **Naming residue:** package name is still `idea-seeder`, the admin cookie is
  `idea_seeder_admin`, and the recipient env var is `DAVIN_EMAIL` — the product
  is "Verity". Cosmetic; renaming the cookie would log out current admins.
- **Moderation fails open** by design — acceptable given the prefilter, but worth
  remembering if the threat model changes.
- **Coverage floor is 7/10 and untuned against live data** (`COVERAGE_FLOOR` in
  `coverage.ts`). The dimension classifier is keyword-based/blunt, so revisit the
  floor once live QA shows real coverage distributions.

## Conventions / gotchas

- Operator/recipient is referred to as **"Davin"** in code comments and the
  `DAVIN_EMAIL` env var — that's the human who receives finished PRDs.
- Methodology/disclosure copy cites specific AAPOR §§ — match that citation
  style when extending it (see `disclosure.ts` header comment).
- Canary `baseline.json` must **never** be silently rebaselined; an explicit
  reason in the commit message is the rule, else drift detection is theater.
- Develop on the designated feature branch; commit + push there; never open a PR
  unless explicitly asked.
- **UI/UX changes are reviewed against [ux-source-of-truth.md](ux-source-of-truth.md)**
  (interaction + a11y) alongside [design.md](design.md) (visuals); log findings/fixes
  in [ux-audit.md](ux-audit.md) and keep its status column current.
