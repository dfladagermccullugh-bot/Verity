# Library pilot (simulated): field report

Survey: **Library test** (8 questions). Mode: AI voice interviewer, simulated.
Field period: 2026-11-16 to 2026-11-18. Calls placed: 69. Call time: 107 minutes.

## 1. What happened to each case

Sample: 58 people with consent on file. 2 contacts had no valid consent on file and were never called; they are not part of the sample.

| AAPOR code | Final disposition | Cases |
|---|---|---|
| 1.1 | Complete | 42 |
| 1.2 | Partial | 3 |
| 2.11 | Refusal | 8 |
| 3.2151 | Always busy (Phone) | 5 |

Calls per case: mean 1.19, most 2. Removed from the call list at their own request: 3.

## 2. Outcome rates

Calculated with the formulas in AAPOR *Standard Definitions* (10th edition, 2023). Everyone sampled had asked to be called, so all are counted as eligible (e = 1) and people never reached count against the rates.

| Rate | Value | Meaning |
|---|---|---|
| RR1 | 72.4% | Response rate, completes only |
| RR2 | 77.6% | Response rate, completes and partials |
| COOP1 | 79.2% | Cooperation rate, completes only, among those reached |
| REF1 | 13.8% | Refusal rate |
| CON1 | 91.4% | Contact rate |

These describe how many of the people on the list took part. They are not the response rate of a probability sample, and no margin of sampling error applies.

## 3. Answer quality

Based on 48 interviews, 45 of them finished.

These are screening signals, not proof of poor data: each has ordinary explanations, so a high figure is a reason to look at the interviews, not to discard them.

| Signal | Result | How it is counted |
|---|---|---|
| Questions asked that got no answer (item nonresponse) | 20 of 419 (5%) | Don't know 13, declined 5, no usable answer 2. Questions the survey logic skipped are not counted. |
| Grids given the same answer on every line (straightlining) | 6 of 35 (17%) | Grids of 3 or more statements with every statement answered. |
| Longest run of one answer | 3 in a row | Consecutive questions that share the same answer scale. |
| Interviews that agree with nearly everything (acquiescence) | none to count | 80% or more "agree" answers over at least 5 agree/disagree questions. Across all interviews, 38% of such answers were "agree". |
| Answers at either end of a scale (extreme responding) | 68 of 156 (44%) | Ordered scales with 4 or more points. |
| Time taken to start answering (response latency) | median 1280 ms, mean 1346 ms | Timed for 411 of 419 questions asked. 0 began less than 200 ms after the question ended. |
| Interviews not finished (break-offs) | 3 of 48 (6%) | Interviews that ended before the last question. They stopped, on average, 50% of the way through the questions that applied. |
| Answers flagged for a person to check | 10 of 419 (2%) | Answers the interviewer was not sure it had understood. |

### By question

Each statement of a grid counts as one question.

| Question | Times asked | Don't know | Declined | No usable answer | No answer, share | Median time to answer |
|---|---|---|---|---|---|---|
| Q2 | 48 | 0 | 0 | 0 | 0% | 1250 ms |
| Q3 | 39 | 1 | 1 | 1 | 8% | 1280 ms |
| Q4 | 117 | 1 | 3 | 1 | 4% | 1329 ms |
| Q5 | 45 | 0 | 1 | 0 | 2% | 1204 ms |
| Q6 | 45 | 0 | 0 | 0 | 0% | 1268 ms |
| Q7 | 45 | 0 | 0 | 0 | 0% | 1196 ms |
| Q8 | 40 | 0 | 0 | 0 | 0% | 1198 ms |
| Q9 | 40 | 11 | 0 | 0 | 28% | 1558 ms |

Unfinished interviews stopped: 3 after Q4.


## 4. For a person to check

10 answers in 9 interviews were flagged: the reading was uncertain after probing, no usable answer was given, or the respondent answered before hearing the whole question. Each has a full audit trail.

| Case | Flagged questions |
|---|---|
| R_004 | QID4#3 |
| R_009 | QID4#2 |
| R_010 | QID9 |
| R_014 | QID3 |
| R_019 | QID6 |
| R_022 | QID3 |
| R_026 | QID3, QID4#3 |
| R_036 | QID4#2 |
| R_038 | QID3 |

## 5. Methodology disclosure

Follows the AAPOR Transparency Initiative's disclosure items, including those that apply when AI conducts interviews: the script and instructions used, the mode, the tasks the AI performed, and how people oversaw them.

- **Who conducted the study:** Verity Voice (demonstration).
- **Population and recruitment:** No real people were called. The respondents are scripted stand-ins of several kinds (cooperative, hesitant, declining, dropping the call, never answering), each fixed by a seed. This is a list of volunteers, not a probability sample; results describe these respondents only.
- **Mode:** telephone interview conducted by an AI voice assistant (simulated), in English.
- **Questionnaire:** built in Qualtrics and read by this system from its survey file. Question and answer wording was spoken exactly as written. The complete list of everything the interviewer could say is fixed in advance and identified by script version `6b36fdf1d460` (16 survey lines, 20 call-handling lines).
- **What respondents were told first:** "Hello. This is a call from the Library Study. I am an automated AI interviewer, not a person. I am calling with a short survey about your local public library. It takes about 3 minutes. Taking part is voluntary. This call is transcribed by automated services so that your answers can be recorded. You can stop at any time by saying stop. To be removed from our call list, say remove me." They were then asked: "Do you agree to take part?" No question was asked without a clear yes.
- **Tasks performed by AI:**
  - *Speaking.* A synthetic voice (none (simulated; no audio was produced)) read the fixed script. Each line was rendered once and replayed, so every respondent heard the same recording. The AI did not compose, reword or add anything. The interviewer identified itself as AI in its first sentence ("I am an automated AI interviewer, not a person.").
  - *Listening.* Speech was transcribed by none (simulated; replies are text).
  - *Coding answers.* Fixed rules coded replies that exactly matched an option, a number or a keypad press. No language model was used; replies the rules could not code were probed.
  - *Probing.* When a reply was unclear or uncertain (confidence below 0.85), the interviewer used one of a fixed set of neutral probes, at most 2 per question, then coded the question as not answered. It never explained a question and never commented on an answer.
- **Human oversight:** every line spoken, every transcript, every reading and every decision is kept in an append-only log. 10 answers were flagged for a person to check (section 4). Open-ended answers are the respondent's own transcribed words, not a summary.
- **Contact rules:** calls only to people with consent on file no older than 90 days; 9:00 to 20:00 in the respondent's local time; at most 4 calls per person; no messages left on answering machines; a request to be removed was honoured immediately and permanently.
- **Recording:** no audio was kept. Transcripts were kept.
- **Limitations:** speech recognition makes errors, more so with accents, noise and weak lines; answers by voice can differ from answers on screen (mode effects); the measures in section 3 are screening signals, not proof of good or poor data.
