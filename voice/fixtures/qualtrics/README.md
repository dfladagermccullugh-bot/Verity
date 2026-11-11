# Qualtrics fixtures

Only made-up answers belong here. Never a real respondent's data.

| File | What it is |
|---|---|
| `library-test.qsf` | The "Library test" survey, **written by hand** in Qualtrics' file format from the specification in [`../../docs/qualtrics-test-survey.md`](../../docs/qualtrics-test-survey.md). Qualtrics refused the first version (2026-11-11, "Something went wrong and the project wasn't created"); it was then brought into line with a genuine export (question count, where skip logic sits, ID lengths, scoring and statistics entries). Not yet accepted by Qualtrics. |
| `import-probe.qsf` | Two plain questions and nothing else, **written by hand**. If Qualtrics refuses `library-test.qsf`, importing this one tells a problem with the file's outer shape from a problem with one question. |
| `library-test-expected-import.csv` | The response import file the writer must produce for the two specified test responses. Tests compare against it byte for byte. Not yet imported into a live account. |

To come from the Qualtrics check: `library-test-real.qsf` (a genuine export, which then
replaces the hand-written file) and `library-test-numeric.csv` (Qualtrics' own export of
the imported responses).

The reader is also checked against genuine Qualtrics exports that are not committed
(third-party files): set `QSF_SAMPLES_DIR` to a folder of `.qsf` files and run `npm test`.
