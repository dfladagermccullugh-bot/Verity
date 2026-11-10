import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { renderSampleCalls } from "../src/report/sample-calls.js";
import { library } from "./helpers.js";

const path = new URL("../docs/sample-calls.md", import.meta.url);

describe("docs/sample-calls.md", () => {
  it("is exactly what the interviewer produces today (set UPDATE_SAMPLES=1 to regenerate)", async () => {
    const fresh = await renderSampleCalls(library());
    if (process.env.UPDATE_SAMPLES === "1" || !existsSync(path)) writeFileSync(path, fresh);
    expect(readFileSync(path, "utf8")).toBe(fresh);
  });
});
