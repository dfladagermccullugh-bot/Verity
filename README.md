# Verity

A constrained-interview tool that turns a one-sentence idea into a structured PRD. The invitee answers only yes, no, or done. The model does the asking.

Live: invite-only. See *Try it* below.

## Problem

Most AI brainstorming tools hand the user a blank text box. That works for people who already know what they want. For everyone else — a stakeholder with a half-formed idea, a designer who can describe a feeling but not a spec — the blank box is the bottleneck. Typing is slow, it forces premature commitment, and a long-form answer to a vague prompt usually produces a long-form mess.

The interesting question is not "how do we get better answers from the user?" It is "how little do we need from the user to extract a coherent product brief?"

## Approach

Reduce the user's surface area to three buttons. Require the model to ask exactly one yes/no question per turn. Reject any output that isn't a single, jargon-free, non-leading question and force a regeneration. When the model decides it has enough signal, it emits a PRD. A separate reviewer then decides whether one more round of questions is worth it — but the person on the other end still only ever taps yes, no, or done.

Two design bets sit underneath that:

1. **Constraint as interface.** A yes/no answer is one bit of information, but a well-targeted one from the right branch of a decision tree is worth a paragraph of vague prose. The model picks the next question; the user reacts. The interaction is faster, lower-stakes, and more honest — people commit to opinions they would have hedged on in writing.

2. **Hard guardrails, not soft prompting.** The system prompt asks for good behavior; the code enforces it. Every generated question passes through two deterministic checks before the user ever sees it: the [output guard](src/lib/guard.ts) (rejects multi-line output, batched questions, technology jargon, missing question marks) and the [anti-leading check](src/lib/anti-leading.ts) (rejects questions that telegraph the "expected" answer — tag questions like "…, right?", loaded openers like "Obviously…", and "don't you think…" phrasing). A failure regenerates the question; after repeated failures the engine forces the PRD-write path. The model is never trusted to follow the rules on its own — and because both checks are plain code, not extra model calls, they add no waiting time for the user.

## How it works

```
seed (one sentence)
    │
    ▼
┌──────────────────────────────────────────────────────────────┐
│  interview engine  (one ROUND)                               │
│                                                              │
│  ┌────────┐   ┌───────┐   ┌──────────────┐   ┌───────────┐  │
│  │ model  │──▶│ guard │──▶│ anti-leading │──▶│ persist   │  │
│  │ call   │   │       │   │   check      │   │ turn      │  │
│  └────────┘   └───┬───┘   └──────┬───────┘   │ + metadata│  │
│       ▲ reject ───┴──────────────┘           └───────────┘  │
│       └── regenerate                                         │
│                                                              │
│  on done / 40-turn ceiling / model-stop:                     │
│     force PRD → freeze PRD + methodology + analysis (v1)      │
│     → email → critic reviews the round                       │
└───────────────────────────┬──────────────────────────────────┘
            no gaps │        │ gaps found
                    ▼        ▼
            session done   open another round (v2, v3, …)
          (link → "done")  (person resumes it by reopening their link)
```

An admin issues a single-use invite. The invitee writes one seed sentence, then answers yes/no questions until the model has enough or the invitee taps *I'm done*. A PRD and two companion documents are generated, stored, and emailed. A reviewer model then checks the transcript for gaps; if it finds important ones, it opens a **follow-up round**. The invitee meets that next round simply by reopening their link — there is nothing to remember and nothing new to learn.

Key files:

- [src/lib/interview-engine.ts](src/lib/interview-engine.ts) — the round-aware turn loop, retry policy, 40-turn runaway ceiling, PRD-forcing fallback, and `finalizeRound` (freezes each round's documents and runs the reviewer)
- [src/lib/guard.ts](src/lib/guard.ts) — output classifier; the form check between the model and the user
- [src/lib/anti-leading.ts](src/lib/anti-leading.ts) — rejects leading/loaded question phrasing
- [src/lib/dimensions.ts](src/lib/dimensions.ts) — tags each question with the topic it covers
- [src/lib/analysis.ts](src/lib/analysis.ts) — computes the per-round quality report
- [src/lib/critic.ts](src/lib/critic.ts) — the between-round reviewer that decides whether to ask more
- [src/lib/seed-quality.ts](src/lib/seed-quality.ts) — flags a weak starting sentence for the operator
- [src/lib/skill/idea-seeding-agent.md](src/lib/skill/idea-seeding-agent.md) — system prompt, bundled at build time
- [src/app/i/[token]/q/interview.tsx](src/app/i/[token]/q/interview.tsx) — client card; masks model latency with a cycling word

Failure handling:

- *Bad or leading format.* The guard or anti-leading check rejects, the engine regenerates the question, and after repeated failures it forces the stop-confirm path. No dead-ends.
- *No termination.* A 40-turn ceiling short-circuits to PRD generation.
- *PRD refusal.* The forcer appends an increasingly explicit instruction and accepts a best-effort markdown blob on the last attempt. The operator always gets something to read.
- *Reviewer failure.* If the between-round reviewer errors or returns anything malformed, it fails safe — the session simply ends rather than trapping the person in more rounds.
- *Latency feel.* Optimistic card transitions and a cycling loading word turn the wait into motion.

## Result

A finished round produces:

- A PRD in markdown, clean enough for an AI coding agent to consume directly. When a session runs multiple rounds, each round produces a new **version** (v1, v2, …) so the brief's evolution is itself a record.
- A companion **methodology document** naming the model, the system-prompt SHA-256 fingerprint, the sampling parameters, the human-oversight protocol, and a note that questions are adaptively tailored — frozen at the moment that version was produced.
- A companion **analysis document** with backend quality signals about that round (more below). It is never shown to the respondent.
- A persisted turn log in Postgres: the seed, every question, every answer, the construct-validity probe, and per-question metadata (which topic the question covered, how often it had to be regenerated, whether it was rewritten for leading phrasing, and timing/device paradata).

All three documents share the session ID in their filenames and headers so they stay linked if separated in transit.

## Survey methodology

Verity is, in effect, a one-person survey run by an AI — so it is built to the standards of real survey research rather than treating "an AI asked some questions" as good enough. Two bodies of work ground the design.

### AAPOR — responsible AI integration

Verity sits in the highest-risk quadrant of the [AAPOR Task Force on Responsible AI Integration in Survey Research (2026)](https://aapor.org/wp-content/uploads/2026/05/Responsible-AI-Integration-In-Survey-Research.pdf) taxonomy — both an AI Interviewer and an AI Analyst. Three recommendations are implemented as runtime behavior:

1. **Required Disclosures, as a companion document (§5).** Each round emits `prd-<id>.md`, `methodology-<id>.md`, and `analysis-<id>.md`. The methodology lists tasks performed by AI, a plain-language role description, human oversight, N=1 respondent, model id, system-prompt fingerprint, statefulness, sampling parameters, the adaptive-tailoring caveat, and a pointer to the analysis companion. Provenance is frozen per version. See [src/lib/disclosure.ts](src/lib/disclosure.ts).

2. **Pre-flight construct-validity probe (§4.3.1).** Before the first question, a separate model call restates the seed's goal, the decision the PRD must support, its unit of analysis, and its in/out-of-bounds examples. Persisted on the session, surfaced to the reviewer, log-only — not fed back into the interview prompt, so brief-vs-interview drift remains auditable. See [src/lib/construct-brief.ts](src/lib/construct-brief.ts).

3. **Continuous reliability monitoring (§4.1.3, §4.2.4).** A fixed set of five seeds with deterministic answer scripts replays through the engine weekly. Turn count, guard-reject rate, mean question length, PRD heading presence, and termination path are diffed against a committed baseline. Drift opens a GitHub Issue. The canary uses the same model id as production so silent provider-side changes show up as drift. See [src/lib/canaries/](src/lib/canaries/) and [.github/workflows/canary.yml](.github/workflows/canary.yml).

### Measurement quality (from *Survey Methodology*, Groves et al.)

A yes/no interview is easy to get wrong in ways that quietly corrupt the result. These controls borrow directly from the survey-methodology literature and run entirely on the backend — the person's experience never changes:

- **Asking well.** One question at a time, in plain language, with no leading phrasing — the comprehension and measurement-error basics. The guard and the anti-leading check enforce them mechanically.
- **Topic coverage.** Every question is tagged with which of ten topics it covers (problem, primary user, core jobs, inputs, outputs, platform & context, data sensitivity, scale, integrations, success signal), producing a map of what got explored and what didn't. See [src/lib/dimensions.ts](src/lib/dimensions.ts).
- **A quality report per round** ([src/lib/analysis.ts](src/lib/analysis.ts)), so each PRD comes with a sense of how much to trust it:
  - **Yes-drift (acquiescence).** Yes/no buttons quietly nudge people toward "yes." Verity measures how lopsided the answers are and how long the longest run of identical answers is, and flags a session that skews too far.
  - **Answer speed.** Very fast taps can mean the person isn't really reading; these are counted.
  - **Asking the same thing twice (triangulation).** When two questions land on the same topic, their answers are compared; agreement is a small reliability signal, disagreement is flagged.
  - **Coverage and leading-rate** roll up from the per-question tags above.
- **A second opinion between rounds.** After each round, a reviewer model reads the whole transcript and the PRD and decides whether anything important is still missing or ambiguous — a content-adequacy check — and, if so, opens a focused follow-up round. See [src/lib/critic.ts](src/lib/critic.ts).
- **Paradata.** Behavioral side-data captured without asking anything extra: how long each answer took, the device class, where a session broke off. Useful for judging answer quality after the fact.
- **A weak starting sentence is flagged.** A vague, two-ideas-in-one, or loaded seed is caught up front and noted for the operator — without blocking the person. See [src/lib/seed-quality.ts](src/lib/seed-quality.ts).

**What Verity deliberately leaves out.** Verity talks to one named person about one idea (N=1). The half of survey methodology about generalizing to a population — sampling, weighting, coverage, representativeness — does not apply and is intentionally not implemented; claiming otherwise would be window dressing.

## Admin & output

The operator signs in to a registry of all sessions. Each session opens to the latest PRD plus its full version history (with a simple line-level diff between consecutive versions so you can see what each round changed), the construct brief, any seed warnings, and the per-round analysis. The PRD, methodology, and analysis are each downloadable as markdown, and a single export produces a training-data JSON of every session broken down into rounds and turns, with all per-question metadata and the computed analysis included. Each finished round also emails the operator the PRD with the methodology and analysis attached.

## Try it

Verity is invite-only by design — single-use tokens, no public signup. The token lives in a durable link: a session that runs multiple rounds is picked up again simply by reopening that same link. Reach out and I will issue you a token.

## Stack

Next.js 14 (App Router) with server actions, React 18, TypeScript. Postgres via Drizzle ORM ([schema](src/lib/db/schema.ts): `invites`, `sessions`, `rounds`, `turns`). Anthropic SDK for model calls (model id from `ANTHROPIC_MODEL`, default `claude-sonnet-4-6`). iron-session for admin auth, Resend for transactional email. Tailwind styled with the **Midnight Precision** design system — a dark-only, technical-minimalist theme (obsidian surfaces, a single signal-gold accent, the Inter typeface, sharp corners, hairline rules, no shadows), with Framer Motion for the interview card. Deployed on Vercel.

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
