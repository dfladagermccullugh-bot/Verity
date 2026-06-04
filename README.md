# Verity

A constrained-interview tool that turns a vague idea into a structured PRD. The invitee answers nothing but **yes**, **no**, or **done** — the model carries the burden of asking.

Live: invite-only. See *Try it* below.

---

## The problem

Most AI brainstorming tools hand the user a blank text box and ask them to type. That works for people who already know what they want to build. For everyone else — a stakeholder with a half-formed idea, a designer who can describe a feeling but not a spec, a founder mid-shower-thought — the blank box is the bottleneck. Typing is slow, typing forces premature commitment, and a long-form answer to a vague prompt usually produces a long-form mess.

The interesting question is not "how do we get better answers from the user?" It is "how little do we need from the user to extract a coherent product brief?"

## The approach

Verity reduces the user's surface area to three buttons. The model is required to ask exactly one yes/no question per turn, and the system rejects any output that isn't a single, jargon-free, single-sentence question. When the model decides it has enough signal, it emits a PRD in markdown and the session ends.

Two design bets sit underneath that:

1. **Constraint as interface.** A yes/no answer is roughly one bit of information, but a *well-targeted* yes/no answer from the right branch of a decision tree is worth a paragraph of vague prose. The model's job is to pick the right next question; the user's job is to react. The interaction is faster, lower-stakes, and surprisingly more honest — people commit to opinions they would have hedged on in writing.

2. **Hard guardrails, not soft prompting.** The system prompt asks for good behavior; the [output guard](src/lib/guard.ts) enforces it. Multi-line output, batched questions, technology jargon, and missing question marks all fail the guard, trigger a regeneration, and — on a second failure — force the model into the PRD-write path. The model is never trusted to follow format rules on its own.

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
│       force PRD → email PRD                 │
└─────────────────────────────────────────────┘
    │
    ▼
PRD markdown emailed to operator + stored
```

**Flow.** An admin creates a single-use invite. The invitee opens the link, writes one seed sentence, then answers yes/no questions one at a time until the model has enough to write the PRD — or until they tap *I'm done*. The PRD is generated, persisted, and emailed.

**Key files.**
- [src/lib/interview-engine.ts](src/lib/interview-engine.ts) — turn loop, retry policy, runaway ceiling, PRD-forcing fallback
- [src/lib/guard.ts](src/lib/guard.ts) — output classifier; the only thing standing between the model and the user
- [src/lib/skill/idea-seeding-agent.md](src/lib/skill/idea-seeding-agent.md) — the system prompt, bundled into the build so it ships with the serverless function rather than being read from disk at runtime
- [src/app/i/[token]/q/interview.tsx](src/app/i/[token]/q/interview.tsx) — the client-side card that masks model latency with optimistic animation and a cycling loading word

**Failure modes I cared about.**
- *Model misbehaves on format.* The guard rejects and the engine regenerates once; a second reject forces the stop-confirm path so the session never dead-ends.
- *Model never stops asking.* A hard ceiling at 40 turns short-circuits to PRD generation.
- *Model refuses to write the PRD.* The forcer appends an increasingly explicit instruction and accepts a best-effort markdown blob on the last attempt — the operator always gets something to read.
- *Latency feels dead.* Optimistic card transitions and a cycling word make the wait feel like motion rather than a stall.

## Survey methodology

Verity sits in the highest-risk quadrant of the AAPOR taxonomy for AI in survey research — it is both an *AI Interviewer* (asking questions) and an *AI Analyst* (synthesizing the final artifact from collected responses). Every completed session therefore produces two linked documents, modeled on the Required Disclosures framework specified by the [AAPOR Task Force on Responsible AI Integration in Survey Research (2026)](https://aapor.org/wp-content/uploads/2026/05/Responsible-AI-Integration-In-Survey-Research.pdf):

- `prd-<session-id>.md` — the substantive PRD. Clean for downstream consumers (notably AI coding agents). Carries an invisible HTML-comment header naming its companion methodology document.
- `methodology-<session-id>.md` — the AAPOR-style disclosure: tasks performed by AI, plain-language role description, human oversight and validation, number of human respondents (N=1), model identifier, system-prompt SHA-256 fingerprint, statefulness, sampling parameters, and date of generation.

Both documents share the Verity session ID in their filenames and headers, so the association survives if the files are separated in transit. Provenance is frozen at finalization time — model and prompt fingerprint reflect the conditions that produced *this specific* PRD, not whatever is configured today. Following survey-research convention, the methodology lives outside the deliverable's body rather than inside it.

See [src/lib/disclosure.ts](src/lib/disclosure.ts) for the document templates and [src/lib/interview-engine.ts](src/lib/interview-engine.ts) for where they are persisted.

## Stack

- **Next.js 14** App Router, React 18, TypeScript, server actions for the interview loop
- **Postgres** via Drizzle ORM; schema in [src/lib/db/schema.ts](src/lib/db/schema.ts) (invites, sessions, turns)
- **Anthropic SDK** for model calls
- **iron-session** for admin auth, **Resend** for transactional email
- **Tailwind** with a Material 3 token layer; **Framer Motion** for the interview card
- Deployed on Vercel

## Why I built it

I wanted to test whether the right interaction model could make an LLM useful for people who do not write well-formed prompts. The yes/no constraint started as a joke and turned out to be the thing the product is about: it shifts the work of articulation from the user to the model, where it should have been the whole time.

It is also a forcing function for me. Every design decision — guard rules, retry policy, latency masking, the choice to bundle the system prompt at build time — comes from a question the constraint surfaced.

## Try it

Verity is invite-only by design (single-use tokens, no public signup). If you want to walk through it, reach out and I will issue you a token.

## Running locally

```
cp .env.example .env.local      # fill in Postgres URL, Anthropic key, Resend key, session secret
npm install
npm run db:migrate
npm run dev
```

Tests: `npm test`. Type-check: `npm run typecheck`.

## Deploys

Vercel uses `npm run vercel-build`, which applies any pending Drizzle migrations before building Next.js (`drizzle-kit migrate && next build`). This keeps the schema in lockstep with the code on every deploy — no manual migration step required when a PR adds a new migration file. `DATABASE_URL` must be available at build time (not runtime-only) in the Vercel project settings for this to work.
