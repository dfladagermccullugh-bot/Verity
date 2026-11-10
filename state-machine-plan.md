# Verity — state machines: inventory and improvements

## Context

Request: identify every state machine in the project, then find all areas of improvement.
Verity's lifecycle logic is implicit: status strings spread over six files, transitions
done as unguarded multi-step writes, no tests on the orchestration. Reading the code end to
end found one permanent dead-end state, a canary that has never run, missing concurrency
control, and two measurement bugs.

Evidence level: code reading, plus executed probes of `guard.ts` and `scripts/canary.ts`,
plus the repo's GitHub issue list. Nothing ran against a live DB or model (no credentials
in the container). An independent pass tried to refute each finding; two were dropped.

## 1. State machines

| # | Machine | States | Where |
|---|---|---|---|
| 1 | Session lifecycle | `active` → `awaiting_review` ⇄ `active` → `complete`; orthogonal `archivedAt` | `src/lib/db/schema.ts`; `finalizeRound`, `openFollowupRound` in `src/lib/interview-engine.ts`; `src/actions/admin.ts` |
| 2 | Round lifecycle | `in_progress` → `complete` + `terminationReason` | `interview-engine.ts` |
| 3 | Turn lifecycle | pending (`answer` null) → yes / no / done | `insertTurn`, `submitAnswer` |
| 4 | Invite lifecycle | issued → session started → consumed, or expired (derived from timestamps) | `src/actions/interview.ts`, `src/actions/admin.ts`, `src/app/i/[token]/page.tsx` |
| 5 | Model-output protocol | question / stop_confirm / prd / reject; 3-try retry → fallback stop; coverage gate; forced PRD | `src/lib/guard.ts`; `generateNextShape`, `enforceCoverage`, `forcePrd`; copy in `src/lib/canaries/run-one.ts` |
| 6 | Model-side script | mirror + "Ready?" → interview → stop confirm → PRD | `src/lib/skill/idea-seeding-agent.md` |
| 7 | Critic verdict | null / recommend / don't (failure folded into "don't") | `src/lib/critic.ts` |
| 8 | Respondent routing | invalid / seed form / question / preparing / done | `src/app/i/[token]/page.tsx`, `q/page.tsx`, `done/page.tsx` |
| 9 | Operator-facing status | awaiting respondent / awaiting review / complete (derived; unknown → "Complete") | `src/app/admin/prds/page.tsx`, `[id]/page.tsx` |
| 10 | Interview client UI | asking → submitting → asking / error / leaving | `src/app/i/[token]/q/interview.tsx`, `seed-form.tsx` |
| 11 | Operator review UI | idle → confirming → submitting | `src/app/admin/prds/[id]/round-actions.tsx` |
| 12 | Canary | unbaselined → baselined; exit 0 / 1 drift / 2 config / 3 fixture | `scripts/canary.ts`, `src/lib/canaries/compare.ts`, `.github/workflows/canary.yml` |
| 13 | Admin auth; rate limiter; markdown parser; theme toggle | small, self-contained | `src/lib/session.ts`, `middleware.ts`, `src/lib/markdown.ts`, `src/components/theme-toggle.tsx` |

Group 13 is sound for its purpose; no changes proposed.

## 2. Findings

### High

- **H1 — Permanent dead-end state.** `submitAnswer` records the answer, then calls the
  model. If that call throws or the function times out, the session is `active` with no
  pending turn. Retry returns "done" (`interview-engine.ts:460`) → `/done` → redirect to
  `/q` → static "Preparing your next question…" forever. In round 2+ the respondent instead
  lands on "session is closed". Same when `beginInterview` fails after `startSession`
  inserted the row. No operator recovery: admin detail 404s without a PRD.
- **H2 — Canary has never run; it files a false drift issue weekly.** `npx tsx
  scripts/canary.ts` crashes on `Cannot find module 'server-only'` and exits 1, which the
  workflow treats as drift. 14 open "Canary drift detected" issues (#13–#46). A second
  blocker (the `.md` import in `src/lib/skill/version.ts`) sits behind the first.
- **H3 — Guard jargon filter matches substrings.** Executed: "restaurant", "interested" →
  `jargon:rest`; "trust", "frustrating" → `jargon:rust`; "rapid", "therapist" →
  `jargon:api`; "reaction" → `jargon:react`. Costs extra model calls and can end a round
  early once the coverage nudge is also rejected. Pinned as spec by
  `src/tests/guard.test.ts:109`.
- **H4 — Latency paradata is wrong.** `shownAt` resets when the answer is sent, not when
  the next question appears (`interview.tsx:52-54, 72-73`), so every `timeToAnswerMs`
  after question 1 includes model latency. The latency and `TOO_FAST_MS` analysis is
  invalid.
- **H5 — No DB-level invariants.** Only `invites.token` is unique. Two tabs or devices can
  create two sessions per invite, two pending turns, or duplicate rounds (`openRound`).
  `answer()` is not bound to a turn id, so a stale tab answers a question it never showed.

### Medium

- **M1** `completeSession` has no status guard; `finalizeRound` sets `awaiting_review`
  unconditionally and writes round then session non-atomically.
- **M2** `openFollowupRound` inserts the round before generating: a throw orphans an
  `in_progress` round; a non-question result leaves a "degenerate" round whose null
  `criticFocus` the next attempt reads (focus lost, version number skipped). Admin detail
  then labels the old PRD with the new version number.
- **M3** Follow-up rounds are mis-steered: the coverage gate is per round (must re-cover
  7/10 dimensions), and the critic focus is injected only for the first question.
- **M4** No runtime validation in server actions: `answer()` accepts any string, which
  enters the model transcript and breaks the yes/no/done invariant.
- **M5** Retries resend identical messages; exhausted retries are recorded as
  `forced_prd`, indistinguishable from a real stop, diagnostics dropped. `forcePrd`'s last
  fallback stores unvalidated text as the PRD; `callModel` ignores `stop_reason`.
- **M6** A failed critic call is stored as "no further round needed".
- **M7** Status and reason values are free text; `sessions.status` comment is stale;
  `abandoned` / `abandonedAtStep` are never written; no abandonment marker exists.
- **M8** No tests on engine orchestration; the generation policy exists twice.
- **M9** `finalizeRound` awaits email and critic inside the respondent's request; up to
  ~10 sequential model calls with no `maxDuration` — the likeliest trigger for H1.

### Low

- **L1** Global keydown ignores `e.repeat`: a held Y/N answers each new question as it
  arrives. ("D" as a one-key conclude is an accepted limitation in `ux-audit.md`.)
- **L2** The skill's "mirror … Ready?" step passes the guard as question 1 and is counted
  in coverage and acquiescence. (Whether the model emits it is unverified.)
- **L3** Routing is re-derived in three pages and two actions; page queries for the
  pending turn have no `ORDER BY`.
- **L4** Copy drift: `/done` says "session is closed" while awaiting review; admin says
  the link "no longer resolves" though it resolves to `/done`.
- **L5** Unused invites are invisible in admin and cannot be revoked; pre-0003 completed
  sessions still read `active` (manual backfill noted in `handoff.md`).
- **L6** `insertTurn` param `priorRoundAnswered` receives current-round turns; dead
  branches in `submitAnswer`; `RoundActions` shows a stale error from the other action.

## 3. Implementation

Branch `claude/laughing-bohr-18kia3`. One commit per phase; each phase ships alone.

### Phase 1 — Pure modules + canary repair (no production behaviour change)

- `src/lib/lifecycle.ts` (new): unions for session status, round status, termination
  reason, answer; transition table + `canTransition`; `deriveRespondentView`,
  `deriveOperatorState`. Type schema columns with `text(..., { enum })` (no DDL). Replace
  literals in the engine, actions, admin pages, export route; fix schema comments.
- `src/lib/interview-policy.ts` (new, no DB, no `server-only`): move `generateNextShape`,
  `enforceCoverage`, `forcePrd`, `RUNAWAY_CEILING`; model injected; add an `exhausted`
  shape distinct from `stop_confirm`.
- `src/lib/model-client.ts` (new): the raw call without `server-only`, system prompt
  passed in, returns `stop_reason`, explicit timeout. `src/lib/anthropic.ts` becomes the
  server-only binding.
- Canary: `run-one.ts` uses the policy module (delete its copy); `scripts/canary.ts`
  loads the skill file via `fs`, checks the baseline before spending, and uses a drift
  exit code a crash cannot produce; update `canary.yml` to match.

### Phase 2 — Guard and protocol (H3, M5, L2)

- `guard.ts`: boundary-aware jargon matching; update the pinning test; tolerant
  stop-confirm match.
- Policy: corrective message naming the reject reason on retry; validate the `forcePrd`
  fallback (PRD headings) or fail the round; new reason `guard_exhausted` with
  diagnostics persisted on the round.
- Mirror step: exclude from metrics, or remove Step 1 from the skill prompt (changes the
  hashed `skillVersion`).

### Phase 3 — Atomic, re-entrant engine (H1, H5, M1–M4, M6, M9)

Design: **claim, then re-entrant advance.**

- `recordAnswer(turnId, value)`: one `UPDATE … WHERE id = ? AND answer IS NULL
  RETURNING`. Client sends the turn id it displayed.
- `advance(session)`: idempotent. Reads state; if a turn is pending returns it; otherwise
  generates and inserts the next turn or finalizes. Called by `submitAnswer`,
  `startSession` (resume instead of "already in progress"), and `/q` on load. This is
  also the recovery path for already-stranded sessions.
- `finalizeRound`: round + session claimed in one short transaction (`tx` only — pool is
  `max: 1`; never hold it across a model call). Email and critic after commit; critic
  failure leaves the verdict null.
- `openFollowupRound`: generate first, then claim session + insert round + first turn in
  one transaction; focus taken from the latest PRD-bearing round. Follow-up rounds
  re-inject `focusBrief` every turn and use session-wide coverage.
- `completeSession` / `openRound`: conditional `UPDATE … WHERE status = 'awaiting_review'`.
- `src/actions/interview.ts`: validate `value` ∈ {yes, no, done}, turn id, clamp paradata.
- `maxDuration` on the `/i/[token]` pages hosting the actions.
- New `src/lib/interview-store.ts`: query helpers taking an executor (`db` or `tx`).

### Phase 4 — Migration `0006` (separate commit, gated)

- Backfill legacy `status`; remove surplus unanswered pending turns.
- Unique: `sessions(invite_id)`, `rounds(session_id, round_number)`,
  `turns(session_id, step)`; partial unique `turns(session_id) WHERE answer IS NULL`;
  index `turns(round_id)`. CHECK constraints deferred to `0007` (`NOT VALID`).
- **Gate:** `vercel-build` runs `drizzle-kit migrate` on every build, previews included.
  Not pushed until the duplicate pre-flight queries have been run against production and
  it is confirmed whether previews share the production `DATABASE_URL`.

### Phase 5 — Pages and client (H4, L1, L3–L6)

- Respondent pages use `deriveRespondentView`; `/q` gets a client resume component in
  place of the static screen.
- Admin detail renders without a PRD, shows a stalled state with resume / close controls
  (uses the `abandoned` reason), labels the version from the PRD-bearing round.
- `interview.tsx`: pure reducer (`interview-state.ts`: asking / submitting / failed /
  leaving), `shownAt` keyed on turn id when the question becomes visible, `e.repeat`
  guard, "Try again" resyncs from the server.
- Copy fixes; unused-invite list in admin.

### Out of scope unless asked

Closing the 14 false canary issues on GitHub; rate-limiter changes; re-baselining the
canary (needs the API key).

## 4. Verification

- `npm run typecheck`, `npm test` (existing 136 + new), `npm run build` per phase.
- New unit suites: `lifecycle`, `interview-policy` (scripted model: reject → retry,
  exhaustion, coverage nudge, PRD fallback), `interview-state` reducer, guard probes.
- Engine integration on PGlite (`@electric-sql/pglite` dev dep; `drizzle-orm/pglite`
  ships in 0.36.4) with real migrations and mocked `@/lib/anthropic`: model throws after
  claim → resume works; two answers to one turn → one next turn; two `openFollowupRound`
  → one round; two `startSession` → one session; complete while `active` → refused;
  follow-up focus and coverage.
- Migration test: apply 0000–0005, seed dirty rows, apply 0006.
- Canary: `ANTHROPIC_API_KEY= npx tsx scripts/canary.ts; echo $?` prints the key-required
  message and exits 2 (today: crash, exit 1).
- Client: Playwright against `next dev` with stubbed actions for the reducer and timing.
- Not verifiable here: real model behaviour, Vercel time limits, production data
  cleanliness — covered by the Phase 4 gate and the live-QA to-do in `handoff.md`.
