#!/usr/bin/env node
/**
 * Browser check of the interview client against `next dev`, using the
 * development-only harness at /dev/interview (stubbed actions, no DB/model).
 *
 *   npm run dev -- -p 3123 &
 *   BASE_URL=http://localhost:3123 node scripts/e2e/interview-client.mjs
 *
 * Requires Playwright with a Chromium build (`npx playwright install chromium`
 * locally; preinstalled in Claude Code cloud sessions). Not a dependency.
 *
 * Checks: time-to-answer excludes model latency (H4); a held key's
 * auto-repeat answers nothing (L1); "Try again" resyncs from the server.
 */
import { createRequire } from "node:module";

// require() so a globally installed Playwright (NODE_PATH) is found too.
const { chromium } = createRequire(import.meta.url)("playwright");

const BASE = process.env.BASE_URL ?? "http://localhost:3123";
let failures = 0;
function check(name, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures += 1;
}

const browser = await chromium.launch();
const page = await browser.newPage();
const calls = () => page.evaluate(() => window.__verity.calls);
const heading = (text) => page.getByRole("heading", { name: text });

try {
  // 1. Timing: the second answer's latency must not include the 1.5s "model".
  await page.goto(`${BASE}/dev/interview?delay=1500`);
  await heading("Question 1?").waitFor();
  await page.waitForTimeout(1000);
  await page.getByRole("button", { name: /^Yes/ }).click();
  await heading("Question 2?").waitFor({ timeout: 10_000 });
  await page.waitForTimeout(300);
  await page.getByRole("button", { name: /^Yes/ }).click();
  await page.waitForFunction(() => window.__verity.calls.length === 2);
  const [a1, a2] = await calls();
  check("first answer timed from first paint", a1.paradata.timeToAnswerMs >= 950, `${a1.paradata.timeToAnswerMs}ms`);
  check(
    "second answer timed from when Q2 appeared (model latency excluded)",
    a2.paradata.timeToAnswerMs >= 250 && a2.paradata.timeToAnswerMs < 1200,
    `${a2.paradata.timeToAnswerMs}ms`
  );
  check("answers bound to the displayed turn", a1.turnId === "turn-1" && a2.turnId === "turn-2");

  // 2. Key repeat: auto-repeated keydowns answer nothing.
  await page.goto(`${BASE}/dev/interview?delay=400`);
  await heading("Question 1?").waitFor();
  const repeat = () =>
    page.evaluate(() =>
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "y", repeat: true }))
    );
  await repeat();
  await page.waitForTimeout(200);
  check("a repeated keydown alone answers nothing", (await calls()).length === 0);
  await page.keyboard.press("y");
  for (let i = 0; i < 10; i++) {
    await repeat();
    await page.waitForTimeout(80);
  }
  await heading("Question 2?").waitFor();
  for (let i = 0; i < 5; i++) {
    await repeat();
    await page.waitForTimeout(80);
  }
  check("holding Y answers exactly one question", (await calls()).filter((c) => c.kind === "answer").length === 1);

  // 3. Failure + Try again resyncs from the server.
  await page.goto(`${BASE}/dev/interview?delay=200&fail=1`);
  await heading("Question 1?").waitFor();
  await page.getByRole("button", { name: /^Yes/ }).click();
  await page.getByRole("alert").filter({ hasText: "didn't go through" }).waitFor();
  check("answer buttons disabled while failed", await page.getByRole("button", { name: /^Yes/ }).isDisabled());
  await page.getByRole("button", { name: "Try again" }).click();
  await heading("Question 2?").waitFor();
  const c3 = await calls();
  check("Try again resynced via resume to the saved next turn", c3.at(-1).kind === "resume");

  // 4. Done leaves the card.
  await page.getByRole("button", { name: /Conclude/ }).click();
  await page.waitForFunction(() => window.__verity.done === true, null, { timeout: 5000 });
  check("done leaves the interview", true);
} catch (err) {
  console.error(err);
  failures += 1;
} finally {
  await browser.close();
}
process.exit(failures === 0 ? 0 : 1);
