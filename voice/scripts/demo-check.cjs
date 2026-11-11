// Drives the browser demo in a real (headless) browser, in read-and-type mode, and saves screenshots.
// It follows the page by the phase it reports on <body data-phase>: "typing" means a reply is awaited.
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
const phase = (page) => page.evaluate(() => document.body.dataset.phase);
const overflows = (page) => page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
for (const [name, viewport, colorScheme] of [["desktop", { width: 1440, height: 960 }, "light"], ["laptop", { width: 1100, height: 700 }, "dark"], ["phone", { width: 390, height: 780 }, "light"]]) {
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1, colorScheme });
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.goto(base);
  if (await page.locator("#start").isEnabled()) throw new Error("Start is enabled before agreeing");
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${outDir}/demo-${name}-1-gate.png`, fullPage: true });
  const overflow = [await overflows(page)];
  await page.check('input[value="text"]');
  await page.check("#agree");
  await page.click("#start");
  let askedRepeat = false;
  for (let i = 0; i < 40; i++) {
    await page.waitForFunction(() => ["typing", "ended"].includes(document.body.dataset.phase), null, { timeout: 15000 });
    if ((await phase(page)) === "ended") break;
    const last = await page.textContent("#quote");
    if (i === 0) { await page.waitForTimeout(600); await page.screenshot({ path: `${outDir}/demo-${name}-2-consent.png`, fullPage: true }); }
    if (i === 3) {
      // The other ways to answer: the keypad sheet opens and closes, and pause holds the interview.
      await page.click("#more"); await page.waitForSelector("#sheet:not([hidden])");
      await page.screenshot({ path: `${outDir}/demo-${name}-3-keypad.png`, fullPage: true });
      overflow.push(await overflows(page));
      await page.keyboard.press("Escape"); await page.waitForSelector("#sheet", { state: "hidden" });
      await page.click("#pause");
      if ((await page.textContent("#statusText")) !== "Paused") throw new Error("Pause did not pause");
      await page.click("#pause");
      if ((await page.textContent("#statusText")) !== "Your turn") throw new Error("Resume did not resume");
    }
    let reply = (answers.find(([cue]) => last.includes(cue)) || [null, "I don't know"])[1];
    if (last.includes("The opening hours suit me.") && !askedRepeat) { askedRepeat = true; reply = "sorry, can you repeat that?"; }
    await page.fill("#typed", reply);
    await page.press("#typed", "Enter");
    await page.waitForFunction(() => document.body.dataset.phase !== "typing", null, { timeout: 15000 });
    if (i === 5 || i === 2) {
      await page.waitForFunction(() => document.body.dataset.phase === "typing", null, { timeout: 15000 });
      await page.waitForTimeout(600);
      await page.screenshot({ path: `${outDir}/demo-${name}-${i === 2 ? "3-options" : "4-call"}.png`, fullPage: true });
      overflow.push(await overflows(page));
    }
  }
  await page.waitForSelector("#result:not([hidden])", { timeout: 15000 });
  const outcome = await page.textContent("#outcome");
  const rows = await page.locator("#trail tr").count();
  const transcript = await page.locator("#log .turn").count();
  overflow.push(await overflows(page));
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${outDir}/demo-${name}-5-result.png`, fullPage: true });
  console.log(JSON.stringify({ name, outcome, rows, transcript, horizontalOverflow: overflow.some(Boolean) }));
  await page.close();
}
// Hanging up part-way still shows how the answers so far were read.
{
  const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(base);
  await page.check('input[value="text"]'); await page.check("#agree"); await page.click("#start");
  for (const reply of ["yes", "Yes"]) {
    await page.waitForFunction(() => document.body.dataset.phase === "typing", null, { timeout: 15000 });
    await page.fill("#typed", reply); await page.press("#typed", "Enter");
    await page.waitForFunction(() => document.body.dataset.phase !== "typing", null, { timeout: 15000 });
  }
  await page.waitForFunction(() => document.body.dataset.phase === "typing", null, { timeout: 15000 });
  await page.click("#hang");
  await page.waitForSelector("#result:not([hidden])", { timeout: 15000 });
  console.log(JSON.stringify({ name: "hang-up", outcome: await page.textContent("#outcome"), rows: await page.locator("#trail tr").count() }));
  await page.close();
}
await browser.close();
if (errors.length) { console.error("Page errors:", errors); process.exit(1); }
})().catch((e) => { console.error(e); process.exit(1); });
