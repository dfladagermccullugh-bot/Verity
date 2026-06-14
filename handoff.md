# Verity — Session Handoff

Lean, session-to-session working memory. Keep this under ~5k tokens. When an
item goes stale or a to-do is done, move it to [history.md](history.md) and
trim it from here.

_Last updated: 2026-06-14 (Midnight Precision reskin)_

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
seed → construct-validity probe (sidecar) → interview loop
        (model → guard → persist turn) → on done / 40-turn ceiling / model-stop
        → force PRD → email PRD + methodology + store
```

Key files:
- `src/lib/interview-engine.ts` — turn loop, retry policy, 40-turn ceiling, `forcePrd` fallback, `finalizeWithPrd`.
- `src/lib/guard.ts` — deterministic classifier → `question | stop_confirm | prd | reject`. Rejects multiline, batched, jargon, >200 chars, missing `?`.
- `src/lib/construct-brief.ts` — AAPOR §4.3.1 pre-flight probe; one-shot call, JSON→markdown; **log-only**, non-fatal.
- `src/lib/disclosure.ts` — PRD header + standalone methodology companion doc; provenance **frozen at finalize**.
- `src/lib/anthropic.ts` — `callModel` (interview, prompt-cached) + `callModelOneShot` (sidecars). Model from `ANTHROPIC_MODEL`, default `claude-sonnet-4-6`; `MAX_TOKENS=4096`.
- `src/lib/skill/idea-seeding-agent.md` — system prompt, webpack-inlined at build; `version.ts` derives a SHA-256 fingerprint used in the disclosure.
- `src/lib/canaries/` + `scripts/canary.ts` + `.github/workflows/canary.yml` — weekly reliability drift suite.

Stack: Next.js 14 (App Router, server actions), React 18, TS. Postgres via
Drizzle (`invites`, `sessions`, `turns`). iron-session admin auth, Resend email,
Tailwind + Material 3 tokens, Framer Motion. Deployed on Vercel
(`vercel-build` = `drizzle-kit migrate && next build`).

## Design system — Midnight Precision (current)

The UI was refashioned from the old green Material 3 theme to **Midnight
Precision** (Technical Minimalism): nocturnal obsidian surfaces, **Signal Gold**
(`primary #f2ca50` / `primary-container #d4af37`) as the sole accent, **Inter**
everywhere, sharp corners (0px containers / 4px interactive), **no shadows** —
flat tonal layering + 1px charcoal hairlines. Source of truth was a provided
`design.md` (palette + type scale); a screenshot + inspiration HTML guided the
"instrument" chrome. Dark-only by design (theme toggle removed).

- Palette lives in `src/app/globals.css` as `--md-*` vars (dark-only `:root`).
  Token **names** are unchanged from before, so components stayed token-driven —
  added one token: `hairline` (`#2a2a2a`).
- `tailwind.config.ts` — Inter, sharp radii, `boxShadow` neutralized to `none`,
  type scale (`text-display-xl/-lg`, `text-label-sm`, etc.), `tracking-engrave`,
  spacing tokens, `animate-scanline` / `animate-pulse-dot`.
- `src/components/chrome.tsx` — shared `BrandHeader`, `GridUnderlay`, `Scanline`,
  `ContextTag`, `StatusDot`, `TelemetryFooter` (footer `PROTOCOL` = the real skill
  fingerprint, threaded from the server; no fake latency).
- Tone is now "precision": puppy + gardening loading words retired; loading words
  are telemetry verbs; copy is engraved-uppercase.
- **Deliberate calls** (design.md prose contradicted its own tokens/screenshot):
  followed the **tokens + screenshot** — gold-filled primary (not white), `#131313`
  surface (not pure black). Screenshot's `DECLINE/CONFIRM CHOICE` was a mock; kept
  the real yes/no/done contract, applied the aesthetic (YES=gold, NO=hairline).

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
  construct brief). Download routes under `src/app/api/admin/`: `prd/[id]` (PRD
  md), `prd/[id]/methodology` (methodology md), `export` (full training-data
  JSON of completed + abandoned sessions). `src/lib/email.ts` — Resend: PRD in
  body, methodology as attachment, to `DAVIN_EMAIL`; fails silently since the
  PRD is already persisted.

## Current health (verified this session)

- `npm run typecheck` — clean. `npm run build` — passes (all routes compile).
- `npm test` — 65 passing (guard 19, canary-compare 15, disclosure 21, construct-brief 10).
- Landing route (`/`) smoke-tested via `npm start` → HTTP 200 with new chrome.
- **Not yet visually QA'd:** the DB-backed routes (interview, done, admin) — they
  build and typecheck but haven't been rendered with live data/screenshots.
- Note: a fresh clone needs `npm ci` before typecheck/test will run.
- All three AAPOR iterations are **shipped** (PRs #5–#12): Required Disclosures, construct-validity probe, reliability canaries. README "Survey methodology" section enumerates all three.

## Open to-dos (priority order)

1. **Baseline the canary suite — the one real blocker.**
   `src/lib/canaries/baseline.json` is still a sentinel: `"model": null`,
   `"seeds": {}`. Until it is populated the weekly workflow cannot detect drift.
   Action: run `npm run canary:rebaseline` once with `ANTHROPIC_API_KEY` and the
   **production** `ANTHROPIC_MODEL` set, eyeball the per-seed table, commit the
   result with a message explaining the baseline conditions. Also confirm the
   GitHub repo has secret `ANTHROPIC_API_KEY` and var `ANTHROPIC_MODEL` set, or
   the scheduled run will fail.

2. **Retire `NEXT-SESSION.md`.** It described AAPOR iterations 2 & 3, both now
   shipped, so it is fully stale and competes with this file as "the handoff."
   Superseded by handoff.md — safe to delete. Note: `src/lib/canaries/compare.ts`
   (line ~15) has a comment citing "the NEXT-SESSION.md handoff" for its
   tolerances; update that reference if you delete the file.

3. **Reskin loose ends (cleanup).** `public/puppy.json` is now orphaned and the
   `lottie-react` dependency is unused — both can be removed (drop the dep with a
   lockfile update so `npm ci` stays consistent). `README.md` "Stack" line still
   says "Material 3 token layer" and the methodology copy/branding predates the
   Midnight Precision identity — refresh when convenient.

## Backlog / deferred ideas (not committed work)

- **Close the construct-brief loop?** The brief is deliberately log-only today;
  feeding it back into the interview system prompt would constrain question
  generation but make brief-vs-interview drift harder to audit. Deferred on
  purpose — revisit only with an auditing story.
- **Ship the construct brief as a third companion file** (`brief-<id>.md`)
  alongside `prd-<id>.md` / `methodology-<id>.md`. Today the methodology doc only
  *references* that the probe ran; the brief itself lives in the session record.
- **Subset audit of historical transcripts** — the methodology doc currently
  states none has been conducted; a periodic human spot-check would let that
  line claim more.

## Minor observations (low priority, not blocking)

- **Rate limiter is in-memory and per-instance** (`middleware.ts` `Map`), so on
  Vercel it isn't shared across serverless instances and resets on cold start.
  Fine for an invite-only tool; revisit only if abuse becomes real.
- **Naming residue:** package name is still `idea-seeder`, the admin cookie is
  `idea_seeder_admin`, and the recipient env var is `DAVIN_EMAIL` — the product
  is "Verity". Cosmetic; renaming the cookie would log out current admins.
- **Moderation fails open** by design — acceptable given the prefilter, but worth
  remembering if the threat model changes.

## Conventions / gotchas

- Operator/recipient is referred to as **"Davin"** in code comments and the
  `DAVIN_EMAIL` env var — that's the human who receives finished PRDs.
- Methodology/disclosure copy cites specific AAPOR §§ — match that citation
  style when extending it (see `disclosure.ts` header comment).
- Canary `baseline.json` must **never** be silently rebaselined; an explicit
  reason in the commit message is the rule, else drift detection is theater.
- Develop on the designated feature branch; commit + push there; never open a PR
  unless explicitly asked.
