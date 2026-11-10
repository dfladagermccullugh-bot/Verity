# Verity Voice — AI voice interviewers on top of Qualtrics: plan

**Status (10 Nov 2026):** Phases 0 and 1 built; Phase 2 core built. The operator has asked for the build to
proceed without per-phase sign-off. Open items that need the operator's logins are in
`voice/docs/phase-0-operator-steps.md` (password rotation, archive, Qualtrics import check).

- **Phase 0:** `voice/` package, `ci.yml`, old code bookmarked as branch
  `legacy/idea-seeder-v1`. Not done: archive and password rotation (need logins).
- **Phase 1:** `.qsf` reader, readiness report, spoken script, survey-logic engine, typed
  interview, response CSV writer. Checked against three genuine Qualtrics
  exports. **Not yet verified against a live Qualtrics account.**
- **Phase 2 (core built, rest open):** call protocol with locked AI disclosure, rules-first
  classification with code-checked model verdicts, the interviewer state machine, audit
  log, simulated respondents, generated `voice/docs/sample-calls.md`; 126 tests including
  400 random simulated calls that never produce an off-script line. **Open:** database
  persistence, the live Claude classifier, the 300-answer labelled evaluation set, the
  weekly live check.
- **Deviations from this plan:** piped text and multi-select are refused for now, not
  supported (piped text needs live speech, Phase 3). The test survey file is hand-written
  until a real export replaces it. Location is assumed to be the US.

## Context

Request: a portfolio product that runs many AI voice interviewers on top of Qualtrics. They
phone respondents, read the survey aloud, and put answers back into Qualtrics, which stays
the system of record for questionnaires, contacts, responses and reporting.

Evidence level: both repos read end to end (code reading; no tests run, nothing executed
against a live database, model, carrier or Qualtrics account). Outside facts re-checked on
the web on 10 Nov 2026; items marked *(unverified)* could not be confirmed from a primary
source. Nothing here is legal advice.

### What the reading changed from the brief

- **Verity does not enforce verbatim wording today.** The model writes every question;
  `src/lib/disclosure.ts:161` says Verity "forgoes verbatim wording control". Its guardrails
  check model-written questions (`guard.ts`, `anti-leading.ts`). Verbatim enforcement is new work.
- **`phone_map` is an IVR menu mapper, about 6,600 lines.** It has no campaign planner, no
  cost budget, no calling hours, no recording, no answering-machine detection. Its Telnyx
  connection is listen-only (`server/telephony/telnyx.ts:204`). Speaking, turn-taking and
  interruption handling do not exist.
- **Carrier: Telnyx only.** `phone_map` defaults to Telnyx and its deploy script sets up
  only Telnyx, Deepgram and Fly.io. It also contains unused Twilio fallback code; that is
  not carried over. ("Telephony" in file paths is just the generic word for phone calling,
  not a vendor.)
- **Verity's database is Neon Postgres**, not Supabase. The repo holds no session count; the
  "about 14" must be confirmed from the live database.
- **A database password is in Verity's git history** (`handoff.md:258`), rotation pending.
- **Qualtrics has no native AI voice or phone interviewer.** It has AI text follow-ups on
  open-text questions, human-moderated interviews, and partner phone tools that need a paid
  API licence. The product does not duplicate a Qualtrics feature.
- **A funded competitor exists:** Miravoice (AI voice agents for long phone surveys, $6.3M
  seed, April 2026). No Qualtrics integration found. The claim to make is "auditable,
  standardized, Qualtrics-native", not "first".

## 1. What the product is

A researcher builds the survey in Qualtrics as usual. Verity Voice then:

1. **Reads the survey file** (`.qsf` export) and reports which questions can be asked by
   phone, which cannot, and exactly what will be spoken for each.
2. **Takes a contact list** exported from Qualtrics, with proof of consent per person.
3. **Calls people**, many at once, within permitted hours. Each call: AI disclosure, consent,
   the questions word for word, a spoken or keypad answer, a neutral probe if unclear.
4. **Writes answers back** as a CSV that Qualtrics imports as ordinary responses, tagged with
   mode, call outcome and a link to the audit trail.
5. **Reports quality**: response rates, breakoffs, answer-quality flags, and a methodology
   disclosure that follows AAPOR's 2026 transparency items for AI interviewing.

It does not write questions, build surveys, store contacts long-term, or chart results.

## 2. Reuse, rewrite, retire

| Source | Reuse | Rewrite | Retire |
|---|---|---|---|
| **Verity** | Resumable-engine pattern: idempotent `advance`, row-locked claims, one pending turn (`src/lib/interview-engine.ts:453`, `interview-store.ts:96`, migration 0006). Test harness: in-memory Postgres, scripted model, engine suite (`src/tests/helpers/`). Guarded-migration discipline. Canary and baseline rule (`scripts/canary.ts`, `src/lib/canaries/compare.ts`). Injected model function (`interview-policy.ts:23`). Doc conventions (`handoff.md`, `history.md`). | `analysis.ts`: yes/no only → any scale (straightlining, acquiescence, latency, item nonresponse). `disclosure.ts`: keep structure, replace text, map to AAPOR July 2026 items. `anti-leading.ts`: becomes an advisory check on the researcher's wording in the readiness report. | AI question writing, PRD synthesis, critic, construct brief, `dimensions.ts`, seed intake, respondent web UI, admin UI, invites, email. Frozen at a git tag, not deleted. |
| **phone_map** | Call abstraction (`server/telephony/types.ts`: `CallSession`, `TelephonyProvider`). Telnyx call setup and signed-webhook checks (`telnyx.ts`). Phone audio codec, key-tone detection, ring/music detector (`audio.ts`). Deepgram listening seam (`stt.ts`: `SttStream`). `Semaphore`, `RateLimiter` (`util/infra.ts`). `checkCallable` (`util/phone.ts:57`). Simulator timing mechanics (`simulator.ts`). Fly and Docker setup. Carrier test pattern (stubbed carrier, real websocket; `test/telnyx.test.ts`). | Call loop (`explorer/agent.ts`): menu-pressing → interviewing. Simulator scripts: phone menus → human respondents. Deepgram adapter → current Flux API with turn events. Telnyx stream: listen-only → two-way. Opt-out endpoint (currently open to anyone). SQLite → Postgres. | Twilio code (`twilio.ts`, never used). Tree explorer, IVR parser, number discovery, web UI. All stay in `phone_map`, which remains its own demo. |
| **Neither (new)** | | | Text-to-speech, outbound speech, turn-taking, interruption handling, QSF reader, CSV writer, consent gate, calling hours, call dispositions, audit log, review queue. |

## 3. Key decisions

- **D1 — Home: this repo, in a new `voice/` folder.** Telephony files are copied in from
  `phone_map` with their origin noted. Reason: Verity has the test, migration and
  documentation discipline, the Postgres patterns, and a name that fits; the portable part of
  `phone_map` is about 1,300 lines. Both are TypeScript. The old Verity app stays untouched
  at the root until Phase 6.
- **D2 — Name: keep "Verity"**, working title "Verity Voice". Changeable at Phase 6.
- **D3 — Qualtrics link is file-based first.** QSF in, CSV out, uploaded by hand. A
  `SurveyPlatform` interface hides this, so an API version (and other platforms) can be added
  without touching the interviewer. Reason: free accounts have no API; the API is a paid add-on.
- **D4 — Not the Sessions API, even with a licence.** It reportedly handles only multiple
  choice, text entry and NPS *(unverified against official docs)*, and would make every live
  call depend on Qualtrics responding mid-call. Completed responses are written at the end.
- **D5 — We run the survey logic ourselves, for a declared subset.** v1: single choice,
  0–10 / NPS, numeric entry, open text, Likert grids (read row by row), read-only text; skip
  and display logic on earlier answers; simple piped text. Anything else (loops, quotas,
  scripts, images, file upload) makes the tool refuse the survey with a plain reason. No
  silent approximation.
- **D6 — The AI never composes speech.** Everything spoken comes from a fixed script table:
  question text and options exactly as in the QSF, scripted intro and consent, and a short
  list of approved neutral probes ("Let me repeat the question", "Whichever is closest",
  repeat the options). The speak function accepts a script entry ID, not free text, so
  off-script speech cannot be expressed in the code. No praise or reaction to answers.
- **D7 — The AI only classifies.** Simple rules handle clear answers ("yes", "four", a key
  press) with no model. The model handles the rest and must return: intent (answer, repeat
  request, don't know, refusal, opt-out, callback, off-topic, unclear), the option, a
  confidence, and the exact words it relied on. Code decides: record, probe (limited
  count), or code as don't know / refused. Low confidence goes to a human review queue.
- **D8 — Cascaded, one speaker at a time, pre-recorded prompts.** Each question is turned
  into audio once per survey and replayed, so every respondent hears the identical
  recording. The interviewer stops speaking when the respondent starts; where it was cut
  off is logged. Response time is measured from the end of the question audio.
- **D9 — Three ways to connect, same interviewer:** simulator, browser microphone, phone
  line. The browser version needs no carrier and no call-consent paperwork, and is the
  public demo.
- **D10 — Carrier and hosting stay as in `phone_map`: Telnyx and Fly.io. No Twilio.**
  Telnyx's docs confirm two-way audio on the existing connection
  (`stream_bidirectional_mode: rtp`), a stop-playback command, playback markers that report
  how far a prompt got, and key-press events. Answering-machine detection is a Telnyx
  option ($0.002 per call).
- **D11 — Voice models are chosen on measured quality, not on what is already set up.**
  The carrier and the voice models are independent, so this choice does not affect Telnyx.
  - *Speaking* — starting pick: Cartesia Sonic 3.6 (phone-format output and word timings
    confirmed in its docs). Compared against Fish Audio, ElevenLabs and Deepgram Aura.
    Prompts are recorded once per survey and converted to phone format by us, so any of
    them can be used; the test is how clear each sounds over a phone line.
  - *Listening* — starting pick: Deepgram Flux (phone audio and turn detection confirmed,
    $0.0077/min). Compared against Cartesia Ink-2 (lowest error rate on Artificial
    Analysis in June 2026; phone-audio support not stated) and MAI-Transcribe-2 (most
    accurate by vendor figures; preview, reportedly no word timings).
  - *Decided by a bake-off in Phase 3* on our own phone-quality test answers: share of
    answers mapped correctly, delay before the interviewer responds, prompt clarity, cost.
    The results table goes in the write-up.
  - *Classifying answers:* a small fast Claude model; key already held for Verity.
  - Each sits behind an interface, so a swap does not touch the interviewer.
- **D12 — New, separate Postgres database; Fly.io hosting.** The old Verity database is
  never touched by new code or migrations.
- **D13 — Compliance rules are code, not settings.** See section 5.
- **D14 — Call outcomes use AAPOR Standard Definitions** (complete, partial, refusal,
  no contact, answering machine, and so on), so standard response rates can be reported.
- **D15 — Old Verity app:** archive its sessions, tag the code, leave it live and untouched
  until the new demo is public, then switch it off. No respondent data is deleted or
  committed to git.

## 4. How one call works

1. Dialer picks a case that has consent on file, is inside calling hours, is not on the
   do-not-call list and has attempts left. Otherwise it cannot dial.
2. Answering machine → hang up, no message. Person → scripted intro: who is calling, that
   this is an AI, purpose, length, that the call is transcribed, how to stop.
3. Consent asked. No → thanked, call ends, outcome recorded. Audio is kept only on a
   separate yes.
4. For each question: play the recording → listen → classify → record, probe, or code as
   nonresponse → next question by the survey's own logic.
5. "Stop calling me" or the opt-out key at any point → call ends, number blocked permanently.
6. Dropped call → case resumes at the next unanswered question on callback.
7. Every step is written to an append-only log: what was played, what was heard, how it was
   mapped, by which rule or model version, with what confidence.

## 5. Compliance built into the code

- **Consent gate:** no consent record (who, when, how, for what) → not dialable. Tested as an invariant.
- **AI disclosure in the first sentence**, locked into the script; a campaign without it will not start.
- **Calling hours:** 9am–8pm respondent local time by default; time zone from the contact
  file and from the area code, using the stricter of the two.
- **Opt-out:** by voice or key, immediate and permanent; exported for Qualtrics' unsubscribe column.
- **Attempt limits** per person and per campaign; spend and minute caps per campaign.
- **Recording:** treated everywhere as needing everyone's consent. Audio deleted after 30
  days by default; transcripts kept under a stated retention period.
- **Never dialled:** emergency, premium-rate, numbers outside enabled countries (existing `checkCallable`).
- **US only** at first. Real calls go only to you until a lawyer has reviewed the consent
  wording; the pilot uses volunteers who signed up through a Qualtrics form.

## 6. Phases

One commit series per phase; each phase ships alone and is useful alone.

### Phase 0 — Safeguard and scaffold (no keys)
- Archive the old sessions (full database dump plus the existing `/api/admin/export` file),
  stored outside git. Tag the old code. Rotate the leaked database password.
- Create `voice/` with tests and a pull-request check (typecheck and tests; Verity has none today).
- You run a 20-minute Qualtrics check on a test survey I specify: export the QSF, answer it
  once, export the response CSV, try a CSV import, export a contact list.
- **Verify:** archive row counts equal live counts; old app builds unchanged; both test suites pass.

### Phase 1 — Survey in, responses out (no voice, no keys)
- QSF reader; readiness report; spoken-script preview; survey-logic engine; a typed
  (text-only) interview in the terminal; CSV writer in Qualtrics' import layout.
- Ships as: a phone-readiness checker for any Qualtrics survey.
- **Verify:** tests on your real QSF files; the same answers produce the same path and the
  same CSV values as Qualtrics' own export; you import our CSV and see the responses in
  Qualtrics; unsupported features produce a refusal, tested.

### Phase 2 — Interviewer core, simulated (existing Anthropic key; tests use a scripted model)
- Call state machine, script table, probes, classifier, audit log, database, resume after
  a dropped call. Scripted respondents: cooperative, vague, off-topic, refuser, interrupter,
  opt-out, always-agrees.
- **Verify:** a test proving nothing outside the script table can be spoken; engine suite on
  in-memory Postgres; a labelled set of at least 300 answers scored for accuracy and for
  whether confidence matches accuracy; baseline committed; weekly live check.

### Phase 3 — Real voice in the browser (voice-model keys; Fly.io)
- Voice-model bake-off (D11), then the winners wired in. Pre-recorded prompts, live
  listening, turn-taking, interruption handling, response-time measurement. A web page
  where anyone can be interviewed after consenting.
- **Verify:** synthetic respondents with different voices and background noise, recorded
  answer compared with the true answer; response delay at median and 95th percentile;
  each prompt transcribed back and compared with its text; five interviews by you.

### Phase 4 — Phone line and many calls (simulator first; then Telnyx)
- Port the Telnyx and audio files; switch the Telnyx stream to two-way; add speak, stop and
  playback markers. Campaigns, cases, attempts, retries, outcomes, concurrency, caps. All
  of section 5.
- **Verify:** 200 simultaneous simulated calls with no lost or duplicated answers; invariant
  tests for consent, hours and opt-out; then real calls to your own phone only.

### Phase 5 — Quality report and human review
- Answer-quality analysis for any scale; response rates; AAPOR disclosure document; review
  queue for low-confidence answers; audit viewer; retention job.
- **Verify:** unit tests; disclosure test asserting the AAPOR AI items (script, mode, AI
  task and human oversight) are present; retention test.

### Phase 6 — Pilot and portfolio
- 20–30 consented volunteers, half by web and half by voice on the same Qualtrics survey.
  Write-up, demo video, new README. Old app switched off. Optional: Qualtrics API adapter
  if a licence is available.

### Out of scope unless asked
Inbound calls, languages other than English, speech-to-speech models, calling outside the
US, AI-written follow-up questions, any rebuilt survey editor or dashboard.

## 7. Risks

| Risk | Why it matters | Handling |
|---|---|---|
| **US call law (TCPA)** | The FCC ruled in Feb 2024 that AI voices are "artificial voices"; calls need prior consent. Per-call damages. Whether oral consent is enough for survey calls to mobiles is *(unverified)*. | Consent gate; volunteers only; lawyer review before any call to a third party. |
| **Recording and transcription law** | About a dozen states need everyone's consent to record; live transcription by a vendor may count. | Consent before the first question; no consent, no interview. |
| **AI disclosure rules** | FCC proposal (2024) not final *(status unverified)*; California AB 2905 *(single source)*; EU duty in force since 2 Aug 2026. | Disclosure locked into the first sentence; US only. |
| **Calls flagged as spam** | Unregistered numbers get low answer rates. Carriers require identity or business verification. | Register the number; expect low contact rates in the pilot and report them. |
| **Free Qualtrics account may not import responses** | Could not be confirmed. | Phase 0 check. Fallback: university licence, or show the import on a short paid or trial plan. |
| **QSF is undocumented and can change** | Our reading of survey logic could diverge from Qualtrics. | Declared subset, refusal otherwise, comparison tests against Qualtrics' own exports. |
| **Imported responses may be billable**; import stamps "recorded date" as import time | Cost and timing fields. | Call start and end carried in their own fields; noted in the write-up. |
| **Mishearing** (accents, noise, weak lines) | Wrong answers recorded with confidence. | Keypad fallback, read-back for numbers, review queue, measured error rates published. |
| **Mode effects** | Voice answers can differ from web answers. | Measured in the pilot; reported, not hidden. |
| **Personal data at vendors** | Speech and transcripts pass through third parties. | Minimum data sent, retention limits, vendor terms checked at Phase 3. |
| **One server** | Live calls sit in one machine's memory. | Answers saved per question; a crash costs the call, not the data. Enough for a pilot. |
| **Cost** | Roughly $0.20–0.30 per 10-minute interview at Telnyx and Deepgram list prices (estimate, to be measured). | Per-campaign caps. |

## 8. Needed from you

Answered 10 Nov 2026:
- **Qualtrics:** free account only. The file-based path (D3) is the only path; the API
  adapter stays optional. Whether a free account can import responses is still the
  Phase 0 check.
- **Repo:** likely to be made public. So the leaked database password must be rotated
  before that happens, and no respondent data or archive may ever be committed.
- **Accounts:** Telnyx and Deepgram accounts exist.

Still open:
1. **Location:** are you and your pilot volunteers in the US? Everything above assumes yes.
2. **Old data (Phase 0):** run the archive (exact steps supplied), confirm the session
   count, rotate the database password.
3. **Qualtrics check (Phase 0):** the 20-minute test on a survey I specify.
4. **Keys, when each phase starts:** trial keys for the other voice models being compared
   (Cartesia, Fish Audio, ElevenLabs) at Phase 3; Telnyx key and number at Phase 4. Telnyx
   requires identity verification for outbound calling. Expected total spend for
   development and pilot: under about $50 (estimate).
5. **Before calling anyone but yourself:** a short lawyer review of the consent script, or
   ethics-board review if you are university-affiliated.

## 9. As a portfolio piece

- **Live demo:** the browser interviewer, with the audit trail beside it.
- **Three-minute video:** Qualtrics survey → readiness report → a real call → responses in
  Qualtrics → methodology disclosure.
- **Methods write-up:** web versus AI voice on the same instrument: response rate, breakoff,
  item nonresponse, response times, error rate against human review. Limits stated plainly.
- **A free tool for Qualtrics users:** the phone-readiness checker from Phase 1.
- **What it shows an employer:** Qualtrics fluency (survey logic, embedded data, contacts,
  import and export), standardized interviewing, AAPOR outcome codes and disclosure,
  consent and call-law awareness, measured rather than claimed quality.
