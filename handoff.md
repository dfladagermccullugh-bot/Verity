# Verity — Session Handoff

Lean, session-to-session working memory. Keep this under ~5k tokens. When an
item goes stale or a to-do is done, move it to [history.md](history.md) and
trim it from here.

_Last updated: 2026-06-16 (operator-gated rounds + coverage gate shipped; critic now advisory)_

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
- `src/lib/canaries/` + `scripts/canary.ts` — weekly drift suite (`run-one.ts` mirrors the anti-leading reject so canary tracks real behavior).

Stack: Next.js 14 (App Router, server actions), React 18, TS. Postgres via
Drizzle (`invites`, `sessions`, `rounds`, `turns` — see migration `0003`).
iron-session admin auth, Resend email, Tailwind (Midnight Precision design
system; `--md-*` token names retained), Framer Motion. Deployed on Vercel
(`vercel-build` = `drizzle-kit migrate && next build`).

**Data model (post-0004):** `sessions` is the durable respondent container
(`status` **active | awaiting_review | complete**, `resumePhrase`, `seedWarnings`,
+ latest-round mirror of `prdMarkdown`/`methodologyMarkdown`/`completedAt`).
`rounds` (canonical per version): `roundNumber`, `prdVersion`, `status`,
`terminationReason`, `focusBrief`, frozen `prd/methodology/analysisMarkdown`, and
(migration `0004`) the persisted advisory critic verdict `criticRecommendOpen` /
`criticGaps` / `criticFocus`. `turns`: `roundId` + measurement metadata
(`constructDimension`, `regenCount`, `guardRejections`, `leadingVerdict`,
`isTriangulationProbe`, `deviceClass`, `viewport`). Routing now keys off
`completedAt` (a finalized round → `/done`; a new pending turn → `/q`).

## Design system — Midnight Precision (shipped)

Dark-only Technical Minimalism: obsidian surfaces, **Signal Gold** (`primary
#f2ca50` / `#d4af37`) as the sole accent, **Inter**, sharp corners (0px
containers / 4px interactive), no shadows, flat tonal layering + 1px charcoal
hairlines. Palette = `--md-*` vars in `globals.css` (token *names* unchanged, so
components stayed token-driven; added `hairline #2a2a2a`). Type scale / radii /
animations in `tailwind.config.ts`; shared instrument chrome in
`src/components/chrome.tsx` (footer `PROTOCOL` = real skill fingerprint). Tone is
"precision" (puppy + gardening words retired). Full detail in history.md.

- **Deliberate calls:** design.md prose contradicted its own tokens/screenshot —
  followed tokens+screenshot (gold primary not white; `#131313` not pure black).
  Screenshot's DECLINE/CONFIRM was a mock; kept the real yes/no/done contract
  (YES=gold, NO=hairline).
- **Per-page:** landing (`/`) + admin login (`/admin/login`) are stripped of
  chrome (no scanline/header/footer) — just grid + centered `Verity` wordmark;
  login language plain. The invitee flow (seed/interview/done) keeps full chrome.

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

## Current health (verified this session)

- `npm run typecheck` — clean. `npm run build` — passes (all routes incl. new
  `prd/[id]/analysis` compile).
- `npm test` — **120 passing** (+11 coverage gate; was 109). Existing suites green.
- **Not run live this session** (no `DATABASE_URL` / `ANTHROPIC_API_KEY` in the
  container): the dev server / multi-round end-to-end and the canary's actual
  model run. Logic verified by typecheck + unit tests only — **needs live QA**.
- Note: a fresh clone needs `npm ci`. The canary under `tsx` also needs the
  `server-only` shim/package (pre-existing; not installed here).
- All three original AAPOR iterations remain shipped (PRs #5–#12). The
  **survey-methodology measurement layer (15 features)** is now shipped on top
  (this session) — see history.md.

## Multi-round + measurement layer (shipped this session)

The multi-round feedback loop and the 15-feature survey-methodology layer are
**built and merged** (full detail in history.md). Sacred constraint held: the
respondent surface is still exactly yes/no/done — every new feature is backend /
operator-side.

**Decisions that were locked (and how they landed):**
- **Zero typing ever** — no escape-hatch text box, no fourth button. Gap-catching
  is entirely the automated between-round critic. So "it depends" / yes-drift are
  handled *analytically* (acquiescence + straightlining + triangulation), not via
  UI.
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

1. **Apply migration `0003` + live-QA the multi-round flow.** Migration
   `drizzle/0003_rounds_and_measurement.sql` is generated but **not applied**
   (no DB in the build container). It is additive/non-destructive, but assumes
   **empty/dev data**: `sessions.status` defaults to `active`, so any pre-existing
   completed session would read as "in progress" until backfilled
   (`update sessions set status='complete' where completed_at is not null`).
   Confirm no real rows (admin is locked out, so likely none) or backfill, then
   run a real interview end-to-end: verify yes/no/done is still the only surface,
   a leading question gets rewritten, turns carry dimension/regen metadata, a
   round finalizes, the critic opens round 2, and reopening the link resumes into
   it. Check admin detail (version history + diff + analysis), the three download
   routes, and the export JSON shape.

2. **Re-baseline the canary suite.** Still a sentinel (`"model": null`,
   `"seeds": {}`), AND the generation policy has changed twice now: anti-leading
   reject in `run-one.ts`, and (2026-06-16) the **coverage gate** is mirrored in
   `run-one.ts` too — so the baseline MUST be captured against this behavior
   (coverage-gated stops may raise turn counts vs. the old early-stop runs). Run
   `npm run canary:rebaseline` once with
   `ANTHROPIC_API_KEY` + production `ANTHROPIC_MODEL`, eyeball the per-seed table,
   commit with a message explaining the baseline conditions. Confirm the repo has
   secret `ANTHROPIC_API_KEY` and var `ANTHROPIC_MODEL`.

3. **Admin login — RESOLVED 2026-06-16.** `ADMIN_PASSWORD` was rotated by the
   user in Vercel (set as a non-sensitive var this time, so it stays viewable)
   and redeployed; `/admin/*` is reachable again. The app reads it from
   `process.env.ADMIN_PASSWORD` (`src/actions/admin.ts`); the secret is **not**
   committed to this repo by design. (History of the lockout is in history.md.)

_(To-dos 4 & 5 — retire `NEXT-SESSION.md` and the puppy/lottie reskin cleanup —
were completed 2026-06-16; see history.md. The README "Stack" line + branding had
already been refreshed in `c4bc1ef`, so nothing remained there.)_

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
  The *analysis* companion file shipped this session; the brief still lives only
  in the session record + admin view.
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
- **~~Critic-trigger is model-judged + invisible~~ — RESOLVED 2026-06-16.** Both
  gaps from the 2026-06-15 live test are fixed: (a) the critic verdict is now
  persisted on every round (`criticRecommendOpen`/`criticGaps`/`criticFocus`) and
  shown in admin; (b) round-opening is a manual admin control (`openRound`). The
  "one-question round" that prompted this is also addressed by the coverage gate.

## Conventions / gotchas

- Operator/recipient is referred to as **"Davin"** in code comments and the
  `DAVIN_EMAIL` env var — that's the human who receives finished PRDs.
- Methodology/disclosure copy cites specific AAPOR §§ — match that citation
  style when extending it (see `disclosure.ts` header comment).
- Canary `baseline.json` must **never** be silently rebaselined; an explicit
  reason in the commit message is the rule, else drift detection is theater.
- Develop on the designated feature branch; commit + push there; never open a PR
  unless explicitly asked.
