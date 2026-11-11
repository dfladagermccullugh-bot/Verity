// Drives the browser demo in a real (headless) browser, in read-and-type mode, and saves screenshots.
// Usage: node scripts/demo-check.cjs <base-url> <output-dir>   (needs Playwright installed)
const { chromium } = require("playwright");

(async () => {
const [base = "http://127.0.0.1:3000", outDir = "."] = process.argv.slice(2);
// What to type, by what the interviewer last said. One reply is a repeat request, to exercise that path.
const answers = [
  ["Do you agree to take part?", "yes"],
  ["have you visited a public library", "Yes"],
  ["Only once.", "about once a month"],
  ["The library staff are helpful.", "Somewhat agree"],
  ["The opening hours suit me.", "the third one"],
  ["The library is easy to get to.", "Strongly agree"],
  ["Extremely likely.", "eight"],
  ["How many books", "12"],
  ["two more questions", "yes"],
  ["What one change", "Longer weekend hours"],
  ["or Don't know.", "Good"],
];
const browser = await chromium.launch();
const errors = [];
for (const [name, viewport] of [["desktop", { width: 1100, height: 900 }], ["phone", { width: 390, height: 780 }]]) {
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.goto(base);
  if (await page.locator("#start").isEnabled()) throw new Error("Start is enabled before agreeing");
  await page.screenshot({ path: `${outDir}/demo-${name}-1-gate.png` });
  await page.check('input[value="text"]');
  await page.check("#agree");
  await page.click("#start");
  let askedRepeat = false;
  for (let i = 0; i < 40; i++) {
    await page.waitForFunction(() => document.getElementById("status").textContent.startsWith("Your turn") || !document.getElementById("result").hidden, null, { timeout: 15000 });
    if (!(await page.locator("#result").isHidden())) break;
    const last = await page.locator(".turn.iv").last().innerText();
    let reply = (answers.find(([cue]) => last.includes(cue)) || [null, "I don't know"])[1];
    if (last.includes("The opening hours suit me.") && !askedRepeat) { askedRepeat = true; reply = "sorry, can you repeat that?"; }
    await page.fill("#typed", reply);
    await page.press("#typed", "Enter");
    await page.waitForFunction(() => !document.getElementById("status").textContent.startsWith("Your turn"), null, { timeout: 15000 });
    if (i === 6) await page.screenshot({ path: `${outDir}/demo-${name}-2-call.png` });
  }
  await page.waitForSelector("#result:not([hidden])", { timeout: 15000 });
  const outcome = await page.textContent("#outcome");
  const rows = await page.locator("#trail tr").count();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  await page.screenshot({ path: `${outDir}/demo-${name}-3-result.png`, fullPage: true });
  console.log(JSON.stringify({ name, outcome, rows, horizontalOverflow: overflow }));
  await page.close();
}
await browser.close();
if (errors.length) { console.error("Page errors:", errors); process.exit(1); }
})().catch((e) => { console.error(e); process.exit(1); });
