# Verity Voice

AI voice survey interviewers on top of Qualtrics. Plan, decisions and phases:
[`../voice-interviewer-plan.md`](../voice-interviewer-plan.md).

**Status: Phases 1 and 2 (core) — survey file in, a full scripted interview in text, response file out. No voice yet.**

This folder is a self-contained package. The original Verity web app at the repo root is
separate: it does not import from here, its typecheck excludes this folder, and nothing
here touches its database.

## What works today

- **Phone-readiness check.** Reads a Qualtrics survey file (`.qsf`) and reports whether it
  can be run by voice, what must change if not, and every word that would be spoken.
- **Survey logic.** Display logic and skip logic are followed exactly; an interrupted
  interview resumes where it stopped.
- **Typed interview.** Runs the survey in the terminal with typed answers.
- **Response file.** Writes answers as a CSV in Qualtrics' import layout.

- **The interviewer.** A deterministic state machine runs the whole call: AI disclosure,
  consent, questions word for word, neutral probes, opt-out, stop and call-back. It can
  only speak lines from a fixed table, looked up by id. A model may only classify what the
  respondent said, and its verdict is checked in code (real option, evidence actually
  spoken) before it counts. Every line, utterance and decision goes to an audit log.
- **Simulated respondents.** Scripted people replying in text, so calls run end to end
  with no carrier, speech vendor or model. See [`docs/sample-calls.md`](docs/sample-calls.md).

Anything outside the supported subset is refused with a plain reason, never approximated.
Supported: single choice, 0–10 scale, number entry, open text, single-answer Likert grids,
read-only text; display and skip logic on earlier answers; embedded-data fields.

## Commands

Run from `voice/`. Needs Node 22.13 or newer.

```bash
npm ci
```

```bash
npm run verity -- check fixtures/qualtrics/library-test.qsf
```

```bash
npm run verity -- interview fixtures/qualtrics/library-test.qsf --out responses.csv --audit audit.json
```

```bash
npm run typecheck
```

```bash
npm test
```

## Layout

```
src/instrument/   platform-neutral questionnaire model; HTML to spoken text
src/qualtrics/    .qsf reader, wording advice, response CSV writer
src/engine/       survey-logic engine; rule-based reading of typed answers
src/script/       the spoken script: every line, fixed in advance, with a version hash
src/interviewer/  call protocol, answer classification, the interviewer, simulated respondents
src/report/       phone-readiness report; readable call reports
src/cli.ts        command line
test/             tests (vitest)
fixtures/         test survey and expected response file (made-up answers only)
docs/             what still needs the operator; the test-survey specification
```

## Not built yet

- Saving calls to a database, the live language-model classifier and its labelled
  evaluation set (rest of Phase 2); speech (Phase 3); phone calls (Phase 4).

## Not yet verified

- No file here has been through a live Qualtrics account. The reader is checked against
  genuine exports; the response file follows the layout of genuine exports, but a real
  import has not been run. See `docs/qualtrics-test-survey.md`.

## Rules

- No respondent data, archive or credential is ever committed. The repo is intended to be public.
- Every phase ships with its own verification; see the plan.
