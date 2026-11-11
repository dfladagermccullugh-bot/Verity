# Verity — Session Handoff

Lean, session-to-session working memory. Keep this under ~5k tokens. When an
item goes stale or a to-do is done, move it to [history.md](history.md) and
trim it from here.

_Last updated: 2026-11-11 (Verity Voice demo page rebuilt, see "Start here"). Legacy app: 2026-11-10 (state-machine work shipped, PR #48: re-entrant claim-then-advance engine, guard/protocol fixes, guarded migration `0006`, canary repaired + 14 false drift issues closed, respondent/operator flow fixes. Verified by typecheck + **270 tests** + build + PGlite/PG16 integration + Playwright client check; **live QA with a real DB + model still pending**. Detail in history.md; what remains is in [state-machine-plan.md](state-machine-plan.md).)_

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

## Start here next session (written 2026-11-11)

The operator is being walked through getting Verity Voice fully running, **one step at a
time** (their instruction: give one thing, wait until it is done, then the next). They are
not deeply technical and want short, plain replies. Prefer routes that need no installs on
their computer: GitHub Actions, and the Fly.io / Neon / Vercel dashboards in a browser.
Secrets go into GitHub or Fly.io secret settings, never into chat.

**Where the walkthrough stands**

1. Done: the browser demo is online at https://verity-voice-demo.fly.dev. It is deployed by
   `.github/workflows/voice-deploy.yml` (manual: Actions tab, or `run_workflow` with input
   `app: verity-voice-demo`; it deploys the branch it is run on). The repo secret
   `FLY_API_TOKEN` is set.
2. Done: the operator tried the first demo. Verdict: "very rudimentary", "not at all what we
   want". They named three things (interface, real voices, a good model) and said there are
   "a lot of things I kind of don't agree with", not yet specified. Ask, one at a time; do
   not guess.
3. Done (2026-11-11, second session): `voice/src/server/demo.html` rebuilt to the operator's
   reference (`voice/docs/design/interface-reference.webp`). Detail in history.md. **The
   operator has not yet said whether it is what they want; ask before building on it.**
   Open choices made without asking, to confirm: the brand reads "verity / voice" (the
   reference's "human / loop" was not adopted); the headline copy is the reference's
   ("Space to speak. / A conversation, taking shape."); a fourth pill button (keyboard)
   opens the keypad, typed reply and transcript; dark mode follows the device.

4. Done (2026-11-11, second session), **built but never run against a real vendor**: the
   demo can use the server's own voice and hearing. With `DEEPGRAM_API_KEY` set the page plays
   server-rendered recordings (`/demo/audio/<line id>`, 24 kHz WAV) and sends its microphone
   over the same connection (binary: 4-byte page clock + 16 kHz 16-bit samples); the server
   runs the recogniser and decides the turns (`browser-channel.ts`). The ribbon follows the
   real sound (six pitch bands per side; `ribbon.follow`). Without keys nothing changes: the
   browser's own speech is used. Detail in history.md.

**Deepgram is live (2026-11-11).** The operator added the repository secret
`DEEPGRAM_API_KEY`. The `compare-voices` task passed on its first live run (37 lines rendered
with `aura-2-thalia-en`; heard back 98.6% correctly; 24 kHz page WAV correct; streaming
recogniser heard the test line exactly, with speech-start and end-of-utterance events). The
demo is deployed from this branch and its log reads "Demo voice: deepgram/aura-2-thalia-en/page.
Demo hearing: deepgram/nova-3." **Waiting on the operator** to try it in a real browser with a
real microphone and loudspeakers (never done) and say what is wrong.

**Operator's direction (2026-11-11, after hearing the Deepgram voice):** the focus is voice
through calling. The ribbon is parked: they want it to become "its own independent voice
thing" later, and it need not be worked on now (they did not report whether it moved with
the sound; do not build on it). Order they gave: hook up the models, then Qualtrics, then
Telnyx.

**The language model is live (2026-11-11).** The operator added `ANTHROPIC_API_KEY`. First
live measurement (task `measure-model`, `claude-haiku-5-5/prompt-v1`, 298 hand-written
replies): 96.3% acceptable; model-decided 167, 93.4% right; 0 wrong answers recorded without
a probe; 20 right answers probed anyway. All 11 misses were on the cautious side: plain
answers called unclear ("monthly", "once every two weeks", "around 40", self-corrections
like "five, no, six"), so the caller is re-asked. Worth a prompt revision later (bump
`CLASSIFIER_PROMPT_VERSION`, re-measure); not blocking. The demo server now has the key (its health check reports
`claude-haiku-5-5/prompt-v1`).

**Qualtrics import, in progress (2026-11-11).** The operator's first import of the
hand-written `library-test.qsf` failed with Qualtrics' generic "Something went wrong and the
project wasn't created". The file was compared with a genuine export (QualtricsTools'
"Better Sample Survey", fetched from raw.githubusercontent.com) and corrected: the question
count belongs in `SecondaryAttribute` with a null payload; skip logic sits on the block's
entry for the question, not in the question; IDs are 15 letters and digits; `SCO` and `STAT`
entries added; skin given in the current object form. Which of these Qualtrics objected to
is unknown. **Waiting on the operator** to import the corrected `library-test.qsf`, and if it
fails, `import-probe.qsf` (two plain questions), and report which worked. If both fail:
suspect the account or a passing Qualtrics fault before the file. If only the probe works:
halve the full file (NPS question, matrix, display logic, embedded data are the suspects).
Then steps 2 to 5 of `voice/docs/qualtrics-test-survey.md`, one per turn.

**Next, in this order (one per turn)**

- Cartesia key + voice id (`what-needs-you.md` §G) so the voices can be compared by
  listening; other vendors the operator has named (Fish Audio) have no adapter yet. They
  also named OpenRouter and Hugging Face keys; nothing uses them. Ask before building.
- Qualtrics: the import check (§C) needs their Qualtrics login.
- Telnyx: first real call to their own phone (§H).
- Cutting in by voice (`DEMO_BARGE_IN=1`) is off: untested echo risk through loudspeakers.
- Ask the operator what else they do not agree with (they said "a lot"; unspecified).
- Still open from before: rotate the legacy Neon password.

**Checking the demo page** (the page is read once at server start, so restart after edits)

- `cd voice && PORT=3311 HOST=127.0.0.1 npx tsx src/server/index.ts`, then
  `node scripts/demo-check.cjs http://127.0.0.1:3311 <dir>` (read-and-type mode, three
  screen sizes, one dark; saves screenshots; follows `<body data-phase>`) and
  `node scripts/demo-voice-check.cjs http://127.0.0.1:3311 <dir>` (browser-speech logic
  with stand-ins for the browser's speech features).
- Server voice path: `PORT=3312 npx tsx scripts/demo-standin-server.ts` (a hum for a voice,
  a scripted "recogniser"), then `node scripts/demo-server-voice-check.cjs
  http://127.0.0.1:3312 <dir>` (headless Chromium with a fake microphone).
- Look at the screenshots. Real speech in a real browser has only been tried by the
  operator, on the old page.
- A new workflow file cannot be started until it is on `main`; that is why the live vendor
  check is a task inside `voice-deploy.yml` (which can be run from this branch).

**Things learned the hard way this session**

- Anything the server needs at run time must be under `dependencies`: with
  `NODE_ENV=production`, npm skips `devDependencies` even when asked for by name (`tsx`).
  Rehearse image steps locally with `NODE_ENV=production` exported for every command.
- A Fly.io release does not restart a machine that is stopped (for example after a crash
  loop); the deploy job now starts machines explicitly, and `auto_start_machines` is on.
- `flyctl deploy` reported success while the server was down; trust the job's final
  "Check the server answers" step, not the deploy step.
- This container cannot reach `*.fly.dev`; verify the live site through the deploy job.
- The reference image carries the name "human / loop". Do not adopt it as the product name
  without asking: there is an existing AI company called Humanloop.
- `main` now carries all of this work (the operator asked for it to be pushed to `main`,
  which redeploys the unchanged legacy app on Vercel). Verity Voice does not run on Vercel.

## Verity Voice — new product (started 2026-11-10)

AI voice survey interviewers on top of Qualtrics. Plan and phase status table:
[voice-interviewer-plan.md](voice-interviewer-plan.md). Product README:
[voice/README.md](voice/README.md). Lives in `voice/` (own `package.json`, Node 22, vitest,
own Postgres schema). The web app described in the rest of this file is now the **legacy
app**: unchanged at the root (its `tsconfig.json` excludes `voice/`), to be switched off later.

- **State (2026-11-11):** all code that needs no account login is built; 355 tests
  (`cd voice && npm test`); database tests also pass on real Postgres 16
  (`TEST_DATABASE_URL=… npx vitest run test/dialer-store.test.ts`).
- **Never run live:** Telnyx calls, Deepgram/Cartesia speech, the Claude classifier, a
  Qualtrics import, the Docker image. `voice/README.md` lists each under "What has not been
  verified". Do not describe any of them as working.
- **Operator-only, open:** rotate the legacy Neon password (before the repo goes public),
  Qualtrics import check, keys, Fly deploy, legal review before calling third parties.
  See `voice/docs/what-needs-you.md`.
- **Done for the operator:** legacy sessions archived as Neon branch `archive-2026-11` in
  project `square-bar-42098811` (15 sessions / 8 rounds / 225 turns / 18 invites, verified);
  legacy code bookmarked as branch `legacy/idea-seeder-v1` (tags cannot be pushed from cloud sessions).
- **Design rules not to break:** the interviewer speaks only by line id from the speech table;
  model verdicts are checked in code (`checkVerdict`); consent, hours, do-not-call and the
  dial allowlist are code with tests, not settings; JSON is written as `$n::text::jsonb`
  (postgres.js double-encodes otherwise); generated docs (`docs/sample-*.md|csv`) are
  regenerated with `UPDATE_SAMPLES=1 npm test`.
- **Operator instructions:** carrier is Telnyx, no Twilio; voice models chosen by measured
  comparison (`npm run bakeoff`), not by what is already set up; proceed without per-phase
  sign-off; minimise what is asked of the operator.
- **Parallel agents:** `.claude/worktrees/` is git-ignored; never `git add -A` it.
- `phone_map` (separate repo) was the source of `voice/src/telephony/`.

## Method (the two core bets)

1. **Constraint as interface.** Reduce the user to three buttons; a well-aimed
   yes/no is worth a paragraph of vague prose.
2. **Hard guardrails, not soft prompting.** The system prompt asks for good
   behavior; `guard.ts` *enforces* it. Bad output → regenerate with a corrective
   message naming the reason → after 3 rejections the round ends
   `guard_exhausted` and the PRD is forced (validated; else `prd_failed`). The
   model is never trusted to self-format.

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
- `src/lib/interview-engine.ts` — **claim, then re-entrant advance.** `submitAnswer(sessionId, turnId, …)` = one conditional UPDATE; `advance(sessionId)` is idempotent (returns the pending turn, else generates + claims the next turn or finalizes) and is the recovery path for interrupted sessions (`/q`, `startSession`, admin Resume). Every write is a short transaction locking the session/invite row and re-checking its precondition — **never hold a tx across a model call (pool `max: 1`)**. Also `openFollowupRound` (generate first, then claim), `completeReviewedSession`, `closeStalledSession` (`abandoned`), `revokeUnusedInvite`.
- `src/lib/interview-policy.ts` — generation policy shared with the canary (model injected): retries + corrective message, `exhausted` shape, coverage nudge, `forcePrd` (fallback validated: ≥7/14 headings), `RUNAWAY_CEILING`.
- `src/lib/lifecycle.ts` — all status/reason/answer unions (schema typed from them), transition table, `deriveRespondentView` / `deriveOperatorState`, `latestPrdRound`. `src/lib/respondent.ts` = the one respondent-routing loader; `src/lib/interview-store.ts` = executor-taking queries; `src/lib/interview-state.ts` = client reducer.
- `src/lib/coverage.ts` — **pure** content-validity gate: covered/uncovered dimensions + `coverageMet` (`COVERAGE_FLOOR = 7` of 10, tunable). Blocks a *model* stop until coverage met; an explicit "done" always wins.
- `src/lib/guard.ts` — deterministic *form* classifier → `question | stop_confirm | prd | reject`. Rejects multiline, batched, jargon (**word-boundary**; react/rust/rest only in tech spelling), >200 chars, missing `?`. Stop confirmation matched tolerantly.
- `src/lib/anti-leading.ts` — deterministic *semantic* check; rejects tag questions, loaded openers, presupposition. Runs in the same retry loop; no model call.
- `src/lib/dimensions.ts` — keyword classifier mapping each question to one of 10 coverage dimensions (per-turn tag; drives coverage gate + analysis + triangulation).
- `src/lib/analysis.ts` — pure per-round metrics (acquiescence, straightlining, latency, leading rate, coverage, triangulation reliability) + markdown render.
- `src/lib/critic.ts` — between-round gap-analysis (`callModelOneShot`); **advisory only** — verdict persisted on the round, a human opens/closes rounds. Failure → `null` ("not assessed"), never "no round needed". Runs after the finalize commit.
- `src/actions/admin.ts` — `openRound` / `completeSession` server actions (admin-gated); admin UI in `prds/[id]` (`round-actions.tsx`) surfaces them when `awaiting_review`.
- `src/lib/seed-quality.ts` — non-blocking seed warnings (vague / double-barreled / presupposition / too-short).
- `src/lib/construct-brief.ts` — AAPOR §4.3.1 pre-flight probe (now also captures decision + unit); **log-only**, non-fatal.
- `src/lib/disclosure.ts` — PRD header + methodology + **analysis** companion docs; provenance + version **frozen per round**.
- `src/lib/model-client.ts` — raw calls, no `server-only`, returns `stop_reason`, 50s timeout; `src/lib/anthropic.ts` = server-only binding (`callModel` → `{text, stopReason}`, `callModelOneShot` → string). Model from `ANTHROPIC_MODEL`, default `claude-sonnet-4-6`; `MAX_TOKENS=4096`.
- `src/lib/canaries/` + `scripts/canary.ts` — weekly drift suite; `run-one.ts` uses the **same policy module** as the engine; skill read via `fs`; baseline checked before spending. Exit codes: 0 ok · 2 config · 3 fixture · **10 drift** (only 10 opens an issue).

Stack: Next.js 14 (App Router, server actions), React 18, TS. Postgres via
Drizzle (`invites`, `sessions`, `rounds`, `turns` — migrations through `0006`).
iron-session admin auth, Resend email, Tailwind (Warm Paper Calm design
system; `--md-*` token names retained), Framer Motion. Deployed on Vercel
(`vercel-build` = `drizzle-kit migrate && next build`).

**Data model (post-0006):** unique `sessions(invite_id)`, `rounds(session_id, round_number)`, `turns(session_id, step)`, partial unique `turns(session_id) WHERE answer IS NULL`, index `turns(round_id)` — each created only if no duplicates remained (check the build log for `0006:` warnings); the engine enforces the same invariants either way. Termination reasons add `guard_exhausted`, `prd_failed`, `abandoned` (now written); a failed round has no PRD and the session keeps the previous mirror. Earlier:  `sessions` is the durable respondent container
(`status` **active | awaiting_review | complete**, `archivedAt` (migration `0005`,
operator-set list-hide; row retained + still exported), `resumePhrase`, `seedWarnings`,
+ latest-round mirror of `prdMarkdown`/`methodologyMarkdown`/`completedAt`).
`rounds` (canonical per version): `roundNumber`, `prdVersion`, `status`,
`terminationReason`, `focusBrief`, frozen `prd/methodology/analysisMarkdown`, and
(migration `0004`) the persisted advisory critic verdict `criticRecommendOpen` /
`criticGaps` / `criticFocus`. `turns`: `roundId` + measurement metadata
(`constructDimension`, `regenCount`, `guardRejections`, `leadingVerdict`,
`isTriangulationProbe`, `deviceClass`, `viewport`). Routing keys off **status +
pending turn** (`deriveRespondentView`): pending → `/q`; active without one →
`/q` resumes; awaiting review / complete → `/done`.

## Design system — Warm Paper Calm (shipped)

Two governing docs: [design.md](design.md) is the **visual** source of truth
(Warm Paper Calm tokens — color/type/radius/elevation); [ux-source-of-truth.md](ux-source-of-truth.md)
is the **interaction & accessibility** source of truth (Laws of UX, target sizes,
focus, motion, error handling, ethics). All UI work is reviewed against both. The
running gap analysis lives in [ux-audit.md](ux-audit.md) — **as of 2026-06-16 all
P0/P1/P2 items are implemented (verified by typecheck + tests + build; live a11y
verification still pending). P2-4 closed as wontfix.** Keep that file current.

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
  verified via `tsc` + `next build` + tests, not pixels. Eyeball with `npm run dev`.
- **Dark-mode toggle shipped** (`src/components/theme-toggle.tsx`, in the admin
  header + invitee footer): sets an explicit `[data-theme]` override + persists to
  `localStorage`; a no-flash script in `layout.tsx` applies it before paint. OS
  preference still applies absent a choice. (Dark `--md-hairline` was raised to #444
  this session — it had equalled the card fill, making borders invisible in dark.)

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

## Current health (verified 2026-11-10)

- `npm run typecheck` clean · `npm test` **270 passing** (incl. engine integration
  on PGlite with and without the 0006 indexes, migration-0006 suite) ·
  `npm run build` passes. Same on `main` after merging PR #48.
- `npm run e2e:interview` — Playwright against `next dev` via the dev-only
  `/dev/interview` harness (stubbed actions; renders not-found in prod). Needs a
  Playwright Chromium (preinstalled in cloud sessions; not a dependency).
- **Never run live with a real model.** `ANTHROPIC_API_KEY= npx tsx
  scripts/canary.ts` now exits 2 with the key message (was a crash). Real
  concurrency and `drizzle-kit migrate` were exercised on a local PostgreSQL 16
  (installed in the container; `initdb` as the `postgres` user).
- **CI:** there is no PR workflow; the only PR check is the Vercel preview build,
  which runs `drizzle-kit migrate` (against whatever DB previews use) + build.
- **Bootstrap:** the `SessionStart` hook runs `npm install` in cloud sessions.
  No ESLint config — the static gate is `npm run typecheck`.

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
- Routing: a pending turn → `/q`; active without one → `/q` resumes (`advance`);
  otherwise `/done`, which leaves only for a waiting question (no loop). The
  respondent reaches round N+1 when the operator opens it and they reopen the link.
- Follow-up rounds re-inject the focus every turn and gate coverage session-wide;
  focus + version come from the latest **PRD-bearing** round.
- Invite is consumed only at **true** completion, so the durable link keeps
  resolving across rounds.
- Each round freezes its own PRD/methodology/analysis at version `prdVersion`.
- Anti-leading + dimension tagging are deterministic ⇒ **zero added model calls
  per turn**; only the critic adds one call, after the finalize commit.
- The skill's opening "mirror … Ready?" turn is tagged `mirror` and excluded from
  coverage + analysis (skill prompt untouched on purpose: `skillVersion` stable).
- Out of scope by design: the representation half of TSE (sampling, weighting,
  coverage) — meaningless for an n=1 tool.

## Open to-dos (priority order)

1. **Check migration 0006 in the production build log** for `0006: … skipped`
   warnings (= an index was not created; invariant still enforced in code). Fix
   duplicates + add a guarded `0007` if needed. Details: state-machine-plan.md.

2. **Live-QA the full flow** with a real DB + model (never done). Interview
   end-to-end: yes/no/done only; leading question rewritten; turns carry
   dimension/regen metadata; coverage gate holds to ≥7/10; round →
   `awaiting_review`; critic verdict in admin; **Open another round** → same link
   resumes, focus steers every turn → **Mark complete** consumes the invite. Also:
   kill a request mid-answer (or set a bad API key briefly) → `/q` shows Try again
   and resumes; admin shows **Stalled** with Resume / Close; unused invite →
   Revoke. Check admin detail, the three download routes, the export JSON. Run the
   UX/a11y checklist in [ux-audit.md](ux-audit.md) at the same time.

3. **Re-baseline the canary** (`baseline.json` is still the sentinel). The
   policy changed again (corrective retries, tolerant stop, boundary jargon,
   validated PRD fallback, mirror tagging). `npm run canary:rebaseline` with
   `ANTHROPIC_API_KEY` + production `ANTHROPIC_MODEL`, review, commit with the
   baseline conditions. Confirm repo secret `ANTHROPIC_API_KEY` + var
   `ANTHROPIC_MODEL` exist so the weekly run works.

_Recently closed (detail in history.md): **state machines (PR #48)** — dead-end
recovery, atomic/locked writes, guard false positives, latency paradata, canary
repair + false issues #13–#46 closed, migration 0006; UX/UI source of truth +
a11y audit; operator-gated rounds + coverage gate._

## Backlog / deferred ideas (not committed work)

- **CHECK constraints** on status/reason/answer (`0007`, `NOT VALID` then
  `VALIDATE`) once production data is confirmed clean.
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

- **⚠️ SECURITY — leaked DB credential in git history.** `.claude/settings.local.json`
  was committed since the initial build and contains a live Neon `DATABASE_URL`
  (with password). This session **untracked it + added it to `.gitignore`**, but the
  credential is still in history. **Action for the operator: rotate the Neon
  password** (and consider a history scrub). The local file is kept on disk so admin
  tooling/permissions still work in-session.

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
- **Migrations run on every Vercel build, previews included.** Write them
  idempotent and unable to fail (per-statement exception blocks, `lock_timeout`),
  never delete respondent data; test with `src/tests/migration-0006.test.ts` as
  the pattern (apply 0000..N-1, seed dirty rows, apply N, re-run).
- State changes go through the engine's locked claims — don't add direct
  `db.update(sessions)` status writes in actions/pages.
- Develop on the designated feature branch; commit + push there; never open a PR
  unless explicitly asked.
- **UI/UX changes are reviewed against [ux-source-of-truth.md](ux-source-of-truth.md)**
  (interaction + a11y) alongside [design.md](design.md) (visuals); log findings/fixes
  in [ux-audit.md](ux-audit.md) and keep its status column current.
