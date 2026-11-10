# Verity Voice

AI voice survey interviewers on top of Qualtrics. Plan, decisions and phases:
[`../voice-interviewer-plan.md`](../voice-interviewer-plan.md).

**Status: Phase 0 scaffold.** No product behaviour yet.

This folder is a self-contained package. The original Verity web app at the repo root is
separate: it does not import from here, its typecheck excludes this folder, and nothing
here touches its database.

## Commands

Run from `voice/`. Needs Node 22.13 or newer.

```bash
npm ci
```

```bash
npm run typecheck
```

```bash
npm test
```

## Layout

```
src/                  product code
test/                 tests (vitest)
fixtures/qualtrics/   survey files and exports from the Qualtrics test survey (made-up answers only)
docs/                 operator steps and the test-survey specification
```

## Rules

- No respondent data, archive or credential is ever committed. The repo is intended to be public.
- Every phase ships with its own verification; see the plan.
