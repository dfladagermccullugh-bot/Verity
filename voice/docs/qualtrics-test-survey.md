# Qualtrics test survey — build, answer, export, import

Purpose: give Verity Voice real Qualtrics files to build against, and find out what a free
account allows. About 20 minutes. All answers are made up, so the files are safe to share.

Menu names are from Qualtrics' help pages and may differ slightly on your screen. If a step
does not match what you see, note what you saw and carry on.

## 1. Build the survey

Create a new blank survey named **Library test**.

### Block 1 — rename it "Main"

| # | Question type | Question text | Answer options | Extra setting |
|---|---|---|---|---|
| Q1 | Text / Graphic | Thank you for taking part. This short survey is about your local public library. | — | — |
| Q2 | Multiple choice, single answer | In the past 12 months, have you visited a public library? | Yes · No | — |
| Q3 | Multiple choice, single answer | How often did you visit a public library in the past 12 months? | Once a week or more · A few times a month · About once a month · A few times a year · Only once | **Display logic:** show only if Q2 is "Yes" |
| Q4 | Matrix table, Likert, single answer | How much do you agree or disagree with each statement? | Statements: The library staff are helpful. · The opening hours suit me. · The library is easy to get to. Scale: Strongly disagree · Somewhat disagree · Neither agree nor disagree · Somewhat agree · Strongly agree | **Display logic:** show only if Q2 is "Yes" |
| Q5 | Net Promoter Score | How likely are you to recommend your local public library to a friend or neighbor? | 0 to 10 (built in) | — |
| Q6 | Text entry, single line | How many books did you read in the past 12 months? | — | **Validation:** content type Number, minimum 0, maximum 500 |

### Block 2 — add a new block, name it "Extra"

| # | Question type | Question text | Answer options | Extra setting |
|---|---|---|---|---|
| Q7 | Multiple choice, single answer | Would you be willing to answer two more questions? | Yes · No | **Skip logic:** if "No" is selected, skip to End of Survey |
| Q8 | Text entry, multi-line | What one change would most improve your local public library? | — | — |
| Q9 | Multiple choice, single answer | Overall, how would you rate your local public library? | Excellent · Good · Fair · Poor · Don't know | — |

### Embedded data

Open **Survey flow**. Add an **Embedded Data** element, move it to the top, and add two
fields with no value set: `vv_mode` and `vv_case_id`. Apply.

Type the wording exactly as written. Verity Voice reads questions word for word, so the
fixtures should match this page.

## 2. Export the survey file

Survey tab → **Tools** → **Import/Export** → **Export survey**. A `.qsf` file downloads.
Rename it `library-test.qsf`.

## 3. Answer it twice

Publish the survey, then use **Preview** (or the anonymous link) and submit these two
responses exactly.

**Response A**

| Question | Answer |
|---|---|
| Q2 | Yes |
| Q3 | About once a month |
| Q4 staff are helpful | Somewhat agree |
| Q4 opening hours | Neither agree nor disagree |
| Q4 easy to get to | Strongly agree |
| Q5 | 8 |
| Q6 | 12 |
| Q7 | Yes |
| Q8 | Longer weekend hours |
| Q9 | Good |

**Response B**

| Question | Answer |
|---|---|
| Q2 | No (Q3 and Q4 should not appear) |
| Q5 | 3 |
| Q6 | 0 |
| Q7 | No (the survey should end) |

## 4. Export the responses

**Data & Analysis** → **Export & Import** → **Export data** → **CSV**. Download twice:

1. with **Use numeric values** selected → rename `library-test-numeric.csv`
2. with **Use choice text** selected → rename `library-test-labels.csv`

If you do not see both responses, check whether preview responses are being filtered out,
and note it.

## 5. Try an import

**Data & Analysis** → **Export & Import** → **Import data**.

1. If the window offers an example or template file, download it and rename it
   `import-template.csv`.
2. Upload `library-test-numeric.csv` unchanged and follow the prompts.
3. Note the result: did two new responses appear? Was there an error or a message about
   your account type? A screenshot of any message is ideal.

This is the main unknown. If a free account cannot import, the plan has a fallback.

## 6. Look for contacts

In the main left-hand menu, look for **Contacts** or **Directories**. Note only whether it
exists and whether it lets you create a list. Free accounts reportedly have none.

## 7. Send back

Attach in the chat:

- `library-test.qsf`
- `library-test-numeric.csv`
- `library-test-labels.csv`
- `import-template.csv`, if there was one
- your notes for steps 4, 5 and 6, with any screenshots

They go into `voice/fixtures/qualtrics/` and become the test files for Phase 1.
