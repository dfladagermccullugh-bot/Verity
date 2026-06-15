import { describe, it, expect } from "vitest";
import { detectLeading } from "@/lib/anti-leading";

describe("detectLeading — tag questions", () => {
  it("flags a trailing ', right?' tag", () => {
    const r = detectLeading("This is for parents, right?");
    expect(r.leading).toBe(true);
    if (r.leading) expect(r.reason).toBe("tag_question");
  });

  it("flags 'isn't it?' tags", () => {
    expect(detectLeading("It's mainly for kids, isn't it?").leading).toBe(true);
  });

  it("flags 'wouldn't you?' tags", () => {
    expect(detectLeading("You'd use this daily, wouldn't you?").leading).toBe(true);
  });

  it("does not flag an ordinary use of 'right' mid-question", () => {
    expect(detectLeading("Is the menu on the right?").leading).toBe(false);
  });
});

describe("detectLeading — loaded openers", () => {
  it("flags 'Obviously ...'", () => {
    const r = detectLeading("Obviously this should be free?");
    expect(r.leading).toBe(true);
    if (r.leading) expect(r.reason).toBe("leading_opener");
  });

  it("flags 'So you ...'", () => {
    expect(detectLeading("So you want notifications?").leading).toBe(true);
  });
});

describe("detectLeading — presupposition", () => {
  it("flags 'don't you think'", () => {
    const r = detectLeading("Don't you think it needs a login?");
    expect(r.leading).toBe(true);
    if (r.leading) expect(r.reason).toBe("presupposition");
  });

  it("flags 'you'd want'", () => {
    expect(detectLeading("Is it true you'd want reminders?").leading).toBe(true);
  });
});

describe("detectLeading — clean questions pass", () => {
  it("accepts a neutral yes/no question", () => {
    expect(detectLeading("Is this meant for parents?").leading).toBe(false);
  });

  it("accepts another neutral question", () => {
    expect(detectLeading("Will people use this on a phone?").leading).toBe(false);
  });
});
