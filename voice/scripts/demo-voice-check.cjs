// Checks the browser demo's speak-and-listen mode in a real (headless) browser. Headless browsers have no
// speech features, so this puts stand-ins in their place: it tests the page's own logic (pause and resume,
// the microphone button, a blocked microphone, cutting in, hang-up), not any real voice.
// Usage: node scripts/demo-voice-check.cjs <base-url> <output-dir>   (needs Playwright installed)
const { chromium } = require("playwright");
const assert = (ok, what) => { if (!ok) throw new Error("FAILED: " + what); console.log("ok  " + what); };
(async () => {
  const [base = "http://127.0.0.1:3000", out = "."] = process.argv.slice(2);
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  const errors = []; page.on("pageerror", (e) => errors.push(String(e)));
  await page.addInitScript(() => {
    window.__spoken = []; window.__cur = null; window.__rec = null; window.__starts = 0;
    window.SpeechSynthesisUtterance = class { constructor(t) { this.text = t; } };
    Object.defineProperty(window, "speechSynthesis", { value: {
      speak(u) { window.__cur = u; window.__spoken.push(u.text); u._t = setTimeout(() => { if (window.__cur === u) { window.__cur = null; u.onend && u.onend(); } }, 500); },
      cancel() { const u = window.__cur; window.__cur = null; if (u) { clearTimeout(u._t); setTimeout(() => u.onend && u.onend(), 0); } },
    } });
    window.SpeechRecognition = class { start() { window.__rec = this; window.__starts++; } abort() { if (window.__rec === this) window.__rec = null; setTimeout(() => this.onend && this.onend(), 0); } };
    window.__say = (text) => { const r = window.__rec; r.onspeechstart && r.onspeechstart(); r.onresult({ results: [Object.assign([{ transcript: text }], { isFinal: true })] }); };
    window.__interim = (text) => { const r = window.__rec; r.onspeechstart && r.onspeechstart(); r.onresult({ results: [Object.assign([{ transcript: text }], { isFinal: false })] }); };
  });
  const phase = () => page.evaluate(() => document.body.dataset.phase);
  const until = (p) => page.waitForFunction((p) => document.body.dataset.phase === p, p, { timeout: 15000 });
  await page.goto(base);
  await page.check("#agree"); await page.click("#start");
  await until("speaking");
  assert(await page.locator("#reply").isHidden(), "typed reply box is tucked away in voice mode");
  assert((await page.getAttribute("#said", "aria-live")) === "off", "screen reader does not repeat lines the voice reads");
  // Pause in the middle of the introduction.
  await page.waitForFunction(() => window.__spoken.length === 2);
  await page.click("#pause");
  const frozen = await page.evaluate(() => window.__spoken.length);
  const t1 = await page.textContent("#timer");
  await page.waitForTimeout(1300);
  assert((await page.evaluate(() => window.__spoken.length)) === frozen, "pause stops the voice");
  assert((await page.textContent("#statusText")) === "Paused" && (await page.textContent("#timer")) === t1, "pause shows Paused and holds the clock");
  await page.screenshot({ path: `${out}/v-paused.png` });
  await page.click("#pause");
  await until("listening");
  const spoken = await page.evaluate(() => window.__spoken);
  assert(spoken.length === 6 && new Set(spoken).size === 5 && spoken.some((t, i) => t === spoken[i + 1]), "resume says the interrupted line again, then the rest (5 lines, one twice)");
  assert((await page.textContent("#quote")) === "Do you agree to take part?", "the question is the quotation");
  await page.evaluate(() => window.__interim("ye"));
  assert((await page.textContent("#you")).includes("Hearing") , "interim speech is shown as Hearing");
  await page.screenshot({ path: `${out}/v-listening.png` });
  await page.evaluate(() => window.__say("yes"));
  assert((await page.textContent("#you")).includes("You said") && (await page.textContent("#youText")) === "yes", "the recognised reply is shown");
  await until("listening");
  assert((await page.textContent("#quote")).includes("visited a public library"), "consent accepted by voice; first question asked");
  // The recogniser stopping by itself is restarted while the wait lasts.
  const before = await page.evaluate(() => window.__starts);
  await page.evaluate(() => window.__rec.onend());
  assert((await page.evaluate(() => window.__starts)) === before + 1, "recognition restarts if the browser stops it early");
  // Mic off: typing takes over; mic on again: listening.
  await page.click("#mic"); await until("typing");
  assert(await page.locator("#reply").isVisible(), "muting the microphone reveals the typed reply box");
  await page.click("#mic"); await until("listening");
  // A blocked microphone falls back to typing with a message.
  await page.evaluate(() => window.__rec.onerror({ error: "not-allowed" }));
  await until("typing");
  assert((await page.textContent("#notice")).includes("type your replies"), "blocked microphone falls back to typing, with a message");
  await page.fill("#typed", "Yes"); await page.press("#typed", "Enter");
  await until("speaking");
  // Typing while the interviewer is still speaking cuts in.
  await page.fill("#typed", "About once a month"); await page.press("#typed", "Enter");
  await page.waitForFunction(() => document.getElementById("quote").textContent.includes("library staff are helpful"), null, { timeout: 15000 });
  assert(true, "a reply typed while the interviewer is speaking is taken (cuts in)");
  await until("typing");
  await page.click("#hang");
  await page.waitForSelector("#result:not([hidden])");
  const outcome = await page.textContent("#outcome");
  assert(outcome.includes("stopped part-way") && outcome.includes("Answers recorded: 2"), "hang-up shows the two answers read so far: " + outcome);
  assert((await page.locator("#trail tr").count()) === 2 && (await page.textContent("#live")) === "Session ended", "result table and header state");
  assert(errors.length === 0, "no page errors " + errors.join("; "));
  await browser.close();
})().catch((e) => { console.error(e.message); process.exit(1); });
