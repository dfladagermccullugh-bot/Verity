# Verity — Session Handoff

Lean, session-to-session working memory. Keep this under ~5k tokens. When an
item goes stale or a to-do is done, move it to [history.md](history.md) and
trim it from here.

_Last updated: 2026-06-16 (retired NEXT-SESSION.md + puppy/lottie cleanup; to-dos 1–3 still need a live env)_

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
  ROUND loop: (model → guard → anti-leading → persist turn w/ metadata)
    → on done / 40-turn ceiling / model-stop → force PRD
    → finalize round (freeze PRD + methodology + analysis, vN) → email
    → gap-analysis critic → open next round (auto) OR complete + consume invite
durable anonymous link resumes into the next round on revisit (pull-based)
```

Key files:
- `src/lib/interview-engine.ts` — **round-aware** turn loop, retry policy (guard + anti-leading), 40-turn ceiling, `forcePrd`, `finalizeRound` (per-round PRD/methodology/analysis + critic + next-round/complete).
- `src/lib/guard.ts` — deterministic *form* classifier → `question | stop_confirm | prd | reject`. Rejects multiline, batched, jargon, >200 chars, missing `?`.
- `src/lib/anti-leading.ts` — deterministic *semantic* check; rejects tag questions, loaded openers, presupposition. Runs in the same retry loop; no model call.
- `src/lib/dimensions.ts` — keyword classifier mapping each question to one of 10 coverage dimensions (per-turn tag; drives coverage + triangulation).
- `src/lib/analysis.ts` — pure per-round metrics (acquiescence, straightlining, latency, leading rate, coverage, triangulation reliability) + markdown render.
- `src/lib/critic.ts` — between-round gap-analysis (`callModelOneShot`); fail-safe (never opens a round on parse/transport error). Off the hot path.
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

**Data model (post-0003):** `sessions` is the durable respondent container
(`status` active|complete, `resumePhrase`, `seedWarnings`, + latest-round mirror
of `prdMarkdown`/`methodologyMarkdown`/`completedAt`). `rounds` (canonical per
version): `roundNumber`, `prdVersion`, `status`, `terminationReason`,
`focusBrief`, and frozen `prd/methodology/analysisMarkdown`. `turns` gained
`roundId` + measurement metadata (`constructDimension`, `regenCount`,
`guardRejections`, `leadingVerdict`, `isTriangulationProbe`, `deviceClass`,
`viewport`).

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
- `npm test` — **109 passing** (was 65; +44: anti-leading 10, dimensions 7,
  analysis 8, critic 7, seed-quality 5, disclosure +7). Existing suites green.
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
- **Fully automated critic** — opens the next round itself at finalize; no
  operator approval step. Fail-safe: never opens on a parse/transport error.

**Design notes worth remembering:**
- Routing is driven by *pending-turn presence*, not `completedAt`: a pending turn
  → `/q`; else `status==="complete"` → `/done`. `/done` is sticky after a round
  (does not bounce into a queued next round); the respondent reaches round N+1 by
  reopening their link.
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
   `"seeds": {}`), AND the generation policy changed this session (anti-leading
   reject added to `run-one.ts`, attempts 2→3), so the eventual baseline must be
   captured against the new behavior. Run `npm run canary:rebaseline` once with
   `ANTHROPIC_API_KEY` + production `ANTHROPIC_MODEL`, eyeball the per-seed table,
   commit with a message explaining the baseline conditions. Confirm the repo has
   secret `ANTHROPIC_API_KEY` and var `ANTHROPIC_MODEL`.

3. **Admin login is locked out (deferred by user).** `ADMIN_PASSWORD` is a
   *Sensitive* Vercel env var, so its value is write-only and unrecoverable; the
   original was generated by a prior agent and not saved. Until it's rotated (set
   a new `ADMIN_PASSWORD` in Vercel → redeploy) no one can reach `/admin/*` to
   issue invites or read PRDs. The app reads it from `process.env.ADMIN_PASSWORD`
   (`src/actions/admin.ts`); nothing is hard-coded. **Do not commit the secret to
   this repo.** User chose to defer rotation on 2026-06-14.

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
- **Critic-trigger is model-judged + invisible (from a 2026-06-15 live test).** A
  follow-up round opens only when the critic (`src/lib/critic.ts`) returns
  `openNewRound: true` *and* a non-empty `focus`; it's instructed to do so only on
  a material gap, fail-safes to "stop" on any malformed/errored output, and is
  fully automated (no admin button by design). **Gap:** when the critic declines,
  its verdict/reasoning is **not persisted** (`focusBrief` is saved only when a
  round opens), so a one-round session has no record of *why* it stopped.
  Candidate next-session work: (a) persist the critic verdict every finalize;
  (b) optional manual "open another round" control in admin. A user test session
  closing out after one round is expected behavior, not a bug.

## Conventions / gotchas

- Operator/recipient is referred to as **"Davin"** in code comments and the
  `DAVIN_EMAIL` env var — that's the human who receives finished PRDs.
- Methodology/disclosure copy cites specific AAPOR §§ — match that citation
  style when extending it (see `disclosure.ts` header comment).
- Canary `baseline.json` must **never** be silently rebaselined; an explicit
  reason in the commit message is the rule, else drift detection is theater.
- Develop on the designated feature branch; commit + push there; never open a PR
  unless explicitly asked.
