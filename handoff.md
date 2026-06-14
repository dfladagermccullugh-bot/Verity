# Verity — Session Handoff

Lean, session-to-session working memory. Keep this under ~5k tokens. When an
item goes stale or a to-do is done, move it to [history.md](history.md) and
trim it from here.

_Last updated: 2026-06-14_

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

## Current health (verified this session)

- `npm run typecheck` — clean.
- `npm test` — 65 passing (guard 19, canary-compare 15, disclosure 21, construct-brief 10).
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
   Superseded by handoff.md — safe to delete.

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

## Conventions / gotchas

- Operator/recipient is referred to as **"Davin"** in code comments and the
  `DAVIN_EMAIL` env var — that's the human who receives finished PRDs.
- Methodology/disclosure copy cites specific AAPOR §§ — match that citation
  style when extending it (see `disclosure.ts` header comment).
- Canary `baseline.json` must **never** be silently rebaselined; an explicit
  reason in the commit message is the rule, else drift detection is theater.
- Develop on the designated feature branch; commit + push there; never open a PR
  unless explicitly asked.
