// Checks the demo page's "server voice" path in a real (headless) browser against the stand-in
// server (scripts/demo-standin-server.ts): the page plays the server's recordings, sends a (fake)
// microphone to the server, and the server decides the turns. It tests the plumbing, not any
// real voice or recogniser.
// Usage: node scripts/demo-server-voice-check.cjs <base-url> <output-dir>   (needs Playwright installed)
const { chromium } = require("playwright");
const assert = (ok, what) => { if (!ok) throw new Error("FAILED: " + what); console.log("ok  " + what); };
(async () => {
  const [base = "http://127.0.0.1:3312", out = "."] = process.argv.slice(2);
  const browser = await chromium.launch({ args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required"] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  const errors = []; page.on("pageerror", (e) => errors.push(String(e))); page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  const audio = []; page.on("response", (r) => { if (r.url().includes("/demo/audio/")) audio.push(r.status()); });
  let frames = 0; page.on("websocket", (ws) => ws.on("framesent", (f) => { if (typeof f.payload !== "string") frames++; }));
  const until = (p, ms = 20000) => page.waitForFunction((p) => document.body.dataset.phase === p, p, { timeout: ms });
  await page.goto(base);
  await page.waitForFunction(() => document.getElementById("soundNote").textContent.includes("through this server"));
  assert((await page.textContent("#soundNote")).includes("Stand-in"), "the gate names who will hear the microphone");
  await page.check("#agree"); await page.click("#start");
  await until("speaking");
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${out}/s-speaking.png` });
  const during = frames;
  await until("listening");
  assert(audio.length >= 5 && audio.every((s) => s === 200), "the page fetched the server's recordings (" + audio.length + ")");
  assert(during === 0, "no microphone sound is sent while the interviewer speaks (cutting in is off)");
  assert(await page.locator("#reply").isHidden(), "typed reply box is tucked away");
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${out}/s-listening.png` });
  // The stand-in recogniser "hears" a reply after about a second of sound; the server takes the turn.
  await page.waitForFunction(() => document.getElementById("youText").textContent === "yes" && document.getElementById("youLabel").textContent === "You said", null, { timeout: 15000 });
  assert(frames > 5, "microphone sound reached the server while listening (" + frames + " pieces)");
  await page.waitForFunction(() => document.getElementById("quote").textContent.includes("visited a public library"), null, { timeout: 15000 });
  assert(true, "the server took the spoken turn and asked the first question");
  // Pause holds the microphone back; mic off switches to typing.
  await until("listening");
  await page.click("#pause"); const held = frames; await page.waitForTimeout(700);
  assert(frames - held <= 1, "pause stops microphone sound being sent");
  await page.click("#pause");
  await page.waitForSelector("#result:not([hidden])", { timeout: 120000 });
  const outcome = await page.textContent("#outcome");
  assert(outcome.includes("completed") && outcome.includes("Answers recorded: 10"), "a whole interview by (stand-in) voice: " + outcome);
  await page.screenshot({ path: `${out}/s-result.png`, fullPage: true });
  assert(errors.length === 0, "no page errors " + errors.join("; "));
  await browser.close();
})().catch((e) => { console.error(e.message); process.exit(1); });
