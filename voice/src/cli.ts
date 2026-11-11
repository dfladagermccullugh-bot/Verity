/**
 * Command line for Phase 1: check a survey file, print its spoken script, or run a typed interview.
 *
 *   npm run verity -- check survey.qsf
 *   npm run verity -- interview survey.qsf --out responses.csv --audit audit.json
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import postgres from "postgres";
import { migrate } from "./db/migrate.js";
import { pgliteSql, postgresSql } from "./db/sql.js";
import { runSampleCampaign } from "./demo/sample-campaign.js";
import { Store } from "./dialer/store.js";
import { campaignStatus, caseAudit, setUpCampaign, writeCampaignOutputs } from "./ops/campaign-ops.js";
import { createInterface } from "node:readline";
import { parseArgs } from "node:util";
import { Interviewer } from "./interviewer/interviewer.js";
import { buildProtocol, buildSpeechTable } from "./interviewer/protocol.js";
import { readQsf } from "./qualtrics/qsf.js";
import { writeResponsesCsv } from "./qualtrics/csv.js";
import { renderReadinessReport } from "./report/readiness.js";
import { buildScript } from "./script/script.js";

const USAGE = `Usage:
  verity check <survey.qsf>
      phone-readiness report
  verity interview <survey.qsf> [--out file.csv] [--audit file.json]
      typed interview; writes a Qualtrics import file and the audit log
  verity campaign sample [--out dir]
      a complete simulated campaign: report, Qualtrics file, do-not-call list. Calls no one.

  With DATABASE_URL set:
  verity campaign create --qsf f.qsf --contacts f.csv --name "..." --sponsor "..." --topic "..." --minutes N
  verity campaign start|pause|close <id>
  verity campaign status <id>
  verity campaign report <id> [--out dir] [--researcher "..."] [--recruitment "..."] [--voice "..."] [--recogniser "..."]
  verity campaign audit <id> --case <reference>
  verity campaign retention <id> [--days 30]`;

/** Reads stdin one line at a time; works for a terminal and for piped input. Returns null at end of input. */
function lineReader(): ((prompt: string) => Promise<string | null>) & { close: () => void } {
  const rl = createInterface({ input: process.stdin });
  const lines: string[] = [];
  let waiting: ((line: string | null) => void) | null = null;
  let closed = false;
  rl.on("line", (line) => {
    if (waiting) {
      const w = waiting;
      waiting = null;
      w(line);
    } else lines.push(line);
  });
  rl.on("close", () => {
    closed = true;
    waiting?.(null);
  });
  const ask = (prompt: string) => {
    process.stdout.write(prompt);
    if (lines.length > 0) return Promise.resolve<string | null>(lines.shift()!);
    if (closed) return Promise.resolve<string | null>(null);
    return new Promise<string | null>((resolve) => (waiting = resolve));
  };
  return Object.assign(ask, { close: () => rl.close() });
}

async function interview(path: string, out: string | undefined, audit: string | undefined): Promise<number> {
  const result = readQsf(readFileSync(path, "utf8"));
  if (!result.instrument) {
    console.log(renderReadinessReport(result, basename(path)));
    return 1;
  }
  const instrument = result.instrument;
  const script = buildScript(instrument);
  const wording = { sponsor: "the Verity Voice test", topic: instrument.name, minutes: Math.max(1, Math.ceil(script.lines.length / 6)), askRecording: false };
  const table = buildSpeechTable(script, buildProtocol(wording));
  const interviewer = new Interviewer({ instrument, script, table });
  const ask = lineReader();
  const startedAt = new Date();
  console.log(`Typed interview: ${instrument.name}. This is the real interviewer with typed replies in place of speech.`);
  console.log(`No model is connected, so only exact options, option numbers, numbers, "don't know" and "refuse" are understood.\n`);
  let lines = interviewer.open();
  let stoppedEarly = false;
  for (;;) {
    for (const line of lines) console.log(`INTERVIEWER: ${line.text}`);
    if (interviewer.ended) break;
    const reply = await ask("RESPONDENT: ");
    if (reply === null) {
      console.log("\n(line dropped)");
      stoppedEarly = true;
      break;
    }
    lines = await interviewer.hear(reply);
  }
  ask.close();
  const state = interviewer.state;
  console.log(`\nOutcome: ${stoppedEarly ? "breakoff" : state.outcome}. Answers recorded: ${Object.keys(state.interview.answers).length}. Flagged for review: ${state.review.length}.`);
  if (out) {
    const record = {
      caseId: `typed-${startedAt.getTime()}`,
      startedAt,
      endedAt: new Date(),
      finished: state.outcome === "complete",
      state: state.interview,
      embedded: { vv_mode: "typed_test", vv_outcome: stoppedEarly ? "breakoff" : (state.outcome ?? "breakoff"), vv_script: table.hash.slice(0, 12) },
    };
    const csv = writeResponsesCsv(instrument, [record]);
    if (existsSync(out)) appendFileSync(out, csv.split("\r\n").slice(3).join("\r\n"));
    else writeFileSync(out, csv);
    console.log(`Responses saved to ${out}`);
  }
  if (audit) {
    writeFileSync(audit, JSON.stringify({ survey: instrument.name, speechTable: table.hash, outcome: state.outcome, review: state.review, events: interviewer.log }, null, 2));
    console.log(`Audit log saved to ${audit}`);
  }
  return 0;
}

async function database(): Promise<{ store: Store; close: () => Promise<void> }> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("Set DATABASE_URL to the Verity Voice database (a separate database from the old Verity app).");
  const sql = postgresSql(postgres(url, { max: 5, onnotice: () => {} }) as never);
  await migrate(sql);
  return { store: new Store(sql), close: () => sql.close() };
}

const REPORT_CONTEXT = (v: Record<string, string | boolean | undefined>) => ({
  researcher: String(v.researcher ?? "Not stated"),
  recruitment: String(v.recruitment ?? "Not stated."),
  classifier: process.env.ANTHROPIC_API_KEY ? `${process.env.VERITY_CLASSIFIER_MODEL ?? "claude-haiku-5-5"}` : null,
  voice: String(v.voice ?? "not stated"),
  recogniser: String(v.recogniser ?? "not stated"),
  transport: "telephone",
});

async function campaign(args: string[], v: Record<string, string | boolean | undefined>): Promise<number> {
  const [action, id] = args;
  if (action === "sample") {
    // A complete simulated campaign in a throwaway in-memory database: nothing is called, nothing is kept.
    const { PGlite } = await import("@electric-sql/pglite");
    const sql = pgliteSql(new PGlite() as never);
    await migrate(sql);
    const instrument = readQsf(readFileSync(new URL("../fixtures/qualtrics/library-test.qsf", import.meta.url), "utf8")).instrument!;
    const out = await runSampleCampaign(sql, instrument);
    const dir = String(v.out ?? "sample-campaign");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "report.md"), out.report);
    writeFileSync(join(dir, "qualtrics-responses.csv"), out.responsesCsv);
    writeFileSync(join(dir, "do-not-call.csv"), out.doNotCallCsv);
    console.log(`Simulated campaign written to ${dir}/ (report.md, qualtrics-responses.csv, do-not-call.csv). No one was called.`);
    return 0;
  }
  const db = await database();
  try {
    if (action === "create") {
      for (const need of ["qsf", "contacts", "name", "sponsor", "topic", "minutes"]) if (!v[need]) throw new Error(`campaign create needs --${need}`);
      const r = await setUpCampaign(db.store, {
        name: String(v.name),
        qsf: readFileSync(String(v.qsf), "utf8"),
        contactsCsv: readFileSync(String(v.contacts), "utf8"),
        wording: { sponsor: String(v.sponsor), topic: String(v.topic), minutes: Number(v.minutes), askRecording: false },
      });
      if (!r.campaign) {
        console.log(r.readiness);
        return 1;
      }
      console.log(`Created campaign ${r.campaign.id} as a draft. Nobody is called until you run: verity campaign start ${r.campaign.id}`);
      console.log(`Contacts: ${r.contacts.rows} in the file, ${r.contacts.added} added, ${r.contacts.withoutConsent} without consent on file (never called), ${r.contacts.skipped.length} skipped.`);
      for (const p of r.contacts.problems) console.log(`  line ${p.line}: ${p.problems.join("; ")}`);
      return 0;
    }
    if (!id) throw new Error(`campaign ${action ?? ""} needs a campaign id`);
    if (action === "start" || action === "pause" || action === "close") {
      await db.store.setCampaignStatus(id, action === "start" ? "running" : action === "pause" ? "paused" : "closed");
      console.log(`Campaign ${id} is now ${action === "start" ? "running" : action === "pause" ? "paused" : "closed"}.`);
    } else if (action === "status") console.log(JSON.stringify(await campaignStatus(db.store, id, new Date()), null, 2));
    else if (action === "report") for (const f of await writeCampaignOutputs(db.store, id, REPORT_CONTEXT(v), String(v.out ?? "campaign-output"))) console.log(`wrote ${f}`);
    else if (action === "audit") console.log(await caseAudit(db.store, id, String(v.case ?? "")));
    else if (action === "retention") {
      const days = Number(v.days ?? 30);
      const now = new Date();
      const r = await db.store.removeOldWords(id, new Date(now.getTime() - days * 86_400_000), now);
      console.log(`Removed respondents' words from ${r.cases} finished cases (${r.events} log entries) older than ${days} days.`);
    } else throw new Error(USAGE);
    return 0;
  } finally {
    await db.close();
  }
}

async function main(): Promise<number> {
  const text = { type: "string" } as const;
  const { positionals, values } = parseArgs({ allowPositionals: true, options: { out: text, audit: text, qsf: text, contacts: text, name: text, sponsor: text, topic: text, minutes: text, case: text, days: text, researcher: text, recruitment: text, voice: text, recogniser: text } });
  const [command, path] = positionals;
  if (command === "campaign") return campaign(positionals.slice(1), values);
  if (!command || !path || !["check", "interview"].includes(command)) {
    console.error(USAGE);
    return 2;
  }
  if (command === "interview") return interview(path, values.out, values.audit);
  const result = readQsf(readFileSync(path, "utf8"));
  console.log(renderReadinessReport(result, basename(path)));
  return result.instrument ? 0 : 1;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(2);
  },
);
