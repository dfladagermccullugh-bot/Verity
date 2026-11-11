import { describe, expect, it } from "vitest";
import type { Answer, Instrument } from "../src/instrument/types.js";
import { readQsf } from "../src/qualtrics/qsf.js";
import { SPOKEN_TOO_FAST_MS, analyzeInterview, analyzeQuality, applicableSlots, completionShare, renderQualityMarkdown, type InterviewRecord } from "../src/quality/analysis.js";
import { RESPONSE_A, RESPONSE_B, choice, library, question, run, survey } from "./helpers.js";

const interview = (answers: Record<string, Answer>, over: Partial<InterviewRecord> = {}): InterviewRecord => ({ answers, review: [], finished: true, ...over });
const firstAnswers = (answers: Record<string, Answer>, n: number) => Object.fromEntries(Object.entries(answers).slice(0, n));
const none = (reason: "dont_know" | "refused" | "no_answer"): Answer => ({ kind: "nonresponse", reason });

function instrumentOf(questions: Record<string, unknown>[]): Instrument {
  const r = readQsf(survey(questions));
  if (!r.instrument) throw new Error(`synthetic survey refused: ${JSON.stringify(r.findings)}`);
  return r.instrument;
}

const AGREE = {
  Choices: { "1": { Display: "Strongly disagree" }, "2": { Display: "Disagree" }, "3": { Display: "Neither agree nor disagree" }, "4": { Display: "Agree" }, "5": { Display: "Strongly agree" } },
  ChoiceOrder: [1, 2, 3, 4, 5],
};

/** Six agree/disagree questions, a yes/no question, then one more agree/disagree question. */
function attitudes(): Instrument {
  return instrumentOf([...[1, 2, 3, 4, 5, 6].map((n) => question(`QID${n}`, AGREE)), question("QID7"), question("QID8", AGREE)]);
}

function grid(qid: string, rows: number): Record<string, unknown> {
  const statements = Object.fromEntries(Array.from({ length: rows }, (_, i) => [String(i + 1), { Display: `Statement ${i + 1}` }]));
  return question(qid, { QuestionType: "Matrix", Selector: "Likert", SubSelector: "SingleAnswer", Choices: statements, ChoiceOrder: Object.keys(statements).map(Number), Answers: AGREE.Choices, AnswerOrder: AGREE.ChoiceOrder });
}

const answersOf = (codes: Record<string, string>): Record<string, Answer> => Object.fromEntries(Object.entries(codes).map(([k, c]) => [k, choice(c)]));

describe("item nonresponse", () => {
  const inst = library();

  it("is zero for a fully answered interview", () => {
    const q = analyzeInterview(inst, interview(RESPONSE_A));
    expect(q.nonresponse).toEqual({ asked: 10, dontKnow: 0, refused: 0, noAnswer: 0, total: 0, rate: 0 });
  });

  it("counts only questions that were asked: skipped ones are not missing", () => {
    const q = analyzeInterview(inst, interview(RESPONSE_B));
    expect(q.nonresponse.asked).toBe(4);
    expect(q.nonresponse.rate).toBe(0);
  });

  it("separates don't know, refused and no usable answer", () => {
    const answers = { ...RESPONSE_A, QID3: none("dont_know"), "QID4#2": none("refused"), QID6: none("no_answer"), QID8: none("no_answer") };
    const q = analyzeInterview(inst, interview(answers));
    expect(q.nonresponse).toEqual({ asked: 10, dontKnow: 1, refused: 1, noAnswer: 2, total: 4, rate: 0.4 });
  });

  it("an interview with no substantive answer at all has a rate of 1 and no scale signals", () => {
    const reasons = ["dont_know", "refused", "no_answer"] as const;
    let n = 0;
    const r = run(inst, () => none(reasons[n++ % 3]!));
    const q = analyzeInterview(inst, interview(r.state.answers));
    expect(q.nonresponse.asked).toBe(r.asked.length);
    expect(q.nonresponse.total).toBe(r.asked.length);
    expect(q.nonresponse.rate).toBe(1);
    expect(q.nonresponse.dontKnow + q.nonresponse.refused + q.nonresponse.noAnswer).toBe(r.asked.length);
    expect(q.longestRun).toEqual({ length: 0, slots: [] });
    expect(q.acquiescence).toEqual({ items: 0, agree: 0, share: null, flagged: false });
    expect(q.extreme).toEqual({ items: 0, extreme: 0, share: null });
    expect(q.grids).toEqual([]);
  });

  it("counts a listed \"Don't know\" option as a don't know", () => {
    const q = analyzeInterview(inst, interview({ ...RESPONSE_A, QID9: choice("5") }));
    expect(q.nonresponse).toMatchObject({ dontKnow: 1, total: 1, rate: 0.1 });
  });

  it("has no rate when nothing was asked", () => {
    const q = analyzeInterview(inst, interview({}, { finished: false }));
    expect(q.nonresponse).toEqual({ asked: 0, dontKnow: 0, refused: 0, noAnswer: 0, total: 0, rate: null });
    expect(q.review).toEqual({ flagged: 0, share: null });
  });
});

describe("straightlining", () => {
  const inst = library();

  it("flags a grid of 3 or more rows answered identically on every row", () => {
    const same = analyzeInterview(inst, interview({ ...RESPONSE_A, "QID4#1": choice("4"), "QID4#2": choice("4"), "QID4#3": choice("4") }));
    expect(same.grids).toEqual([{ itemId: "QID4", rows: 3, straightlined: true }]);
    expect(analyzeInterview(inst, interview(RESPONSE_A)).grids).toEqual([{ itemId: "QID4", rows: 3, straightlined: false }]);
  });

  it("does not judge a grid with a row unanswered, declined or not reached", () => {
    expect(analyzeInterview(inst, interview({ ...RESPONSE_A, "QID4#1": choice("4"), "QID4#2": none("dont_know"), "QID4#3": choice("4") })).grids).toEqual([]);
    expect(analyzeInterview(inst, interview({ QID2: choice("1"), QID3: choice("3"), "QID4#1": choice("4"), "QID4#2": choice("4") }, { finished: false })).grids).toEqual([]);
  });

  it("has nothing to report when the path holds no grid, or the grid has fewer than 3 rows", () => {
    expect(analyzeInterview(inst, interview(RESPONSE_B)).grids).toEqual([]);
    expect(analyzeQuality(inst, [interview(RESPONSE_B)]).summary.straightlining).toEqual({ grids: 0, straightlined: 0, share: null });

    const small = instrumentOf([grid("QID1", 2), grid("QID2", 3)]);
    const q = analyzeInterview(small, interview(answersOf({ "QID1#1": "2", "QID1#2": "2", "QID2#1": "2", "QID2#2": "2", "QID2#3": "2" })));
    expect(q.grids).toEqual([{ itemId: "QID2", rows: 3, straightlined: true }]);
    // The run still spans both grids: five consecutive questions, one scale, one answer.
    expect(q.longestRun.length).toBe(5);
  });

  it("finds the longest run of one answer over consecutive questions that share a scale", () => {
    const inst2 = attitudes();
    const q = analyzeInterview(inst2, interview(answersOf({ QID1: "2", QID2: "4", QID3: "4", QID4: "4", QID5: "5", QID6: "4", QID7: "1", QID8: "4" })));
    expect(q.longestRun).toEqual({ length: 3, slots: ["QID2", "QID3", "QID4"] });
  });

  it("a different scale or a don't know ends the run", () => {
    const inst2 = attitudes();
    // QID7 is yes/no: it separates QID6 from QID8 although both were answered "Agree".
    const split = analyzeInterview(inst2, interview(answersOf({ QID1: "1", QID2: "2", QID3: "1", QID4: "2", QID5: "4", QID6: "4", QID7: "1", QID8: "4" })));
    expect(split.longestRun).toEqual({ length: 2, slots: ["QID5", "QID6"] });
    const broken = analyzeInterview(inst2, interview({ ...answersOf({ QID1: "4", QID2: "4", QID4: "4", QID5: "4", QID6: "4", QID7: "1", QID8: "4" }), QID3: none("dont_know") }));
    expect(broken.longestRun.slots).toEqual(["QID4", "QID5", "QID6"]);
  });

  it("the Library answers hold no run longer than one", () => {
    expect(analyzeInterview(inst, interview(RESPONSE_A)).longestRun.length).toBe(1);
  });
});

describe("acquiescence", () => {
  const inst = attitudes();
  const seven = (codes: string[]) => interview(answersOf({ QID1: codes[0]!, QID2: codes[1]!, QID3: codes[2]!, QID4: codes[3]!, QID5: codes[4]!, QID6: codes[5]!, QID7: "1", QID8: codes[6]! }));

  it("flags an interview with 80% or more agree answers over at least 5 agree/disagree questions", () => {
    expect(analyzeInterview(inst, seven(["4", "5", "4", "4", "5", "2", "4"])).acquiescence).toEqual({ items: 7, agree: 6, share: 6 / 7, flagged: true });
    expect(analyzeInterview(inst, seven(["4", "5", "4", "3", "5", "2", "2"])).acquiescence).toEqual({ items: 7, agree: 4, share: 4 / 7, flagged: false });
  });

  it("the neutral point and disagree answers are not agreement", () => {
    const q = analyzeInterview(inst, seven(["3", "3", "3", "3", "1", "2", "3"]));
    expect(q.acquiescence).toMatchObject({ items: 7, agree: 0, share: 0, flagged: false });
  });

  it("leaves don't knows out of the base and needs the minimum number of answers", () => {
    const answers = { ...answersOf({ QID1: "4", QID2: "4", QID3: "4", QID4: "4", QID7: "2" }), QID5: none("dont_know"), QID6: none("refused"), QID8: none("no_answer") };
    const q = analyzeInterview(inst, interview(answers));
    expect(q.acquiescence).toEqual({ items: 4, agree: 4, share: 1, flagged: false });
    expect(analyzeInterview(inst, interview(answers), { acquiescenceMinItems: 4 }).acquiescence.flagged).toBe(true);
  });

  it("takes the threshold as an option", () => {
    const i = seven(["4", "5", "4", "3", "5", "2", "2"]);
    expect(analyzeInterview(inst, i, { acquiescenceShare: 0.5 }).acquiescence.flagged).toBe(true);
  });

  it("detects the Library grid as agree/disagree, too short to flag", () => {
    const lib = library();
    expect(analyzeInterview(lib, interview(RESPONSE_A)).acquiescence).toEqual({ items: 3, agree: 2, share: 2 / 3, flagged: false });
    expect(analyzeInterview(lib, interview(RESPONSE_B)).acquiescence).toEqual({ items: 0, agree: 0, share: null, flagged: false });
  });
});

describe("extreme responding", () => {
  const inst = library();

  it("counts first and last points of the grid scale and the 0 to 10 scale", () => {
    // Grid 4, 3, 5 and recommend 8: one end point (the 5) in four answers.
    expect(analyzeInterview(inst, interview(RESPONSE_A)).extreme).toEqual({ items: 4, extreme: 1, share: 0.25 });
    const ends = { ...RESPONSE_A, "QID4#1": choice("1"), "QID4#2": choice("5"), "QID4#3": choice("3"), QID5: choice("0") };
    expect(analyzeInterview(inst, interview(ends)).extreme).toEqual({ items: 4, extreme: 3, share: 0.75 });
    expect(analyzeInterview(inst, interview({ ...RESPONSE_A, QID5: choice("10") })).extreme.extreme).toBe(2);
  });

  it("leaves out scales shorter than 4 points and single-choice questions not known to be ordered", () => {
    // Response B answers two yes/no questions, the 0 to 10 scale and a number.
    expect(analyzeInterview(inst, interview(RESPONSE_B)).extreme).toEqual({ items: 1, extreme: 0, share: 0 });
  });

  it("includes single-choice questions the caller names as ordered; a listed \"Don't know\" is not an end point", () => {
    const opts = { ordinalItemIds: ["QID3", "QID9"] };
    // QID3 "About once a month" (middle), QID9 "Good": no new end points.
    expect(analyzeInterview(inst, interview(RESPONSE_A), opts).extreme).toEqual({ items: 6, extreme: 1, share: 1 / 6 });
    // "Poor" is the last real point of QID9, so it is an end point.
    expect(analyzeInterview(inst, interview({ ...RESPONSE_A, QID9: choice("4") }), opts).extreme).toEqual({ items: 6, extreme: 2, share: 2 / 6 });
    // "Don't know" is not on the scale at all.
    expect(analyzeInterview(inst, interview({ ...RESPONSE_A, QID9: choice("5") }), opts).extreme).toEqual({ items: 5, extreme: 1, share: 0.2 });
  });
});

describe("response latency", () => {
  const inst = library();

  it("gives median, mean and the number of replies that began too soon", () => {
    const latencyMs = { QID2: 900, QID3: 150, "QID4#1": -50, QID5: 1500 };
    const q = analyzeInterview(inst, interview(RESPONSE_A, { latencyMs }));
    expect(q.latency).toEqual({ n: 4, medianMs: 525, meanMs: 625, tooFast: 2 });
  });

  it("the default threshold is 200 ms, and it is an option", () => {
    expect(SPOKEN_TOO_FAST_MS).toBe(200);
    const latencyMs = { QID2: 199, QID3: 200, QID5: 700 };
    expect(analyzeInterview(inst, interview(RESPONSE_A, { latencyMs })).latency.tooFast).toBe(1);
    expect(analyzeInterview(inst, interview(RESPONSE_A, { latencyMs }), { tooFastMs: 800 }).latency.tooFast).toBe(3);
  });

  it("copes with missing latencies, unusable values and slots that were never asked", () => {
    expect(analyzeInterview(inst, interview(RESPONSE_A)).latency).toEqual({ n: 0, medianMs: null, meanMs: null, tooFast: 0 });
    const latencyMs = { QID2: Number.NaN, QID3: 1000, QID99: 5, QID8: Number.POSITIVE_INFINITY };
    expect(analyzeInterview(inst, interview(RESPONSE_A, { latencyMs })).latency).toEqual({ n: 1, medianMs: 1000, meanMs: 1000, tooFast: 0 });
    // Response B never reaches QID3, so a stray value for it is ignored.
    expect(analyzeInterview(inst, interview(RESPONSE_B, { latencyMs: { QID3: 1000, QID2: 400 } })).latency.n).toBe(1);
  });
});

describe("break-off point", () => {
  const inst = library();

  it("is absent for a finished interview", () => {
    expect(analyzeInterview(inst, interview(RESPONSE_A)).breakoff).toBeNull();
  });

  it("gives the last answer, the question due and how far through the applicable path it stopped", () => {
    const q = analyzeInterview(inst, interview(firstAnswers(RESPONSE_A, 3), { finished: false }));
    expect(q.breakoff).toEqual({ lastAnswered: "QID4#1", stoppedAt: "QID4#2", answered: 3, applicable: 10, progress: 0.3 });
  });

  it("handles an interview that stopped before the first answer", () => {
    const q = analyzeInterview(inst, interview({}, { finished: false }));
    // With nothing answered, the questions shown only to library visitors do not apply.
    expect(q.breakoff).toEqual({ lastAnswered: null, stoppedAt: "QID2", answered: 0, applicable: 6, progress: 0 });
  });

  it("the applicable path follows the survey logic for what was answered", () => {
    expect(applicableSlots(inst, RESPONSE_A).map((s) => s.key)).toEqual(Object.keys(RESPONSE_A));
    expect(applicableSlots(inst, RESPONSE_B).map((s) => s.key)).toEqual(["QID2", "QID5", "QID6", "QID7"]);
    expect(applicableSlots(inst, { QID2: choice("2") }).map((s) => s.key)).toEqual(["QID2", "QID5", "QID6", "QID7", "QID8", "QID9"]);
  });

  it("completion share counts substantive answers, or everything asked", () => {
    expect(completionShare(inst, RESPONSE_A)).toBe(1);
    expect(completionShare(inst, RESPONSE_B)).toBe(1);
    expect(completionShare(inst, firstAnswers(RESPONSE_A, 3))).toBe(0.3);
    const withGaps = { ...RESPONSE_A, QID5: none("dont_know"), QID8: none("refused") };
    expect(completionShare(inst, withGaps)).toBe(0.8);
    expect(completionShare(inst, withGaps, "asked")).toBe(1);
    expect(completionShare(instrumentOf([question("QID1", { QuestionType: "DB", Selector: "TB" }), question("QID2")]), {})).toBe(0);
  });
});

describe("answers flagged for human review", () => {
  const inst = library();

  it("is a share of the questions asked; flags on questions never asked are ignored", () => {
    const q = analyzeInterview(inst, interview(RESPONSE_A, { review: ["QID6", "QID8", "QID8", "QID99"] }));
    expect(q.review).toEqual({ flagged: 2, share: 0.2 });
  });
});

describe("a set of interviews", () => {
  const inst = library();
  const interviews: InterviewRecord[] = [
    { id: "a", answers: RESPONSE_A, review: ["QID6"], finished: true, latencyMs: { QID2: 1000, QID3: 2000, QID5: 100 } },
    { id: "b", answers: { ...RESPONSE_B, QID6: none("dont_know") }, review: [], finished: true, latencyMs: { QID2: 600 } },
    { id: "c", answers: { ...RESPONSE_A, "QID4#1": choice("5"), "QID4#2": choice("5"), "QID4#3": choice("5"), QID5: none("refused"), QID9: none("no_answer") }, review: ["QID9"], finished: true },
    { id: "d", answers: firstAnswers(RESPONSE_A, 3), review: [], finished: false, latencyMs: { QID2: 400 } },
    { id: "e", answers: {}, review: [], finished: false },
  ];
  const report = analyzeQuality(inst, interviews);
  const s = report.summary;

  it("keeps one result per interview, in order", () => {
    expect(report.interviews.map((q) => q.id)).toEqual(["a", "b", "c", "d", "e"]);
    expect(report.interviews[1]).toEqual(analyzeInterview(inst, interviews[1]!));
  });

  it("pools nonresponse over every question asked", () => {
    expect(s.interviews).toBe(5);
    expect(s.finished).toBe(3);
    // 10 + 4 + 10 + 3 + 0 questions asked.
    expect(s.nonresponse).toEqual({ asked: 27, dontKnow: 1, refused: 1, noAnswer: 1, total: 3, rate: 3 / 27 });
  });

  it("reports each question, counting a grid row as one question", () => {
    expect(s.items.map((i) => i.exportTag)).toEqual(["Q2", "Q3", "Q4", "Q5", "Q6", "Q7", "Q8", "Q9"]);
    const by = Object.fromEntries(s.items.map((i) => [i.itemId, i]));
    expect(by.QID2!.nonresponse).toMatchObject({ asked: 4, total: 0, rate: 0 });
    expect(by.QID4!.nonresponse.asked).toBe(7);
    expect(by.QID5!.nonresponse).toMatchObject({ asked: 3, refused: 1, rate: 1 / 3 });
    expect(by.QID6!.nonresponse).toMatchObject({ asked: 3, dontKnow: 1 });
    expect(by.QID9!.nonresponse).toMatchObject({ asked: 2, noAnswer: 1, rate: 0.5 });
    expect(by.QID2!.latency).toEqual({ n: 3, medianMs: 600, meanMs: 2000 / 3, tooFast: 0 });
    expect(by.QID5!.latency).toEqual({ n: 1, medianMs: 100, meanMs: 100, tooFast: 1 });
    expect(by.QID8!.latency).toEqual({ n: 0, medianMs: null, meanMs: null, tooFast: 0 });
  });

  it("pools the scale signals", () => {
    expect(s.straightlining).toEqual({ grids: 2, straightlined: 1, share: 0.5 });
    expect(s.longestRun).toBe(3);
    // Grid answers: a 4,3,5; c 5,5,5; d 4. Seven answers, six on the agree side.
    expect(s.acquiescence).toEqual({ eligible: 0, flagged: 0, items: 7, agree: 6, share: 6 / 7 });
    // End points: a one of 4; b none of 1; c three of 3; d none of 1.
    expect(s.extreme).toEqual({ items: 9, extreme: 4, share: 4 / 9 });
    expect(s.latency).toEqual({ n: 5, medianMs: 600, meanMs: 820, tooFast: 1 });
    expect(s.review).toEqual({ flagged: 2, share: 2 / 27 });
  });

  it("summarises where unfinished interviews stopped", () => {
    expect(s.breakoffs).toEqual({ count: 2, meanProgress: 0.15, after: [{ itemId: null, count: 1 }, { itemId: "QID4", count: 1 }] });
  });

  it("handles an empty set", () => {
    const empty = analyzeQuality(inst, []).summary;
    expect(empty.interviews).toBe(0);
    expect(empty.nonresponse.rate).toBeNull();
    expect(empty.longestRun).toBe(0);
    expect(empty.breakoffs).toEqual({ count: 0, meanProgress: null, after: [] });
    expect(empty.items).toHaveLength(8);
  });

  it("renders a short plain-language section with the caveat and a table", () => {
    const md = renderQualityMarkdown(report);
    expect(md).toContain("## Answer quality");
    expect(md).toContain("These are screening signals, not proof of poor data");
    expect(md).toContain("| Signal | Result | How it is counted |");
    expect(md).toContain("| Questions asked that got no answer (item nonresponse) | 3 of 27 (11%) |");
    expect(md).toContain("| Grids given the same answer on every line (straightlining) | 1 of 2 (50%) |");
    expect(md).toContain("| Longest run of one answer | 3 in a row |");
    expect(md).toContain("| Interviews that agree with nearly everything (acquiescence) | none to count |");
    expect(md).toContain("| Answers at either end of a scale (extreme responding) | 4 of 9 (44%) |");
    expect(md).toContain("median 600 ms, mean 820 ms");
    expect(md).toContain("1 began less than 200 ms after the question ended");
    expect(md).toContain("| Interviews not finished (break-offs) | 2 of 5 (40%) |");
    expect(md).toContain("| Q5 | 3 | 0 | 1 | 0 | 33% | 100 ms |");
    expect(md).toContain("Unfinished interviews stopped: 1 before the first answer, 1 after Q4.");
    for (const line of md.split("\n").filter((l) => l.startsWith("|"))) expect(line.endsWith("|"), line).toBe(true);
  });

  it("renders an empty set without a question table", () => {
    const md = renderQualityMarkdown(analyzeQuality(inst, []));
    expect(md).toContain("Based on 0 interviews");
    expect(md).not.toContain("### By question");
    expect(md).toContain("median n/a, mean n/a");
  });
});
