# Sample calls

Three simulated calls on the Library test survey, produced by the real interviewer code with
scripted respondents typing in place of speech. A stand-in replaces the language model, with
fixed readings for two replies. This file is generated; a test fails if it goes out of date.

What to look for: the AI disclosure and consent come first; questions are word for word; the
interviewer never comments on an answer; an unsure reading is probed, not guessed; a refusal is
accepted at once; "remove me" ends the call immediately.

## Call 1 — an everyday respondent

Outcome: **complete**. Answers recorded: 10. Flagged for human review: QID9.

### Transcript

- **Interviewer:** Hello. This is a call from the Library Study. I am an automated AI interviewer, not a person.
- **Interviewer:** I am calling with a short survey about your local public library. It takes about 3 minutes.
- **Interviewer:** Taking part is voluntary. This call is transcribed by automated services so that your answers can be recorded.
- **Interviewer:** You can stop at any time by saying stop. To be removed from our call list, say remove me.
- **Interviewer:** Do you agree to take part?
- **Respondent:** yes
- **Interviewer:** Thank you. Here is the first question.
- **Interviewer:** Thank you for taking part. This short survey is about your local public library.
- **Interviewer:** In the past 12 months, have you visited a public library?
- **Respondent:** Yes
- **Interviewer:** How often did you visit a public library in the past 12 months?
- **Interviewer:** The answer options are: Once a week or more; A few times a month; About once a month; A few times a year; or Only once.
- **Respondent:** probably about once a month I'd say
- **Interviewer:** How much do you agree or disagree with each statement?
- **Interviewer:** For each one, the answer options are: Strongly disagree; Somewhat disagree; Neither agree nor disagree; Somewhat agree; or Strongly agree.
- **Interviewer:** The library staff are helpful.
- **Respondent:** Somewhat agree
- **Interviewer:** The opening hours suit me.
- **Respondent:** sorry, can you repeat that?
- **Interviewer:** Let me repeat the question.
- **Interviewer:** How much do you agree or disagree with each statement?
- **Interviewer:** For each one, the answer options are: Strongly disagree; Somewhat disagree; Neither agree nor disagree; Somewhat agree; or Strongly agree.
- **Interviewer:** The opening hours suit me.
- **Respondent:** Neither agree nor disagree
- **Interviewer:** The library is easy to get to.
- **Respondent:** Strongly agree
- **Interviewer:** How likely are you to recommend your local public library to a friend or neighbor?
- **Interviewer:** Please answer with a number from 0 to 10, where 0 means Not at all likely and 10 means Extremely likely.
- **Respondent:** 8
- **Interviewer:** How many books did you read in the past 12 months?
- **Respondent:** I'd rather not say
- **Interviewer:** Let us move on.
- **Interviewer:** Would you be willing to answer two more questions?
- **Respondent:** yes
- **Interviewer:** What one change would most improve your local public library?
- **Respondent:** Longer weekend hours
- **Interviewer:** Overall, how would you rate your local public library?
- **Interviewer:** The answer options are: Excellent; Good; Fair; Poor; or Don't know.
- **Respondent:** oh, it's fine I suppose
- **Interviewer:** Which of the answer options comes closest?
- **Interviewer:** The answer options are: Excellent; Good; Fair; Poor; or Don't know.
- **Respondent:** oh, it's fine I suppose
- **Interviewer:** Which of the answer options comes closest?
- **Interviewer:** The answer options are: Excellent; Good; Fair; Poor; or Don't know.
- **Respondent:** oh, it's fine I suppose
- **Interviewer:** Those are all the questions. Thank you for your time. Goodbye.

### How each answer was reached

| Question | Respondent said | Read as | Decided by | Confidence | Decision |
|---|---|---|---|---|---|
| QID2 | Yes | Yes | rule | 1.00 | answer accepted (rule, confidence 1.00) |
| QID3 | probably about once a month I'd say | About once a month | model | 0.93 | answer accepted (model, confidence 0.93) |
| QID4#1 | Somewhat agree | Somewhat agree | rule | 1.00 | answer accepted (rule, confidence 1.00) |
| QID4#2 | sorry, can you repeat that? | repeat | rule | 1.00 | question repeated on request |
| QID4#2 | Neither agree nor disagree | Neither agree nor disagree | rule | 1.00 | answer accepted (rule, confidence 1.00) |
| QID4#3 | Strongly agree | Strongly agree | rule | 1.00 | answer accepted (rule, confidence 1.00) |
| QID5 | 8 | 8 | rule | 1.00 | answer accepted (rule, confidence 1.00) |
| QID6 | I'd rather not say | (declined) | rule | 1.00 | declined to answer |
| QID7 | yes | Yes | rule | 1.00 | answer accepted (rule, confidence 1.00) |
| QID8 | Longer weekend hours | "Longer weekend hours" | rule | 1.00 | answer accepted (rule, confidence 1.00) |
| QID9 | oh, it's fine I suppose | answer | model | 0.62 | answer not certain (confidence 0.62); asked for the closest option |
| QID9 | oh, it's fine I suppose | answer | model | 0.62 | answer not certain (confidence 0.62); asked for the closest option |
| QID9 | oh, it's fine I suppose | Fair | model | 0.62 | best available answer after probes (confidence 0.62); flagged for human review |

## Call 2 — declines to take part

Outcome: **consent_declined**. Answers recorded: 0. Flagged for human review: none.

### Transcript

- **Interviewer:** Hello. This is a call from the Library Study. I am an automated AI interviewer, not a person.
- **Interviewer:** I am calling with a short survey about your local public library. It takes about 3 minutes.
- **Interviewer:** Taking part is voluntary. This call is transcribed by automated services so that your answers can be recorded.
- **Interviewer:** You can stop at any time by saying stop. To be removed from our call list, say remove me.
- **Interviewer:** Do you agree to take part?
- **Respondent:** no thank you
- **Interviewer:** That is fine. Thank you for your time. Goodbye.

### How each answer was reached

| Question | Respondent said | Read as | Decided by | Confidence | Decision |
|---|---|---|---|---|---|

## Call 3 — asks to be removed part-way through

Outcome: **opt_out**. Answers recorded: 5. Flagged for human review: none.

### Transcript

- **Interviewer:** Hello. This is a call from the Library Study. I am an automated AI interviewer, not a person.
- **Interviewer:** I am calling with a short survey about your local public library. It takes about 3 minutes.
- **Interviewer:** Taking part is voluntary. This call is transcribed by automated services so that your answers can be recorded.
- **Interviewer:** You can stop at any time by saying stop. To be removed from our call list, say remove me.
- **Interviewer:** Do you agree to take part?
- **Respondent:** yes
- **Interviewer:** Thank you. Here is the first question.
- **Interviewer:** Thank you for taking part. This short survey is about your local public library.
- **Interviewer:** In the past 12 months, have you visited a public library?
- **Respondent:** Yes
- **Interviewer:** How often did you visit a public library in the past 12 months?
- **Interviewer:** The answer options are: Once a week or more; A few times a month; About once a month; A few times a year; or Only once.
- **Respondent:** About once a month
- **Interviewer:** How much do you agree or disagree with each statement?
- **Interviewer:** For each one, the answer options are: Strongly disagree; Somewhat disagree; Neither agree nor disagree; Somewhat agree; or Strongly agree.
- **Interviewer:** The library staff are helpful.
- **Respondent:** Somewhat agree
- **Interviewer:** The opening hours suit me.
- **Respondent:** Neither agree nor disagree
- **Interviewer:** The library is easy to get to.
- **Respondent:** Strongly agree
- **Interviewer:** How likely are you to recommend your local public library to a friend or neighbor?
- **Interviewer:** Please answer with a number from 0 to 10, where 0 means Not at all likely and 10 means Extremely likely.
- **Respondent:** please take me off your list
- **Interviewer:** You have been removed from our call list and will not be called again. Goodbye.

### How each answer was reached

| Question | Respondent said | Read as | Decided by | Confidence | Decision |
|---|---|---|---|---|---|
| QID2 | Yes | Yes | rule | 1.00 | answer accepted (rule, confidence 1.00) |
| QID3 | About once a month | About once a month | rule | 1.00 | answer accepted (rule, confidence 1.00) |
| QID4#1 | Somewhat agree | Somewhat agree | rule | 1.00 | answer accepted (rule, confidence 1.00) |
| QID4#2 | Neither agree nor disagree | Neither agree nor disagree | rule | 1.00 | answer accepted (rule, confidence 1.00) |
| QID4#3 | Strongly agree | Strongly agree | rule | 1.00 | answer accepted (rule, confidence 1.00) |
| QID5 | please take me off your list | opt_out | rule | 1.00 | opt_out: respondent asked to be removed from the list |
