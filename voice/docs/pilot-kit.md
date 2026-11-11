# Pilot kit: web versus AI voice on the same Qualtrics survey

A small study that produces the portfolio write-up. About 20 to 30 volunteers, randomly split
between answering on the web and answering by AI voice call. Not legal advice; see step I in
[`what-needs-you.md`](what-needs-you.md) before calling anyone.

## 1. The question

Do answers, drop-outs and data quality differ between the two modes on the same instrument,
and how often does the AI interviewer record an answer a human listener would code differently?

## 2. Sign-up form (a second Qualtrics survey)

Volunteers sign up on a web form; their record is the proof of consent. Fields:

| Field | Type | Note |
|---|---|---|
| First name | Text | For your records only; never spoken on the call |
| Mobile number | Text, US phone validation | |
| State | Dropdown, US states | Sets the hours they may be called |
| Consent | Single checkbox, required | Wording below, shown in full |

Consent wording (starting point for legal review, to be shown exactly as agreed):

> I agree to receive up to 4 phone calls at the number above from [study name], for one short
> survey about [topic]. The calls are made by an automated AI interviewer, not a person. The
> calls are transcribed by automated services. I can stop at any time by saying "stop", and
> be removed by saying "remove me". Taking part is voluntary.

Export the sign-ups as CSV and rename the columns to those the contact reader expects:
`phone`, `state`, `external_ref` (the Qualtrics ResponseId), `consent_source` (for example
"Qualtrics sign-up, response R_…"), `consent_at` (the recorded date), `consent_method`
(`web_form`), `consent_scope` (the consent wording). A row without all four consent columns
can never be called.

## 3. Assignment

Randomly assign each volunteer to web or voice before any contact. Web: send the ordinary
Qualtrics link. Voice: put them in the campaign. Keep the list of who was assigned to what,
including people who never responded.

## 4. Fielding

- Voice: one campaign, default rules (9am to 8pm local time, at most 4 calls, no voicemail).
- Web: one invitation and one reminder, sent on the same days.
- Same field period for both.

## 5. What to report

| Measure | Web | Voice | Source |
|---|---|---|---|
| Assigned | | | your assignment list |
| Completed, partial, refused, not reached | | | Qualtrics; campaign report section 1 |
| Response and cooperation rates | | | campaign report section 2; same formulas for web |
| Break-offs and where they happened | | | Qualtrics; report section 3 |
| Item nonresponse, by question | | | both |
| Straightlining on the grid | | | both |
| Answer distributions on each question | | | Qualtrics, split by the `vv_mode` field |
| Time to complete | | | both |
| Coding accuracy | n/a | | below |

**Coding accuracy.** For every voice interview (or a random half if there are many), listen
or read the transcript in the audit trail and code each answer yourself, without looking at
what was recorded. Report: answers where you agree; answers the interviewer recorded that
you would code differently (the serious error); answers it probed or left blank that you
could have coded (the cost of caution). `answers-to-check.md` lists the ones the system
itself was unsure about; check whether its doubts were the right ones.

## 6. What not to claim

- With 20 to 30 volunteers no difference between modes can be called significant; report
  counts and say so.
- Volunteers who signed up for a study about AI calls are not the public.
- One survey, one voice, one recogniser, English only.

## 7. Write-up outline

1. What was built, in one paragraph, and the one design rule: the AI never composes speech.
2. Method: sign-up, assignment, fielding, the disclosure text from the campaign report.
3. Results: the table above.
4. Coding accuracy, with two or three audit-trail excerpts, including one it got wrong.
5. What respondents did that the design did not expect.
6. Limits, and what a larger study would need.
