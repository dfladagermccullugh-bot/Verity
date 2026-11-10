# Qualtrics test survey — the one check that needs a Qualtrics login

Nothing in the build is waiting on this. It answers one open question — can a free
Qualtrics account import responses? — and replaces a hand-written test file with a real
export. About 10 minutes, whenever convenient. All answers are made up.

Menu names are from Qualtrics' help pages and may differ slightly on your screen.

## Quick route (10 minutes)

1. **Import the survey.** In Qualtrics: create a new survey project and choose to import
   from a file. Pick `voice/fixtures/qualtrics/library-test.qsf` (download it from GitHub
   first). This file was written by hand in Qualtrics' format, so the import itself is a
   test: if Qualtrics rejects it, note the message and use the manual route below instead.
2. **Export it back.** Survey tab → **Tools** → **Import/Export** → **Export survey**.
   Rename the download `library-test-real.qsf`.
3. **Import responses.** Publish the survey. Then **Data & Analysis** → **Export & Import**
   → **Import data**, and upload `voice/fixtures/qualtrics/library-test-expected-import.csv`.
   Two responses should appear. Note any error or any message about your account type.
4. **Export responses.** **Data & Analysis** → **Export & Import** → **Export data** → CSV,
   with **Use numeric values**. Rename it `library-test-numeric.csv`.
5. **Send back** in the chat: the two files from steps 2 and 4, and what happened in
   steps 1 and 3 (a screenshot of any message is ideal).

If step 3 fails on a free account, the plan's fallback applies (a university licence or
a short paid plan for the demonstration); the rest of the product is unaffected.

## Manual route (only if the quick route's step 1 fails)

Build the survey by hand from the specification below, then continue from step 2 above.

### Specification

Create a new blank survey named **Library test**.

#### Block 1 — rename it "Main"

| # | Question type | Question text | Answer options | Extra setting |
|---|---|---|---|---|
| Q1 | Text / Graphic | Thank you for taking part. This short survey is about your local public library. | — | — |
| Q2 | Multiple choice, single answer | In the past 12 months, have you visited a public library? | Yes · No | — |
| Q3 | Multiple choice, single answer | How often did you visit a public library in the past 12 months? | Once a week or more · A few times a month · About once a month · A few times a year · Only once | **Display logic:** show only if Q2 is "Yes" |
| Q4 | Matrix table, Likert, single answer | How much do you agree or disagree with each statement? | Statements: The library staff are helpful. · The opening hours suit me. · The library is easy to get to. Scale: Strongly disagree · Somewhat disagree · Neither agree nor disagree · Somewhat agree · Strongly agree | **Display logic:** show only if Q2 is "Yes" |
| Q5 | Net Promoter Score | How likely are you to recommend your local public library to a friend or neighbor? | 0 to 10 (built in) | — |
| Q6 | Text entry, single line | How many books did you read in the past 12 months? | — | **Validation:** content type Number, minimum 0, maximum 500 |

#### Block 2 — add a new block, name it "Extra"

| # | Question type | Question text | Answer options | Extra setting |
|---|---|---|---|---|
| Q7 | Multiple choice, single answer | Would you be willing to answer two more questions? | Yes · No | **Skip logic:** if "No" is selected, skip to End of Survey |
| Q8 | Text entry, multi-line | What one change would most improve your local public library? | — | — |
| Q9 | Multiple choice, single answer | Overall, how would you rate your local public library? | Excellent · Good · Fair · Poor · Don't know | — |

#### Embedded data

Open **Survey flow**. Add an **Embedded Data** element, move it to the top, and add two
fields with no value set: `vv_mode` and `vv_case_id`. Apply.

Type the wording exactly as written; the test files expect it word for word.

The two made-up responses in the import file are: A — Yes; About once a month; Somewhat
agree / Neither agree nor disagree / Strongly agree; 8; 12; Yes; "Longer weekend hours";
Good. B — No; 3; 0; No (Q3, Q4, Q8 and Q9 are never asked).
