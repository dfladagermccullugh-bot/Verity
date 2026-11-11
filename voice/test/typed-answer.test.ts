import { describe, expect, it } from "vitest";
import { readTypedAnswer } from "../src/engine/typed-answer.js";
import { library } from "./helpers.js";

const inst = library();
const item = (id: string) => inst.items.find((i) => i.id === id)!;
const answer = (id: string, input: string) => {
  const r = readTypedAnswer(item(id), input);
  return r.kind === "answer" ? r.answer : "unclear";
};

describe("rule-based reading of typed answers", () => {
  it("accepts an exact option, ignoring case and trailing punctuation", () => {
    expect(answer("QID2", " yes. ")).toEqual({ kind: "choice", code: "1" });
    expect(answer("QID3", "About once a month")).toEqual({ kind: "choice", code: "3" });
  });

  it("accepts an option's position in the list", () => {
    expect(answer("QID3", "5")).toEqual({ kind: "choice", code: "5" });
    expect(answer("QID3", "6")).toBe("unclear");
  });

  it("on a number scale a number is the scale point, not a position", () => {
    expect(answer("QID5", "0")).toEqual({ kind: "choice", code: "0" });
    expect(answer("QID5", "10")).toEqual({ kind: "choice", code: "10" });
    expect(answer("QID5", "11")).toBe("unclear");
  });

  it("an option worded like don't know is that option, not nonresponse", () => {
    expect(answer("QID9", "Don't know")).toEqual({ kind: "choice", code: "5" });
    expect(answer("QID2", "don't know")).toEqual({ kind: "nonresponse", reason: "dont_know" });
    expect(answer("QID2", "refuse")).toEqual({ kind: "nonresponse", reason: "refused" });
  });

  it("reads numbers and open answers", () => {
    expect(answer("QID6", "12")).toEqual({ kind: "number", value: 12 });
    expect(answer("QID6", "twelve")).toEqual({ kind: "number", value: 12 });
    expect(answer("QID6", "none")).toEqual({ kind: "number", value: 0 });
    expect(answer("QID6", "a fair few")).toBe("unclear");
    expect(answer("QID8", "um")).toBe("unclear");
    expect(answer("QID8", "what do you mean by change?")).toBe("unclear");
    expect(answer("QID8", "  Longer weekend hours ")).toEqual({ kind: "text", value: "Longer weekend hours" });
  });

  it("understands a position in the list, and number words on a number scale", () => {
    expect(answer("QID3", "option three")).toEqual({ kind: "choice", code: "3" });
    expect(answer("QID3", "the last one")).toEqual({ kind: "choice", code: "5" });
    expect(answer("QID3", "the second option")).toEqual({ kind: "choice", code: "2" });
    expect(answer("QID3", "number nine")).toBe("unclear");
    expect(answer("QID5", "eight")).toEqual({ kind: "choice", code: "8" });
    expect(answer("QID5", "number 6")).toEqual({ kind: "choice", code: "6" });
    expect(answer("QID5", "eleven")).toBe("unclear");
    expect(answer("QID5", "the last one")).toBe("unclear");
  });

  it("never guesses", () => {
    for (const input of ["", "maybe", "yes and no", "sort of monthly", "y"]) expect(answer("QID3", input)).toBe("unclear");
  });
});
