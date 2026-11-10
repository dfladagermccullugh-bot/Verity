import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MIN_NODE, PACKAGE_NAME, nodeIsSupported } from "../src/index.js";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
  name: string;
  engines: { node: string };
};

describe("scaffold", () => {
  it("package name matches the exported constant", () => {
    expect(pkg.name).toBe(PACKAGE_NAME);
  });

  it("engines field matches MIN_NODE", () => {
    expect(pkg.engines.node).toBe(`>=${MIN_NODE.major}.${MIN_NODE.minor}`);
  });

  it("accepts supported Node versions and rejects older ones", () => {
    expect(nodeIsSupported("22.13.0")).toBe(true);
    expect(nodeIsSupported("24.0.0")).toBe(true);
    expect(nodeIsSupported("22.12.9")).toBe(false);
    expect(nodeIsSupported("20.18.0")).toBe(false);
  });

  it("runs on a supported Node version", () => {
    expect(nodeIsSupported()).toBe(true);
  });
});
