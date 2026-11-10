/**
 * Command line for Phase 1: check a survey file, print its spoken script, or run a typed interview.
 *
 *   npm run verity -- check survey.qsf
 *   npm run verity -- interview survey.qsf --out responses.csv
 */

import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import { createInterface } from "node:readline";
import { parseArgs } from "node:util";
import { emptyState, markHeard, nextStep, recordAnswer, validateAnswer } from "./engine/flow.js";
import { readTypedAnswer } from "./engine/typed-answer.js";
import { readQsf } from "./qualtrics/qsf.js";
import { writeResponsesCsv } from "./qualtrics/csv.js";
import { renderReadinessReport } from "./report/readiness.js";
import { buildScript, linesForStep } from "./script/script.js";

const USAGE = `Usage:
  verity check <survey.qsf>                       phone-readiness report
  verity interview <survey.qsf> [--out file.csv]  typed interview; writes a Qualtrics import file`;

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

async function interview(path: string, out: string | undefined): Promise<number> {
  const result = readQsf(readFileSync(path, "utf8"));
  if (!result.instrument) {
    console.log(renderReadinessReport(result, basename(path)));
    return 1;
  }
  const instrument = result.instrument;
  const script = buildScript(instrument);
  const ask = lineReader();
  const startedAt = new Date();
  let state = emptyState();
  let finished = false;
  console.log(`Typed interview: ${instrument.name}. Type an option, its number, a number, "dk" or "refuse". Ctrl-D stops early.\n`);
  for (;;) {
    const step = nextStep(instrument, state);
    if (step.kind === "end") {
      finished = true;
      break;
    }
    for (const line of linesForStep(script, step)) console.log(`INTERVIEWER: ${line.text}`);
    if (step.kind === "statement") {
      state = markHeard(instrument, state, step.item.id);
      continue;
    }
    const reply = await ask("RESPONDENT: ");
    if (reply === null) {
      console.log("\n(stopped early)");
      break;
    }
    const reading = readTypedAnswer(step.item, reply);
    const problem = reading.kind === "answer" ? validateAnswer(step.item, reading.answer) : "That does not match an option.";
    if (reading.kind !== "answer" || problem) {
      console.log(`(not recorded: ${problem})`);
      continue;
    }
    state = recordAnswer(instrument, state, step.slot.key, reading.answer);
  }
  ask.close();
  if (out) {
    const record = { caseId: `typed-${startedAt.getTime()}`, startedAt, endedAt: new Date(), finished, state, embedded: { vv_mode: "typed_test", vv_script: script.hash.slice(0, 12) } };
    const csv = writeResponsesCsv(instrument, [record]);
    if (existsSync(out)) appendFileSync(out, csv.split("\r\n").slice(3).join("\r\n"));
    else writeFileSync(out, csv);
    console.log(`\nSaved to ${out}`);
  }
  return 0;
}

async function main(): Promise<number> {
  const { positionals, values } = parseArgs({ allowPositionals: true, options: { out: { type: "string" } } });
  const [command, path] = positionals;
  if (!command || !path || !["check", "interview"].includes(command)) {
    console.error(USAGE);
    return 2;
  }
  if (command === "interview") return interview(path, values.out);
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
