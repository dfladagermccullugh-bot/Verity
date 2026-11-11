import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { phoneConnect } from "../src/dialer/phone-connect.js";
import { Store } from "../src/dialer/store.js";
import { runCampaign, type Connect } from "../src/dialer/worker.js";
import { DEFAULT_WORDING, at, converse, cooperative, firstSaying } from "../src/interviewer/simulate.js";
import { campaignStatus, caseAudit, reviewSheet, setUpCampaign, writeCampaignOutputs } from "../src/ops/campaign-ops.js";
import { allowlisted, dialLoop, parseAllowlist } from "../src/ops/dial.js";
import { FakeCallSession } from "../src/telephony/fake.js";
import { SpeechStore, silentVoice } from "../src/voice/tts.js";
import { parseCsv } from "../src/util/csv.js";
import { testDb } from "./db.js";
import { LIBRARY_QSF, question, survey } from "./helpers.js";

const NOON_ET = new Date("2026-11-10T17:00:00Z");
const SPOKEN_A: Record<string, string> = { QID2: "Yes", QID3: "About once a month", "QID4#1": "Somewhat agree", "QID4#2": "Neither agree nor disagree", "QID4#3": "Strongly agree", QID5: "8", QID6: "12", QID7: "yes", QID8: "Longer weekend hours", QID9: "Good" };
const CONTACTS = [
  "phone,state,external_ref,consent_source,consent_at,consent_method,consent_scope",
  "202-555-0143,DC,R_1,Sign-up R_1,2026-11-01T12:00:00Z,web_form,Phone survey by an AI interviewer",
  "202-555-0144,DC,R_2,Sign-up R_2,2026-11-01T12:00:00Z,web_form,Phone survey by an AI interviewer",
  "202-555-0145,DC,R_3,,,,",
  "911,,R_4,,,,",
].join("\n");
const CTX = { researcher: "Test", recruitment: "Volunteers.", classifier: null, voice: "test voice", recogniser: "test recogniser", transport: "simulated" };
const talk = (persona: Parameters<typeof converse>[1]): Connect => async (_c, iv) => (await converse(iv, persona), { connected: true });

describe("setting up a campaign from files", () => {
  it("creates a draft, adds people, and reports contacts that cannot be called", async () => {
    const store = new Store(await testDb());
    const r = await setUpCampaign(store, { name: "Library pilot", qsf: LIBRARY_QSF, contactsCsv: CONTACTS, wording: DEFAULT_WORDING });
    expect(r.campaign).toMatchObject({ status: "draft", name: "Library pilot" });
    expect(r.readiness).toContain("**Verdict: READY.**");
    expect(r.contacts).toMatchObject({ rows: 4, added: 3, withoutConsent: 2, skipped: [{ phone: "911" }] });
    expect(r.contacts.problems.map((p) => p.line)).toEqual([4, 5]);
    // A draft calls nobody.
    expect(await store.claimNext(r.campaign!.id, "x", NOON_ET)).toBeNull();
    const status = await campaignStatus(store, r.campaign!.id, NOON_ET);
    expect(status).toMatchObject({ status: "draft", cases: { total: 3, pending: 3, inCall: 0, closed: 0 }, callableNow: 0, blocked: { no_consent: 1, campaign_not_running: 2 } });
  });

  it("refuses a survey that cannot be run by voice, and creates nothing", async () => {
    const sql = await testDb();
    const r = await setUpCampaign(new Store(sql), { name: "Bad", qsf: JSON.stringify(survey([question("QID1", { Selector: "MAVR" })])), contactsCsv: CONTACTS, wording: DEFAULT_WORDING });
    expect(r.campaign).toBeNull();
    expect(r.readiness).toContain("NOT READY");
    expect(await sql.query("select 1 from campaigns")).toEqual([]);
  });
});

describe("outputs", () => {
  it("writes the report, the Qualtrics file, the do-not-call list and the answers to check", async () => {
    const store = new Store(await testDb());
    const { campaign } = await setUpCampaign(store, { name: "Library pilot", qsf: LIBRARY_QSF, contactsCsv: CONTACTS, wording: DEFAULT_WORDING });
    await store.setCampaignStatus(campaign!.id, "running");
    const personas = [firstSaying("hmm not sure really", cooperative(SPOKEN_A)), at("QID5", "remove me", cooperative(SPOKEN_A))];
    let n = 0;
    await runCampaign(store, campaign!.id, { transport: "simulated", connect: (c, iv) => talk(personas[n++]!)(c, iv), now: () => NOON_ET, concurrency: 1 });
    const status = await campaignStatus(store, campaign!.id, NOON_ET);
    expect(status).toMatchObject({ cases: { total: 3, closed: 2 }, outcomes: { complete: 1, opt_out: 1 }, blocked: { no_consent: 1 } });

    const dir = mkdtempSync(join(tmpdir(), "vv-out-"));
    const files = await writeCampaignOutputs(store, campaign!.id, CTX, dir);
    expect(files.map((f) => f.replace(dir + "/", ""))).toEqual(["report.md", "qualtrics-responses.csv", "do-not-call.csv", "answers-to-check.md"]);
    expect(files.every(existsSync)).toBe(true);
    const responses = parseCsv(readFileSync(files[1]!, "utf8"));
    expect(responses.slice(3).map((r) => [r.at(-1), r[5]])).toEqual([["R_1", "1"], ["R_2", "0"]]);
    expect(parseCsv(readFileSync(files[2]!, "utf8")).slice(1).map((r) => r[0])).toEqual(["+12025550144"]);
    expect(readFileSync(files[0]!, "utf8")).toContain("Sample: 2 people with consent on file. 1 contact had no valid consent on file and was never called; it is not part of the sample.");

    // Every question got "hmm not sure really" first; that is read as don't know for closed questions.
    const audit = await caseAudit(store, campaign!.id, "R_1");
    expect(audit).toContain("# Audit trail: R_1");
    expect(audit).toContain("- **Interviewer** (`p.intro`): Hello. This is a call from the Library Study. I am an automated AI interviewer, not a person.");
    expect(audit).toContain("- **Respondent:** hmm not sure really");
    expect(audit).toContain("### How each reply was read");
    await expect(caseAudit(store, campaign!.id, "R_99")).rejects.toThrow(/No case R_99/);
    expect(await reviewSheet(store, campaign!.id)).toMatch(/^# Answers to check: Library pilot/);
  });
});

describe("the limit on which numbers may be dialled", () => {
  it("has no default, accepts a list of numbers or the word campaign, and rejects anything else", () => {
    expect(parseAllowlist(undefined)).toBeNull();
    expect(parseAllowlist("  ")).toBeNull();
    expect(parseAllowlist("+12025550143, +12025550144")).toEqual({ kind: "numbers", numbers: ["+12025550143", "+12025550144"] });
    expect(parseAllowlist("Campaign")).toEqual({ kind: "campaign" });
    expect(() => parseAllowlist("everyone")).toThrow(/DIAL_ALLOWLIST/);
    expect(() => parseAllowlist("2025550143")).toThrow(/DIAL_ALLOWLIST/);
  });

  it("a number that is not listed is never passed to the carrier, and the attempt is closed as not dialable", async () => {
    const store = new Store(await testDb());
    const { campaign } = await setUpCampaign(store, { name: "Library pilot", qsf: LIBRARY_QSF, contactsCsv: CONTACTS, wording: DEFAULT_WORDING, settings: { concurrency: 1 } });
    await store.setCampaignStatus(campaign!.id, "running");
    const dialled: string[] = [];
    const carrier = { name: "fake", startCall: async (to: string) => (dialled.push(to), new FakeCallSession({ timeScale: 0.001 })) };
    const provider = allowlisted(carrier, parseAllowlist("+12025550143")!);
    const connect = phoneConnect({ provider, speech: new SpeechStore(silentVoice(200)), ringTimeoutMs: 1000, detectMachine: false });
    const controller = new AbortController();
    await dialLoop(store, campaign!.id, { connect, now: () => NOON_ET, signal: controller.signal, intervalMs: 5, onPass: () => controller.abort() });
    expect(dialled).toEqual(["+12025550143"]);
    const cases = await store.listCases(campaign!.id);
    expect(cases.find((c) => c.phone === "+12025550144")).toMatchObject({ status: "final", finalOutcome: "invalid_number", attempts: 1 });
    expect(cases.find((c) => c.phone === "+12025550143")).toMatchObject({ status: "pending", attempts: 1 });
    // "campaign" lifts the limit.
    const open = allowlisted(carrier, { kind: "campaign" });
    await open.startCall("+12025550144", { maxDurationSeconds: 60 });
    expect(dialled).toEqual(["+12025550143", "+12025550144"]);
  });

  it("the loop stops when the campaign is paused", async () => {
    const store = new Store(await testDb());
    const { campaign } = await setUpCampaign(store, { name: "Library pilot", qsf: LIBRARY_QSF, contactsCsv: CONTACTS, wording: DEFAULT_WORDING });
    let passes = 0;
    await dialLoop(store, campaign!.id, { connect: talk(cooperative(SPOKEN_A)), now: () => NOON_ET, signal: new AbortController().signal, intervalMs: 5, onPass: () => passes++ });
    expect(passes).toBe(0);
  });
});
