# Qualtrics fixtures

Only made-up answers belong here. Never a real respondent's data.

| File | What it is |
|---|---|
| `library-test.qsf` | The "Library test" survey, **written by hand** in Qualtrics' file format from the specification in [`../../docs/qualtrics-test-survey.md`](../../docs/qualtrics-test-survey.md). Qualtrics refused the first version (2026-11-11, "Something went wrong and the project wasn't created"); it was then brought into line with a genuine export (question count, where skip logic sits, ID lengths, scoring and statistics entries). The corrected file was then imported successfully into a Qualtrics free-trial account. |
| `library-test-real.qsf` | **A genuine Qualtrics export** (2026-11-11): the hand-written file after being imported into a Qualtrics free-trial account and exported again, under the name `verity_talk_test`. A test checks it reads to the same questionnaire. It carries that account's owner and brand IDs and a preview-link ID (identifiers, not credentials); consider blanking them before the repository is made public. |
| `import-probe.qsf` | Two plain questions and nothing else, **written by hand**. If Qualtrics refuses `library-test.qsf`, importing this one tells a problem with the file's outer shape from a problem with one question. |
| `library-test-expected-import.csv` | The response import file the writer must produce for the two specified test responses. Tests compare against it byte for byte. Not yet imported into a live account. |

Still to come from the Qualtrics check: `library-test-numeric.csv` (Qualtrics' own export of
the imported responses). The hand-written survey file stays as the fixture the tests and the
demo run on; the genuine export sits beside it as the proof.

The reader is also checked against genuine Qualtrics exports that are not committed
(third-party files): set `QSF_SAMPLES_DIR` to a folder of `.qsf` files and run `npm test`.
