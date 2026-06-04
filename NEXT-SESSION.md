# Next-session notes — survey-methodology iterations 2 and 3

Both items below are concrete recommendations from the [AAPOR Task Force on Responsible AI Integration in Survey Research (2026)](https://aapor.org/wp-content/uploads/2026/05/Responsible-AI-Integration-In-Survey-Research.pdf) and follow directly from iteration 1 (Required Disclosures as a companion document, already shipped).

Before starting, re-read for context:
- The "Survey methodology" section of [README.md](README.md) — for the framing already established
- [src/lib/disclosure.ts](src/lib/disclosure.ts) — for the documentation style and AAPOR citation pattern
- AAPOR report §4.3.1 (validity probe technique) and §4.1.3 + §4.2.4 (continuous reliability evaluation)

---

## Iteration 2 — Pre-flight construct-validity probe ("task brief")

### Why
AAPOR §4.3.1 recommends, as a validity check, prompting the model to first restate the goal in its own words, list scope boundaries, and specify what would count as a correct vs. out-of-scope output — *before* producing substantive content. This is the antidote to the deepest failure mode in AI-as-Interviewer: the model competently asking questions about the *wrong construct*. Verity has no audit trail today for whether the model's interpretation of the seed matched the invitee's actual intent.

### What
After the seed is submitted, fire one extra LLM call **before** the first interview question. The model produces a structured restatement of:
1. The construct/goal being elicited (what kind of PRD this seed implies)
2. Scope boundaries (in vs. out)
3. What would count as a sufficient PRD vs. an out-of-scope answer

Persist on the session. Don't show to the invitee. Surface in the admin PRD view alongside the seed so a reviewer can confirm the interview was *about the right thing*. Cross-reference in the methodology disclosure as evidence of a documented validity check.

### Implementation sketch

**Schema** — add column on `sessions`:
```ts
constructBrief: text("construct_brief"),
```
Migration: `npx drizzle-kit generate --name=construct_brief`. Auto-applies on deploy via the existing `vercel-build` script.

**New module** — `src/lib/construct-brief.ts`:
- `buildConstructBrief(seed: string): Promise<string>` — single Anthropic call with its own short system prompt (not the interview skill). Returns JSON with `goal`, `scope`, `inBoundsExamples`, `outOfBoundsExamples`. Serialize to markdown for storage so the admin view renders it natively.

**Wire into engine** — [src/lib/interview-engine.ts](src/lib/interview-engine.ts):
- In `beginInterview()`, before generating the first question, await `buildConstructBrief(session.seed)` and persist. Adds ~1s to session start; acceptable because it fires once per session.

**Admin surface** — [src/app/admin/prds/[id]/page.tsx](src/app/admin/prds/[id]/page.tsx):
- New collapsible panel above the PRD card, "Construct brief (validity check)". Reuse the existing `<details>` pattern from the methodology panel.

**Methodology cross-reference** — [src/lib/disclosure.ts](src/lib/disclosure.ts):
- Add a line under "Human oversight and validation": `**Construct-validity probe:** A structured restatement of the seed's intent was generated and logged before the first interview question (see admin session record).` Only add when `constructBrief` is non-null.

**Tests** — `src/tests/construct-brief.test.ts`:
- Mock the Anthropic call; verify the three structured sections are present after `buildConstructBrief()` returns.

### Open design questions to confirm before coding
1. **JSON vs. free markdown** — JSON makes the panel render nicely and enables future programmatic checks. Recommended.
2. **Closed-loop?** — Feeding the brief back into the interview's system prompt would constrain question generation to the established construct. Riskier (drift between brief and interview becomes harder to audit). Out of scope for this iteration; log-only first.
3. **Does the construct brief travel with the methodology download?** — Probably yes (as an appendix or a third companion file). Decide together.

### Acceptance criteria
- Every new session has a non-null `construct_brief` by the time the first question is shown.
- Admin PRD page renders the brief in a collapsible panel.
- Methodology disclosure mentions the probe when present.
- Existing sessions (NULL `construct_brief`) degrade gracefully — no panel, no methodology line.

---

## Iteration 3 — Reliability drift canaries

### Why
AAPOR §4.1.3: "performance observed during initial testing or early deployment should not be assumed to remain stable over time." Model providers update silently, prompt-template edits alter behavior, and reliability degrades invisibly. §4.2.4 recommends "periodically reprocessing a fixed reference dataset, tracking key output distributions over time."

For a portfolio reader, this also demonstrates treating evaluation as *continuous* rather than one-shot — visible in commit history as ongoing methodology engagement.

### What
Commit a fixed set of 5–10 reference seeds with deterministic answer scripts. Replay them through the full interview engine against the live model on a weekly schedule. Record observable dimensions (turn count, guard-reject rate, mean question length, expected PRD section markers present, natural-vs.-ceiling termination). Diff against a committed baseline. Open a GitHub Issue on drift.

### Implementation sketch

**Fixtures** — `src/lib/canaries/seeds.json`:
```json
[
  {
    "id": "kids-puzzle-app",
    "seed": "A puzzle app for 6-8 year olds that teaches multiplication.",
    "answerScript": ["yes", "no", "yes", "yes", "no", "done"]
  }
]
```
Cover variety: B2C, B2B, service, physical product, very short seed, very long seed, ambiguous seed.

**Baseline** — `src/lib/canaries/baseline.json`:
```json
{
  "kids-puzzle-app": {
    "turnCount": 5,
    "guardRejectRate": 0.0,
    "meanQuestionLengthChars": 52,
    "prdHeadingsPresent": ["# ", "## "],
    "terminatedNaturally": true
  }
}
```

**Runner** — `scripts/canary.ts`:
- For each seed, **bypass the DB** — direct calls to `callModel` (or a thin wrapper around the engine that takes in-memory state) driven by the seed's `answerScript`. Canary runs must not pollute the admin view.
- Wrap `callModel` to count calls / measure rejection rate / capture question lengths.
- Compare against baseline. Tolerances: integer counts ±1, ratios ±0.05, lengths ±20%, headings must all be present.
- Print a table; exit non-zero on drift.

**Scripts** — `package.json`:
```json
"canary": "tsx scripts/canary.ts",
"canary:rebaseline": "tsx scripts/canary.ts --rebaseline"
```
Rebaseline must be explicit and intentional — never automatic, or drift detection becomes theater.

**Schedule** — `.github/workflows/canary.yml`:
- Weekly cron.
- Needs `ANTHROPIC_API_KEY` as a repo secret.
- On non-zero exit, opens a GitHub Issue with the drift report.

### Important constraints
- **Don't run against the prod DB.** Bypass `db` entirely — in-memory state only.
- **Don't run on every PR.** Schedule-only to avoid burning budget.
- **Cost estimate.** 5 seeds × ~10 turns × 1 model call each ≈ 50 calls per run. With Sonnet 4.6 well under a penny. Weekly ≈ pennies/month.
- **`tsx` dependency.** Add as a devDependency if not already present.

### Open design questions to confirm before coding
1. **Drive answers from a script or from a "respondent LLM"?** Script — deterministic and reproducible. The point is to test the *interviewer*, not to simulate users.
2. **PRD section presence — exact string or regex?** Regex over expected H1/H2 headings. Wording will drift legitimately as the model improves; structure should stay.
3. **Threshold for failure.** Start permissive (±20% on lengths, presence-required for headings) and tighten over time once you see what natural variance looks like.
4. **Where do failures go?** GH Issue auto-opened by the workflow. Optionally a separate notification channel — confirm if you want one.

### Acceptance criteria
- `npm run canary` runs locally with `ANTHROPIC_API_KEY` set, completes in <2 minutes, exits 0 against the committed baseline.
- `npm run canary:rebaseline` overwrites `baseline.json` and exits 0.
- A scheduled GitHub Actions workflow runs weekly and opens an Issue on drift.
- Canary runs leave no rows in `sessions` or `turns`.

---

## After both ship

Update the "Survey methodology" section of [README.md](README.md) to enumerate all three iterations under one heading — Required Disclosures (shipped), Construct-validity probe (#2), Continuous reliability monitoring (#3) — so the portfolio reader sees a single section that maps Verity's behavior 1:1 to three specific AAPOR 2026 recommendations.

## Suggested order

Do #2 first. It's cheaper to ship (single migration, single call, single panel), produces a per-session artifact that compounds with the existing methodology document, and validates the pattern of "documented validity check" before investing in scheduled infrastructure for #3.
