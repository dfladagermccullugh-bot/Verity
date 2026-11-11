# Verity — Development History

The long-form archive. When [handoff.md](handoff.md) accumulates stale notes or
completed to-dos, they land here so the handoff stays lean. Newest first.

---

## 2026-11-11 — Verity Voice: live services, Qualtrics round trip, first real calls (working notes)

The handoff's "Start here" section as it stood at the end of that session, before it was
condensed. Kept for the detail: what each live run showed, in order.


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

**Qualtrics (2026-11-11).** The operator's free-trial account ("Start Free Trial" shown)
accepted the corrected `library-test.qsf` (first version was refused; the fixture was brought
into line with a genuine export: question count in `SecondaryAttribute`, skip logic on the
block entry, 15-character IDs, `SCO`/`STAT` entries; which mattered is unknown). Seen in
their editor: the NPS question with both end labels, the number question, the "Extra" block,
Q7's skip to end of survey. Qualtrics' only flags are accessibility/mobile tips about the
matrix (Q4), which concern the web form, not voice. Display logic on Q3/Q4 and the embedded
data fields were not on screen: confirm from the export. Survey name there: `verity_talk_test`.
Step 2 done: the operator exported it back; saved as `fixtures/qualtrics/library-test-real.qsf`.
It found a real reader bug: Qualtrics writes a map whose codes run 0, 1, 2, … as a plain list
(the 0-to-10 question's options), which the reader refused as "fewer than two answer
options". Fixed (`mapOf` in `qsf.ts`); the export now reads to the same questionnaire as the
hand-written file apart from name and ID (tested). Display logic and embedded data came
through Qualtrics intact. Qualtrics also adds `PL` and `PROJ` entries; the reader ignores them.
Step 3 done: Qualtrics reported "Import complete. 2 of 2 responses were successfully
imported." on the free-trial account, so the open question (can a free account import
responses?) is answered yes. Not yet seen: whether the values landed in the right fields.
Step 4 done: their data export is `fixtures/qualtrics/library-test-numeric.csv`. Every value
is in the field it was sent to (tested), skipped questions are blank, `vv_mode` and
`vv_case_id` came through. Qualtrics set Status to 4 (imported), its own RecordedDate and
ResponseId, and added `Q5_NPS_GROUP`. **Open point:** the dates came back unchanged but
labelled America/Los_Angeles: Qualtrics read our UTC times in the account's zone. Its import
dialog has a Timezone option; choosing UTC there should fix it (not tried). An in-file
`"timeZone"` key in the ImportId row is what Qualtrics' own exports carry and its importer
"tries to detect" it; writing it from our side is untested. Verify one or the other the next
time results are imported (after the first real call). **The Qualtrics check is complete.**

**First real call, in progress (2026-11-11).** The operator has a Telnyx account with a
number. Built for it (nothing run live yet): `voice-deploy.yml` tasks `look-at-telnyx`
(read-only listing via `voice/scripts/telnyx-look.ts`), `set-up-call` (one-contact campaign
from secrets; rehearsed on a local Postgres with a made-up number) and `stop-calls`; the
deploy task now hands the server the Telnyx keys, `VOICE_DATABASE_URL` (as `DATABASE_URL`),
`MY_PHONE_NUMBER` (as `DIAL_ALLOWLIST`), `PUBLIC_BASE_URL` and `TTS_VENDOR=deepgram`.
`TELNYX_API_KEY` is set. What `look-at-telnyx` showed (2026-11-11): one number (…8345)
attached to the Voice API application "phone-map" (webhook `https://phone-map.fly.dev/…`,
the operator's other project: **do not re-point or reassign**); one outbound profile
"Default" (US, CA); a credential connection "Forward Only". `GET /v2/public_key` returns the
account's public key, so it need not be copied by hand.
Plan: a second application, "verity-voice", created by task `set-up-telnyx`
(`voice/scripts/telnyx-env.ts ensure-app`), using the "Default" profile; calls are placed
from the existing number as caller ID while it stays attached to phone-map (so anyone
calling back reaches phone-map). Whether Telnyx lets an application call from a number
attached to another application is **unverified**; the first call will show. The deploy task
reads the connection ID, from-number and public key from the account itself.
The operator said yes; `set-up-telnyx` created the application "verity-voice"
(id 3090548507606517423, webhook at this server, API v2, "Default" profile). phone-map was
not touched. A Neon project for Verity Voice was created with the Neon connector:
`verity-voice`, id `cold-wildflower-22977142`, aws-us-east-1, Postgres 17, empty (the
server and the CLI run the migrations themselves).
`VOICE_DATABASE_URL` and `MY_PHONE_NUMBER` are set (the operator asked why their own number:
it is only the phone that receives the test call, any phone they can answer). `set-up-call`
ran (2026-11-11 03:42 UTC): a one-contact campaign is running in the new database and
`DIAL_CAMPAIGN_ID` is staged on Fly. **Nothing has been deployed since, so nothing dials yet.**
**First real call placed, 2026-11-11 03:46 UTC (7:46pm Pacific).** What it proved: Telnyx
accepted a call from the "verity-voice" application using the number attached to phone-map
as caller ID; the webhooks arrived and passed the signature check (public key read from the
account); the server rendered 36 lines with Deepgram first; the operator's phone logged a
missed call from …8345. What happened: the phone did not ring (it sent the unknown caller to
voicemail), Telnyx's detection said "machine", and the server hung up after 7 seconds without
leaving a message, as designed (outcome `answering_machine`). **No audio has yet been played
to, or heard from, a person on a call.** `stop-calls` was run afterwards. The case's own retry
would be 26 hours later; each new try needs `set-up-call` (a fresh campaign) and `deploy`.
Mistake to remember: the server printed the allowed number in full and the `server-log` task
copied it into an Actions log. That run's log was deleted; the server now prints the last four
digits and the log tasks mask numbers. Never print the number. Second mistake: a commit was
pushed with failing tests because the test command's exit status was hidden by a pipe; fixed
in the next commit. Run `npm test` on its own line and read the result before committing.
Carrier events are now traced one line each (`trace` in `TelnyxConfig`) for the next try.
**Second real call, 2026-11-11 03:53 UTC: answered by the operator, and it went badly.**
Read from the audit trail (Neon connector, `run_sql` on project `cold-wildflower-22977142`:
`attempts` joined to `audit_events`; never select the `cases.phone` column) and the server
trace. What happened: Telnyx's person-or-machine verdict took 4 s ("human"), and the server
sat silent for it; the operator said "Hello?" twice into the silence; that cut the
introduction off 0.4 s in and was then taken as the reply to the consent question; they heard
"Sorry, I did not catch that. Do you agree to take part?" without ever hearing that it was an
AI or what the call was; they asked "Take [your] part in what?", the model correctly said
"question", and the consent logic ended the call as declined. Operator's words: "it was not
able to handle natural language at all… anything that's not within its scope, it just
immediately ends."
**Fixed the same evening (tests replay the call; 368 pass; not yet tried on a real call):**
- `phone-connect.ts`: after pickup the interviewer waits for the greeting to finish (0.5 s of
  quiet, or 1.5 s of nothing, 4 s at most), not for the carrier's verdict; a "machine" verdict
  that arrives later hangs up there and the attempt is `answering_machine`.
- `phone.ts`: anything that began before the interviewer's first words, or within 0.8 s after
  they began, is the greeting: it neither interrupts nor counts as a reply.
- `interviewer.ts`: agreement cannot be asked for or accepted until every line of the
  introduction has played to its end (known from the `played` events; typed conversations
  report none and are unaffected). If it was cut off, the introduction starts again (twice at
  most, not counted as a failed reply); a clear "no", "stop" or "remove me" is still taken at
  once. A question at the consent step ("who is this?", "take part in what?") gets the whole
  introduction again, twice at most.
**Still as designed, and the operator may not agree with it:** during the survey a question
from the respondent gets "I am not able to answer questions or explain further" and the
question again (standardised interviewing); the interviewer has no way to say anything that
is not in the fixed script. Ask them about this rather than guess.
Calling is off (`stop-calls`). **Waiting on the operator** to say go for a third call (9am to
8pm Pacific): `set-up-call`, then `deploy`, then read the audit trail the same way.
Then `set-up-call`, then `deploy` (the call is placed at server start, 9am to 8pm in the
phone's time zone; tell the operator before deploying). The server renders every line with
the voice before the first call. Expect fixes: see the open points at the top of
`voice/src/telephony/telnyx.ts`. After the call: `stop-calls`, then import the call's
results into Qualtrics (and settle the time-zone point above).

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


## 2026-11-11 — Verity Voice: server voice and hearing for the demo; ribbon follows sound

Built without any vendor key, so everything here has run against stand-ins only.

- **Voice:** `cartesiaVoice` / `deepgramVoice` take `output: "page"` (a 24 kHz WAV file; the
  vendors' parameters were checked against their current API references). `GET
  /demo/audio/<line id>` serves the recording of a script line and of nothing else (the key
  cannot be used to say arbitrary text); each line is rendered once (`SpeechStore` now shares
  a rendering between simultaneous requests) and all are rendered in the background at start.
  A failed recording falls back, for that visitor, to the browser's voice or to text.
- **Hearing:** the page sends microphone sound over the demo WebSocket; `BrowserChannel` feeds
  a recogniser (`SttOptions.encoding` gained `linear16`; Deepgram is asked not to keep demo
  audio for training, `mip_opt_out`), shows interim words, and ends the turn after 0.7 s of
  quiet or the recogniser's end-of-utterance. Reply times stay on the page's clock (each piece
  of sound is stamped with it). Half-duplex by default: no sound is sent while a line plays
  and anything heard earlier is dropped (`bargeIn` switches that off). 8 minutes of sound per
  interview at most. A recogniser failure tells the page, which falls back to typing; it does
  not fall back to the browser's recogniser, because the page has told the visitor where
  their audio goes.
- **Disclosure:** the gate names the service that will hear the microphone when the server
  does the hearing.
- **Ribbon:** with the real sound (server voice through an analyser; the microphone), each
  side swells and brightens with loudness and six bands of pitch drive waves along it, long
  to fine. With browser speech (no access to the sound) it still stirs by turn.
- **Deploy job:** hands `DEEPGRAM_API_KEY`, `CARTESIA_API_KEY`, `CARTESIA_VOICE_ID` from
  repository secrets to Fly.io when set; new task `compare-voices` runs `npm run bakeoff`
  live (now also checks the page format and the streaming recogniser) and keeps the audio.
- **Stand-ins:** `humVoice`, `scriptedStt`, `scripts/demo-standin-server.ts`,
  `scripts/demo-server-voice-check.cjs`.
- **Checked:** typecheck; 355 tests; the three browser checks. Not checked: any real vendor,
  real microphone, echo through loudspeakers, phones.

## 2026-11-11 — Verity Voice: browser demo rebuilt to the operator's reference

The first demo page (a card with chat bubbles) was replaced after the operator called it
"very rudimentary". Reference image: `voice/docs/design/interface-reference.webp`.

- **Page (`voice/src/server/demo.html`, still one file, no build step):** cream full-screen
  layout; brand top-left with a rule and a session state top-right; serif headline; a looped
  ribbon drawn on a canvas (teal on the human side, lilac, amber on the agent side; the side
  whose turn it is stirs; still under reduced-motion; fewer pieces on slow devices); the line
  being spoken as a large quotation under an "AGENT" label, earlier lines of the same turn
  smaller above it; a pill with microphone, pause, keyboard and hang-up; timer; status with
  dots; Human / Agent key. Dark mode follows the device.
- **Kept:** AI disclosure and consent before anything starts; typed replies and the phone
  keypad (behind the keyboard button; the typed box shows by itself in read-and-type mode or
  when the microphone is off or blocked); the "how your answers were read" table (stacked on
  phones); a full transcript (in the keyboard panel).
- **New behaviour:** pause (stops the voice and the clock; the interrupted line is said again
  from its start on resume, so no line is reported as half heard); microphone on/off during the
  interview; a blocked microphone falls back to typing; recognition restarts if the browser
  stops it early; hang-up. Hang-up is a new message (`{type:"hangup"}`) handled in
  `browser-channel.ts`: the interview ends as a hang-up, the connection stays open, and the
  page still receives how the answers so far were read.
- **Removed:** chat bubbles, the Interrupt button (typing or the keypad still cuts in).
- **Typeface:** Newsreader (SIL Open Font License) is committed under
  `voice/src/server/assets/` and served at `/assets/newsreader.woff2`; the page requests
  nothing from any other site (a test checks this).
- **Checked:** typecheck; 343 tests; `scripts/demo-check.cjs` at 1440×960, 1100×700 (dark) and
  390×780 with screenshots reviewed; `scripts/demo-voice-check.cjs` (stand-in speech). Not
  checked: real speech in a real browser, a screen reader, real phones.

## 2026-11-10 — State machines: inventory, fixes, migration 0006 (PR #48)

Implemented every phase of the former `state-machine-plan.md` (moved here; the
plan file now holds only what remains). One commit per phase; typecheck + tests +
build green after each. Merged as PR #48 (`7fec4d0`). Tests 136 → **270**.

**Inventory (13 machines).** Session lifecycle (`active → awaiting_review ⇄
active → complete`, orthogonal `archivedAt`); round lifecycle (`in_progress →
complete` + reason); turn lifecycle (pending → yes/no/done); invite lifecycle
(derived from timestamps); model-output protocol (question / stop_confirm / prd /
reject, retries, coverage gate, forced PRD); the skill's model-side script
(mirror → interview → stop → PRD); critic verdict; respondent routing; operator
status; interview client UI; operator review UI; canary exit codes; and small
self-contained ones (admin auth, rate limiter, markdown parser, theme toggle —
left unchanged).

**Findings fixed.**
- H1 permanent dead-end after a failed/timed-out model call (session `active`,
  no pending turn, static "Preparing…" forever; round 2+ showed "closed").
- H2 canary never ran: `npx tsx scripts/canary.ts` crashed on `server-only`
  (exit 1 = "drift") → 14 false "Canary drift detected" issues (#13–#46), now
  closed with an explanation. Second blocker (`.md` import) also removed.
- H3 jargon filter matched substrings (restaurant → `rest`, trust → `rust`,
  therapist → `api`, reaction → `react`).
- H4 `timeToAnswerMs` after Q1 included model latency (timer reset on send).
- H5 no DB invariants: duplicate sessions/pending turns/rounds possible;
  `answer()` not bound to a turn id.
- M1–M9: unguarded `completeSession`; non-atomic finalize; orphan/degenerate
  follow-up rounds and lost focus/version skip; follow-up rounds re-covering
  7/10 dimensions and focus injected once; no runtime validation; identical
  retries, exhaustion recorded as `forced_prd`, unvalidated PRD fallback,
  `stop_reason` ignored; failed critic stored as "no round needed"; free-text
  statuses; no engine tests / duplicated policy; email + critic inside the
  respondent request with no `maxDuration`.
- L1–L6: held-key repeat; mirror step counted in metrics; routing re-derived in
  five places without ORDER BY; misleading /done + admin copy; unused invites
  invisible/unrevocable, pre-0003 sessions still `active`; misnamed param, dead
  branches, stale cross-action error.

**What shipped, by phase.**
1. `lifecycle.ts` (unions, transition table, `deriveRespondentView`,
   `deriveOperatorState`; schema typed with `text(..., { enum })`),
   `interview-policy.ts` (model injected, `exhausted` shape), `model-client.ts`
   (no `server-only`, `stop_reason`, 50s timeout; `anthropic.ts` is the
   server-only binding). Canary uses the shared policy, reads the skill via `fs`,
   checks the baseline before spending; exit codes 0 ok / 2 config / 3 fixture /
   **10 drift**; `canary.yml` files an issue only on 10.
2. Boundary-aware jargon (tech-only spellings for react/rust/rest), tolerant
   stop-confirm; corrective retry naming the reason; `max_tokens` = reject;
   PRD fallback needs ≥7/14 section headings else `prd_failed`; new reason
   `guard_exhausted`; termination diagnostics frozen in the round's methodology
   doc. Mirror step (`… Ready?` as the session's first question) tagged `mirror`
   and excluded from coverage/analysis — skill prompt unchanged, `skillVersion`
   unchanged.
3. Claim-then-advance engine: conditional answer claim bound to the turn id;
   idempotent `advance` (also `/q` load, `startSession` resume, admin Resume);
   every write a short transaction locking the session (or invite) row and
   re-checking its precondition — never across a model call (pool `max: 1`);
   email + critic after commit; critic failure → null verdict; follow-up rounds
   generate first then claim, focus from the latest PRD-bearing round, re-injected
   every turn, session-wide coverage; conditional complete; action input
   validation; `maxDuration = 60`; `interview-store.ts`.
4. Migration `0006_state_invariants`: legacy-status backfill (no-rounds sessions
   only), surplus *unanswered* pending turns removed, duplicate steps/round
   numbers renumbered, five indexes each created only if no duplicates remain.
   Every statement idempotent, in its own exception-catching block, with
   `lock_timeout = 5s` — cannot fail a build.
5. Respondent pages via one loader (`respondent.ts`); `/q` Resume component;
   interview client on a pure reducer (`interview-state.ts`), latency keyed on
   turn id, `e.repeat` guard, Try again resyncs; admin detail without a PRD,
   Stalled panel (Resume / Close → `abandoned`), PRD version from the PRD-bearing
   round; registry Stalled/Unknown states, unused invites + Revoke; copy fixes.

**Decisions taken where the plan left a choice** (lower-risk option): see the PR
description; notably diagnostics live in the methodology doc (no new column), a
PRD that cannot be obtained fails the round rather than storing arbitrary text,
Close is offered only for stalled sessions, Revoke expires the invite.

**Verification.** Engine integration suite on PGlite (real migrations, mocked
model) run twice — with and without the 0006 indexes; migration-0006 suite
(dirty rows, no data loss, skipped index, idempotent re-run). PGlite serializes
transactions, so real concurrency was checked ad hoc on PostgreSQL 16 (pool 10
and pool 1): one session per 20 concurrent starts, one next turn per 10
concurrent answers, one round per 10 concurrent follow-ups, no deadlock. Real
`drizzle-kit migrate` on PG16: duplicate sessions → index skipped with a
WARNING, build passes; held ACCESS EXCLUSIVE lock → statements skip after 5s,
build passes. Playwright check of the client (`npm run e2e:interview`) 8/8.
Verified again on `main` after merge. The Vercel preview build for the PR
(which runs `drizzle-kit migrate`) succeeded.

**Not verifiable here:** real model behaviour, Vercel time limits, production
data (whether any 0006 index was skipped — check the build log), canary baseline.

---

## 2026-06-16 (later) — UX/UI source of truth adopted + full a11y/UX audit implemented

Added a second governing doc, **[ux-source-of-truth.md](ux-source-of-truth.md)** —
the Laws of UX (Jakob, Fitts, Miller, Hick, Postel, Peak-End, Aesthetic-Usability,
Von Restorff, Tesler, Doherty) plus global component heuristics, cognitive-load /
navigation limits, and a WCAG-grounded accessibility section. It is the
**interaction & accessibility** companion to design.md's **visual** tokens; when
the two conflict, a11y wins. Wired references into design.md, handoff.md, README.md.
The running gap analysis lives in **[ux-audit.md](ux-audit.md)**.

Then audited the shipped UI against it and **implemented every finding** — all
verified by `typecheck` + **136 tests** + production build. **Live a11y verification
is still pending** (no browser / assistive tech in-container).

**P0 (blockers):**
- Re-enabled pinch/text zoom (dropped viewport `maximumScale:1`; WCAG 1.4.4).
- Gated the irreversible **Mark complete** behind an inline confirm that names the
  consequence — Cancel-first, destructive-styled, separated from Open-round.
- Programmatic `<label>`s on the seed / login / invite inputs.
- One global `:focus-visible` ring in `globals.css` (stopped `outline-none` on
  inputs). **Gotcha: do NOT put `border-radius` in that rule** — it deforms pill
  controls while focused (caught + fixed same session).
- Links no longer color-only (underline on accent links; hover/focus underline on
  neutral chrome links).

**P1:** `prefers-reduced-motion` honored (CSS reset + Framer `useReducedMotion`);
status/errors announced (`role=alert`, `role=status`/`aria-live`,
`aria-describedby`); admin registry **paginated** (25/page) with a grouped SQL
turn-count aggregate **scoped to the page** (previously loaded every `turns` row
into memory); Yes/No separation widened + **Y/N/D keyboard shortcuts** with a
visible hint; operator markdown **rendered** (new zero-dep renderer) instead of raw
`<pre>`; opacity-on-muted text removed for predictable contrast.

**P2:** disabled-state hints + `aria-busy`; >10s "still working" escalation;
`scope=col` + sr-only table caption; refreshed page metadata; **dark-mode toggle**
shipped (`ThemeToggle` in admin header + invitee footer, no-flash pre-paint script,
`localStorage`). P2-4 (archive) closed **wontfix** — reversible via Restore.

**Round 2 (subtle/edge):** `try/catch` around the interview/seed server-action
calls so a thrown/rejected action shows a retry message and rolls back the
optimistic step (was silent — Peak-End); a **persistent SR live region** announces
each new question (the keyed `<h2>` remounts and didn't announce reliably); focus
moves to Cancel when the confirm opens; **fixed invisible dark-mode borders** — dark
`--md-hairline` was identical to the card fill (#2f2f2f), raised to #444.

**New files:** `ux-source-of-truth.md`, `ux-audit.md`, `src/lib/markdown.ts` (pure
parser + 16 tests), `src/components/markdown.tsx`, `src/components/theme-toggle.tsx`.

**Accepted limitations (documented in ux-audit.md, L-1..L-3):** admin inline-link
tap-target density (desktop operator tool); dark 1px borders are legible but not
strictly ≥3:1 vs the near-black canvas (mitigated by label + placeholder + focus
ring); global single-letter Y/N/D shortcuts. Server-action error wording was
reviewed and passes (polite / specific / actionable, no blame).

---

## 2026-06-16 — UI re-skin: Midnight Precision → Warm Paper Calm

Full experiential refashion from the dark gold "instrument" theme to **Warm Paper
Calm**, the Notion-inspired light/dark language captured in [design.md](design.md)
(the canonical spec; the implementation now conforms to it). Driven by the user;
decisions: drop the instrument metaphor entirely, support **both light and dark**,
leave the sticker palette defined-but-unused for the future, strip branding to a
plain "Verity". The respondent surface is still exactly **yes / no / done** — this
was a pure presentation change, **no logic touched**.

**Why it was cheap:** the earlier reskin kept components **token-driven** against
stable `--md-*` names, so re-coloring the whole app happened centrally in
`globals.css`. The real work was reversing the *idioms* (dark→light, engraved
UPPERCASE→sentence case, sharp→soft, flat→layered shadow, gold→blue).

**What changed:**
- **Tokens (`globals.css`):** remapped every `--md-*` value to the Warm Paper
  palette — warm paper page canvas `#f6f5f4`, **white cards** above it, near-black
  warm ink, muted ink `#615d59`, single blue `primary #0075de` / pressed `#005bab`,
  hairline `#e6e6e6`. Added a full **dark** token set (`#191919` page / `#2f2f2f`
  cards / brighter blue) under `[data-theme="dark"]` **and** `prefers-color-scheme`.
  `color-scheme` + `::selection` flipped; light is default.
- **Config (`tailwind.config.ts`):** spec radius scale (xs 4 / sm 5 / md 8 /
  lg 12 / xl 16 / full), 3-level soft `shadow-elevation-*` stack (replacing the
  no-shadow system), headline weights → **700**, calmed the `label-sm` token
  (normal tracking, weight 500). Removed the dead `engrave` letter-spacing and
  `scanline` keyframe/animation. Added Inter weight 500.
- **Chrome (`src/components/chrome.tsx`):** deleted `Scanline` + `GridUnderlay`;
  kept `BrandHeader` / `StatusDot` / `ContextTag` / `TelemetryFooter`, all quiet
  and sentence-case, footer de-branded (footer `Protocol` still = real skill
  fingerprint).
- **Component sweep (all 14 surfaces):** stripped `uppercase`/engraved tracking
  everywhere; CTAs became blue/white/secondary **pills** for the respondent hero
  actions and **8px utility buttons** for admin; rounded cards/inputs/tables with
  soft shadows; status dots rounded; sentence-cased the loading words
  (`loading-words.ts`). Shell (`layout.tsx`) defaults to light, per-scheme
  `themeColor`.
- **design.md conformance pass:** after the first sweep, audited against the spec
  and fixed three deviations — pure-white pages → warm canvas + white cards;
  oversized input radii → 4px; admin pills → 8px utility — plus exact spec colors
  (`#0075de`/`#005bab`/`#615d59`/`#e6e6e6`) and 700 headlines.

**Decisions / deferrals:**
- Dark mode **has no in-app toggle** yet — OS preference + `[data-theme]` work;
  a user-facing switch (client component + persistence) is a small follow-up.
- **Sticker palette** stays in design.md but unused; Verity has no illustrations,
  so the multicolor accents have nothing to decorate yet.

**Verification:** `npm run typecheck` clean, `npm run build` passes (all routes),
`npm test` **120/120**. **No live screenshots** — no headless browser in the
container (network-gated), so verified by build + tests, not pixels; visual QA
(`npm run dev`) is a standing to-do alongside the existing live-QA item.

---

## 2026-06-16 — Operator-gated rounds + content-validity coverage gate

Reworked the multi-round loop after a live test showed a round finalizing after a
single question and the critic auto-opening round 2 two seconds later. Two design
weaknesses (no depth floor; fully-autonomous round-opening) and the AAPOR/Groves
grounding were worked through with the user; all three recommended options chosen.

**What changed:**
- **Critic demoted from judge to advisor.** `finalizeRound` still runs the critic
  but no longer opens rounds or consumes the invite. Its verdict is persisted on
  the round (`criticRecommendOpen` / `criticGaps` / `criticFocus`, migration
  `0004`) and the session moves to a new `awaiting_review` status. This fixes the
  observability gap (a one-round session now records *why* it stopped) and is a
  deliberate strengthening of AAPOR human-oversight for the highest-risk quadrant.
- **Operator controls the loop.** New admin-gated server actions `openRound`
  (→ `openFollowupRound` in the engine: creates round N+1 steered by the stored
  critic focus, generates its first question, reactivates the session) and
  `completeSession` (marks complete + consumes invite). Admin detail page gains a
  `round-actions.tsx` panel (shown when `awaiting_review`) and surfaces the critic
  verdict per round; list page shows an "Awaiting review" status.
- **Within-round coverage gate** (`src/lib/coverage.ts`, pure/tested). The model
  may not stop (PRD/stop-confirm) until ≥ `COVERAGE_FLOOR` (7 of 10) construct
  dimensions are covered; otherwise `enforceCoverage` nudges it toward the
  uncovered dimensions for one more question. Grounded in content validity
  (Groves) rather than an arbitrary question count; an explicit respondent "done"
  always wins, preserving the yes/no/done contract. Mirrored into the canary
  `run-one.ts` so the suite still tracks real engine behavior.
- **Routing** now keys off `completedAt` (finalized round → `/done`; new pending
  turn → `/q`) so `awaiting_review` rests on `/done` until the operator extends.
- **Disclosure** updated: round continuation is human-decided, the critic is
  advisory, and the content-validity floor is named.

**Decision trail:** considered a raw question-count floor (rejected — not a
survey-methodology construct, trades content validity against respondent burden)
and a prompt-only nudge (rejected as sole mechanism — "soft prompting" the project
distrusts). Landed on a deterministic coverage gate + advisory critic + human
gate. The previous fully-automated critic rationale is preserved below.

**Verification:** typecheck clean; `npm test` 120/120 (+11 coverage); `npm run
build` passes. Migration `0004` is additive (3 nullable columns on `rounds`);
auto-applies on deploy via `vercel-build`. Not run live (no DB/API key in
container) — needs the same live QA as to-do #1, now including the operator flow.

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
