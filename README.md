# Verity

A constrained-interview tool that turns a one-sentence idea into a structured PRD. The invitee answers only yes, no, or done. The model does the asking.

Live: invite-only. See *Try it* below.

## Problem

Most AI brainstorming tools hand the user a blank text box. That works for people who already know what they want. For everyone else — a stakeholder with a half-formed idea, a designer who can describe a feeling but not a spec — the blank box is the bottleneck. Typing is slow, it forces premature commitment, and a long-form answer to a vague prompt usually produces a long-form mess.

The interesting question is not "how do we get better answers from the user?" It is "how little do we need from the user to extract a coherent product brief?"

## Approach

Reduce the user's surface area to three buttons. Require the model to ask exactly one yes/no question per turn. Reject any output that isn't a single, jargon-free question and force a regeneration. When the model decides it has enough signal, it emits a PRD and the session ends.

Two design bets sit underneath that:

1. **Constraint as interface.** A yes/no answer is one bit of information, but a well-targeted one from the right branch of a decision tree is worth a paragraph of vague prose. The model picks the next question; the user reacts. The interaction is faster, lower-stakes, and more honest — people commit to opinions they would have hedged on in writing.

2. **Hard guardrails, not soft prompting.** The system prompt asks for good behavior; the [output guard](src/lib/guard.ts) enforces it. Multi-line output, batched questions, technology jargon, and missing question marks fail the guard, trigger a regeneration, and on a second failure force the PRD-write path. The model is never trusted to follow format rules on its own.

## How it works

```
seed (one sentence)
    │
    ▼
┌─────────────────────────────────────────────┐
│  interview engine                           │
│                                             │
│  ┌──────────┐    ┌────────┐    ┌─────────┐  │
│  │  model   │───▶│ guard  │───▶│ persist │  │
│  │  call    │    │ (q?/   │    │  turn   │  │
│  └──────────┘    │  prd?) │    └─────────┘  │
│       ▲          └───┬────┘                 │
│       │ reject →     │ ok                   │
│       └──────────────┘                      │
│                                             │
│  on done / runaway / model-stop:            │
│       force PRD → email PRD + methodology   │
└─────────────────────────────────────────────┘
    │
    ▼
PRD + methodology disclosure emailed and stored
```

An admin issues a single-use invite. The invitee writes one seed sentence, then answers yes/no questions until the model has enough or the invitee taps *I'm done*. The PRD and its companion methodology document are generated, persisted, and emailed.

Key files:

- [src/lib/interview-engine.ts](src/lib/interview-engine.ts) — turn loop, retry policy, 40-turn runaway ceiling, PRD-forcing fallback
- [src/lib/guard.ts](src/lib/guard.ts) — output classifier; the only thing between the model and the user
- [src/lib/skill/idea-seeding-agent.md](src/lib/skill/idea-seeding-agent.md) — system prompt, bundled at build time
- [src/app/i/[token]/q/interview.tsx](src/app/i/[token]/q/interview.tsx) — client card; masks model latency with a cycling word

Failure handling:

- *Bad format.* Guard rejects, engine regenerates once, second reject forces the stop-confirm path. No dead-ends.
- *No termination.* A 40-turn ceiling short-circuits to PRD generation.
- *PRD refusal.* The forcer appends an increasingly explicit instruction and accepts a best-effort markdown blob on the last attempt. The operator always gets something to read.
- *Latency feel.* Optimistic card transitions and a cycling loading word turn the wait into motion.

## Result

A finished session produces:

- A PRD in markdown, clean enough for an AI coding agent to consume directly.
- A companion methodology document naming the model, the system-prompt SHA-256 fingerprint, the sampling parameters, and the human-oversight protocol — frozen at finalization time.
- A persisted turn log in Postgres with the seed, every question, every answer, and the construct-validity probe used to confirm the interview was about the right thing.

Both documents share the session ID in their filenames and headers so they stay linked if separated in transit.

## Survey methodology

Verity sits in the highest-risk quadrant of the [AAPOR Task Force on Responsible AI Integration in Survey Research (2026)](https://aapor.org/wp-content/uploads/2026/05/Responsible-AI-Integration-In-Survey-Research.pdf) taxonomy — both an AI Interviewer and an AI Analyst. Three recommendations from that report are implemented as runtime behavior:

1. **Required Disclosures, as a companion document (§5).** Each session emits `prd-<id>.md` and `methodology-<id>.md`. The methodology lists tasks performed by AI, plain-language role description, human oversight, N=1 respondent, model id, system-prompt fingerprint, statefulness, and sampling parameters. Provenance is frozen at finalization. See [src/lib/disclosure.ts](src/lib/disclosure.ts).

2. **Pre-flight construct-validity probe (§4.3.1).** Before the first question, a separate model call restates the seed's goal, scope, and in/out-of-bounds examples. Persisted on the session, surfaced to the reviewer, log-only — not fed back into the interview prompt, so brief-vs-interview drift remains auditable. See [src/lib/construct-brief.ts](src/lib/construct-brief.ts).

3. **Continuous reliability monitoring (§4.1.3, §4.2.4).** A fixed set of five seeds with deterministic answer scripts replays through the engine weekly. Turn count, guard-reject rate, mean question length, PRD heading presence, and termination path are diffed against a committed baseline. Drift opens a GitHub Issue. The canary uses the same model id as production so silent provider-side changes show up as drift. See [src/lib/canaries/](src/lib/canaries/) and [.github/workflows/canary.yml](.github/workflows/canary.yml).

## Try it

Verity is invite-only by design — single-use tokens, no public signup. Reach out and I will issue you a token.

## Stack

Next.js 14 (App Router) with server actions, React 18, TypeScript. Postgres via Drizzle ORM ([schema](src/lib/db/schema.ts): invites, sessions, turns). Anthropic SDK for model calls. iron-session for admin auth, Resend for transactional email. Tailwind with a Material 3 token layer, Framer Motion for the interview card. Deployed on Vercel.

## Running locally

```
cp .env.example .env.local      # Postgres URL, Anthropic key, Resend key, session secret
npm install
npm run db:migrate
npm run dev
```

`npm test` runs vitest. `npm run typecheck` runs tsc. `npm run canary` replays the reliability seeds against the live model and requires `ANTHROPIC_API_KEY`.

## Deploys

Vercel runs `npm run vercel-build`, which applies pending Drizzle migrations before building (`drizzle-kit migrate && next build`). The schema travels with the code on every deploy. `DATABASE_URL` must be available at build time, not just runtime.
