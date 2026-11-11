/**
 * Labelled replies for measuring how well answers are read.
 *
 * Each entry is something a respondent might say to one question of the Library test survey,
 * with the reading(s) a careful human coder would accept. Several acceptable readings are listed
 * where coders could reasonably differ (for example a soft "I don't think so": "No", or probe).
 * Written by hand for this project; it is not a sample of real calls, and says so in every report.
 *
 * Expected readings: "c:<code>" an option, "n:<number>" a number, "text" an open answer,
 * "dk" don't know, "ref" declined, "yes"/"no" consent, "repeat", "optout", "stop", "callback",
 * "question", "unclear".
 */

export type Target = "consent" | "QID2" | "QID3" | "QID4" | "QID5" | "QID6" | "QID8" | "QID9";
export type Labelled = [utterance: string, ...expected: string[]];

export const DATASET: Record<Target, Labelled[]> = {
  // Do you agree to take part?
  consent: [
    ["yes", "yes"], ["Yes.", "yes"], ["Yeah sure", "yes"], ["okay", "yes"], ["sure, go ahead", "yes"], ["all right", "yes"], ["yes I agree", "yes"],
    ["go ahead", "yes"], ["sure", "yes"], ["yes but make it quick", "yes"], ["I guess so", "yes", "unclear"], ["fine", "yes", "unclear"], ["mm-hmm", "yes", "unclear"],
    ["no", "no"], ["no thank you", "no"], ["not interested", "no"], ["nope", "no"], ["I don't want to", "no"], ["absolutely not", "no"],
    ["I'm busy", "callback", "no", "unclear"], ["call me later", "callback"], ["not right now, try tomorrow", "callback"], ["this is not a good time", "callback"],
    ["take me off your list", "optout"], ["don't call me again", "optout"], ["stop calling this number", "optout"],
    ["who is this?", "question"], ["how long will it take?", "question"], ["is this a real person?", "question"], ["what's it about?", "question"],
    ["how did you get my number?", "question"], ["is this a scam?", "question"],
    ["what?", "repeat"], ["sorry, can you repeat that?", "repeat"], ["hello?", "unclear", "repeat"], ["stop", "stop"], ["um", "unclear"],
  ],
  // In the past 12 months, have you visited a public library? Yes=1 No=2
  QID2: [
    ["Yes", "c:1"], ["No", "c:2"], ["yes.", "c:1"], ["no", "c:2"], ["Yeah, I have", "c:1"], ["Yep", "c:1"], ["Yeah", "c:1"], ["Uh huh, a few times", "c:1"],
    ["I have, yes", "c:1"], ["Sure have", "c:1"], ["Oh yes, many times", "c:1"], ["yes yes", "c:1"], ["Yes I have visited a public library", "c:1"],
    ["Nope", "c:2"], ["No I haven't", "c:2"], ["Not in the past year, no", "c:2"], ["I haven't been in years", "c:2"], ["no no no", "c:2"], ["No, not really", "c:2"],
    ["I don't think so", "c:2", "unclear"], ["I went last week", "c:1", "unclear"], ["Maybe once, I'm not sure", "unclear", "c:1"], ["yeah no", "unclear", "c:2"],
    ["yes, no wait, no", "c:2"], ["no, actually yes, I did go once", "c:1"],
    ["yes and no", "unclear"], ["sometimes", "unclear"], ["mmm", "unclear"], ["yet", "unclear"], ["the what?", "repeat", "question"],
    ["Does the bookmobile count?", "question"], ["What do you mean by public library?", "question"], ["Like, a school library?", "question"],
    ["I don't know", "dk"], ["I can't remember", "dk"], ["I'd rather not say", "ref"], ["none of your business", "ref"], ["skip that one", "ref"],
    ["Sorry, what?", "repeat"], ["Can you say that again?", "repeat"], ["Take me off your list", "optout"], ["I have to go now", "stop"], ["Can you call back tomorrow?", "callback"],
  ],
  // How often did you visit...? 1 Once a week or more, 2 A few times a month, 3 About once a month, 4 A few times a year, 5 Only once
  QID3: [
    ["Once a week or more", "c:1"], ["A few times a month", "c:2"], ["About once a month", "c:3"], ["A few times a year", "c:4"], ["Only once", "c:5"],
    ["option three", "c:3"], ["the third one", "c:3"], ["number two", "c:2"], ["the last one", "c:5"], ["the first option", "c:1"], ["3", "c:3"],
    ["probably about once a month I'd say", "c:3"], ["every week", "c:1"], ["twice a week", "c:1"], ["I go every Saturday", "c:1"], ["weekly", "c:1"], ["once a week", "c:1"],
    ["every day", "c:1"], ["a couple of times a month", "c:2"], ["two or three times a month", "c:2"], ["once every two weeks", "c:2"], ["a few times a month, sometimes more", "c:2"],
    ["monthly", "c:3"], ["once a month or so", "c:3"], ["maybe three or four times a year", "c:4"], ["twice a year", "c:4"], ["every other month", "c:4"],
    ["just the once", "c:5"], ["only one time", "c:5"], ["I only went once", "c:5"], ["once", "c:5", "unclear"],
    ["somewhere between weekly and monthly", "unclear", "c:2"], ["less than once a month", "unclear", "c:4"], ["all the time", "unclear", "c:1"],
    ["it varies", "unclear"], ["pretty often", "unclear"], ["not very often", "unclear"], ["never", "unclear"], ["a few times", "unclear"], ["a lot", "unclear"],
    ["about once a month, no, more like a few times a year", "c:4"], ["a bout once a month", "c:3"], ["a few times a munth", "c:2"],
    ["I don't know", "dk"], ["no idea", "dk"], ["I'd rather not answer", "ref"],
    ["what were the options again?", "repeat"], ["can you repeat the options", "repeat"], ["what do you mean by visit?", "question"], ["does online count?", "question"],
    ["stop calling me", "optout"], ["I need to stop", "stop"],
  ],
  // The library staff are helpful. 1 Strongly disagree, 2 Somewhat disagree, 3 Neither agree nor disagree, 4 Somewhat agree, 5 Strongly agree
  QID4: [
    ["Strongly disagree", "c:1"], ["Somewhat disagree", "c:2"], ["Neither agree nor disagree", "c:3"], ["Somewhat agree", "c:4"], ["Strongly agree", "c:5"],
    ["I strongly agree", "c:5"], ["strongly agree with that", "c:5"], ["I agree strongly", "c:5"], ["somewhat agree I guess", "c:4"], ["I'd say somewhat agree", "c:4"], ["agree somewhat", "c:4"],
    ["neither", "c:3"], ["neither one", "c:3"], ["I somewhat disagree with that", "c:2"], ["I strongly disagree", "c:1"], ["disagree strongly", "c:1"], ["strongly disagree, they're rude", "c:1"],
    ["number four", "c:4"], ["the last one", "c:5"], ["5", "c:5"], ["strongly agree, no, somewhat agree", "c:4"],
    ["agree", "unclear"], ["disagree", "unclear"], ["strongly", "unclear"], ["somewhat", "unclear"], ["yes they are", "unclear"], ["they're great", "unclear"], ["they're okay", "unclear"],
    ["neutral", "c:3", "unclear"], ["in the middle", "c:3", "unclear"], ["totally agree", "c:5", "unclear"], ["kind of agree", "c:4", "unclear"],
    ["I don't know, I never talk to them", "dk"], ["not sure", "dk"], ["no opinion", "dk", "c:3", "unclear"], ["pass", "ref"],
    ["sorry can you repeat the statement", "repeat"], ["what are the choices", "repeat"], ["helpful how?", "question"],
  ],
  // How likely are you to recommend...? 0–10
  QID5: [
    ["8", "c:8"], ["eight", "c:8"], ["ten", "c:10"], ["zero", "c:0"], ["a ten", "c:10"], ["I'd say seven", "c:7"], ["probably a nine", "c:9"], ["about a six", "c:6"],
    ["five", "c:5"], ["ten out of ten", "c:10"], ["nine, definitely", "c:9"], ["I'd give it a 3", "c:3"], ["one", "c:1"], ["two", "c:2"], ["four", "c:4"], ["10", "c:10"], ["0", "c:0"],
    ["number 6", "c:6"], ["likely a seven", "c:7"], ["seven, no eight", "c:8"],
    ["seven or eight", "unclear"], ["maybe a 6 or a 7", "unclear"], ["very likely", "unclear"], ["eleven", "unclear"], ["a hundred percent", "unclear"], ["eight and a half", "unclear"],
    ["high", "unclear"], ["minus one", "unclear"], ["to", "unclear"], ["ate", "unclear", "c:8"], ["extremely likely", "unclear", "c:10"], ["not at all likely", "unclear", "c:0"],
    ["I don't know", "dk"], ["what does zero mean again?", "repeat", "question"], ["say again", "repeat"], ["I'd rather not say", "ref"],
  ],
  // How many books did you read in the past 12 months? whole number 0–500
  QID6: [
    ["12", "n:12"], ["twelve", "n:12"], ["a dozen", "n:12"], ["zero", "n:0"], ["none", "n:0"], ["I didn't read any", "n:0"], ["0", "n:0"], ["about twenty", "n:20"], ["twenty five", "n:25"],
    ["one", "n:1"], ["just one", "n:1"], ["fifty", "n:50"], ["one hundred", "n:100"], ["a hundred and twenty", "n:120"], ["three", "n:3"], ["I read 4 books", "n:4"], ["probably thirty", "n:30"],
    ["five, no, six", "n:6"], ["half a dozen", "n:6"], ["one a month so twelve", "n:12"], ["fifteen", "n:15"], ["7", "n:7"], ["around 40", "n:40"],
    ["maybe ten", "n:10", "unclear"], ["a couple", "unclear", "n:2"], ["ten to fifteen", "unclear"], ["a few", "unclear"], ["a lot", "unclear"], ["two or three", "unclear"],
    ["six hundred", "unclear"], ["more than fifty", "unclear"], ["at least ten", "unclear"], ["not many", "unclear"], ["too many to count", "unclear", "dk"],
    ["I don't know", "dk"], ["I couldn't tell you", "dk"], ["I'd rather not say", "ref"], ["what counts as a book?", "question"], ["do audiobooks count?", "question"], ["repeat that please", "repeat"],
  ],
  // What one change would most improve your local public library? (open)
  QID8: [
    ["longer opening hours", "text"], ["more parking", "text"], ["um, maybe better wifi and more computers", "text"], ["more books for kids", "text"], ["they should open on Sundays", "text"],
    ["nothing", "text"], ["nothing really, it's fine as is", "text"], ["a bigger building I suppose", "text"], ["friendlier staff", "text"],
    ["I don't know", "dk"], ["I'd rather not say", "ref"], ["pass", "ref"], ["no comment", "ref", "text"],
    ["can you repeat the question", "repeat"], ["what do you mean by change?", "question"], ["remove me from your list", "optout"], ["I have to go", "stop"],
    ["hmm", "unclear"], ["uh", "unclear"], ["um", "unclear"],
  ],
  // Overall, how would you rate...? 1 Excellent, 2 Good, 3 Fair, 4 Poor, 5 Don't know
  QID9: [
    ["Excellent", "c:1"], ["Good", "c:2"], ["Fair", "c:3"], ["Poor", "c:4"], ["Don't know", "c:5"], ["I don't know", "c:5", "dk"],
    ["it's excellent", "c:1"], ["excellent, really excellent", "c:1"], ["pretty good", "c:2"], ["good I guess", "c:2"], ["good, not excellent", "c:2"], ["I'd say fair", "c:3"], ["poor, honestly", "c:4"],
    ["second one", "c:2"], ["number 4", "c:4"],
    ["very good", "unclear", "c:2"], ["terrible", "unclear", "c:4"], ["great", "unclear", "c:1"], ["average", "unclear", "c:3"],
    ["okay", "unclear"], ["it's fine", "unclear"], ["not good", "unclear"], ["fair to poor", "unclear"], ["somewhere between good and fair", "unclear"], ["eight out of ten", "unclear"], ["four stars", "unclear"],
    ["no idea", "dk", "c:5"], ["haven't been there enough to say", "dk", "c:5"], ["I'd rather not say", "ref"], ["what were the choices?", "repeat"], ["rate what exactly?", "question", "repeat"],
  ],
};

export function datasetSize(): number {
  return Object.values(DATASET).reduce((n, rows) => n + rows.length, 0);
}
