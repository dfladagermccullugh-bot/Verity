/**
 * Command line for Phase 1: check a survey file, print its spoken script, or run a typed interview.
 *
 *   npm run verity -- check survey.qsf
 *   npm run verity -- interview survey.qsf --out responses.csv --audit audit.json
 */

import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
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
      typed interview; writes a Qualtrics import file and the audit log`;

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

async function main(): Promise<number> {
  const { positionals, values } = parseArgs({ allowPositionals: true, options: { out: { type: "string" }, audit: { type: "string" } } });
  const [command, path] = positionals;
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
