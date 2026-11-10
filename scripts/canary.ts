#!/usr/bin/env node
/**
 * Reliability canary runner — invoked via `npm run canary` and
 * `npm run canary:rebaseline`. Implements the continuous-monitoring
 * recommendation in AAPOR 2026 §4.1.3 + §4.2.4: periodically reprocess a
 * fixed reference dataset and surface deviations beyond a stated tolerance.
 *
 * Runs entirely off the DB. Hits the live Anthropic API with whatever model
 * id the production app reads from `getModelName()`, so it detects silent
 * provider-side changes alongside any local prompt or guard edits.
 */

import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

import seeds from "../src/lib/canaries/seeds.json";
import { runOne, liveModelName } from "../src/lib/canaries/run-one";
import { compareToBaseline, formatReport } from "../src/lib/canaries/compare";
import { callModelWithSystem } from "../src/lib/model-client";
import type { ModelFn } from "../src/lib/interview-policy";
import type { Baseline, SeedFixture, SeedMetrics } from "../src/lib/canaries/types";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BASELINE_PATH = resolve(REPO_ROOT, "src/lib/canaries/baseline.json");
// The app inlines this file through webpack; the script reads it from disk so
// the canary sends the exact same system prompt.
const SKILL_PATH = resolve(REPO_ROOT, "src/lib/skill/idea-seeding-agent.md");

/**
 * Exit codes. Drift uses a dedicated code so a crash (Node exits 1 on an
 * uncaught error) can never be mistaken for drift by the workflow.
 */
export const EXIT = { ok: 0, config: 2, fixture: 3, drift: 10 } as const;

async function loadBaseline(): Promise<Baseline> {
  const raw = await readFile(BASELINE_PATH, "utf-8");
  const parsed = JSON.parse(raw);
  // Strip the human-only _comment field so it doesn't survive a rebaseline write.
  return { model: parsed.model ?? null, seeds: parsed.seeds ?? {} };
}

async function saveBaseline(b: Baseline): Promise<void> {
  const out = {
    _comment:
      "Reliability baseline for the canary suite (AAPOR §4.2.4). The model id is checked exactly; per-seed metrics are checked against the tolerances defined in src/lib/canaries/compare.ts. Regenerate intentionally with `npm run canary:rebaseline` — never automate that step.",
    model: b.model,
    seeds: b.seeds,
  };
  await writeFile(BASELINE_PATH, JSON.stringify(out, null, 2) + "\n", "utf-8");
}

function shortPreview(metrics: SeedMetrics): string {
  return [
    `turns=${metrics.turnCount}`,
    `reject=${metrics.guardRejectRate}`,
    `len=${metrics.meanQuestionLengthChars}`,
    `headings=${metrics.prdHeadingsPresent.length}`,
    `natural=${metrics.terminatedNaturally}`,
  ].join(" ");
}

async function main(): Promise<number> {
  const rebaseline = process.argv.includes("--rebaseline");
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("ANTHROPIC_API_KEY is required to run the canary.");
    return EXIT.config;
  }

  // Check the baseline before spending: without one there is nothing to
  // compare against, so only a rebaseline run may call the model.
  const baseline = await loadBaseline();
  const unbaselined = baseline.model === null || Object.keys(baseline.seeds).length === 0;
  if (!rebaseline && unbaselined) {
    console.log(
      "No baseline on file. This is expected on first run. Re-run with `npm run canary:rebaseline` and commit the result.",
    );
    return EXIT.ok;
  }

  const skillPrompt = await readFile(SKILL_PATH, "utf-8");
  const model: ModelFn = (messages) => callModelWithSystem(skillPrompt, messages);

  const fixtures = seeds as SeedFixture[];
  const liveModel = liveModelName();
  console.log(`Canary run — model: ${liveModel} — ${fixtures.length} fixtures`);
  console.log("");

  const observed: Record<string, SeedMetrics> = {};
  for (const fx of fixtures) {
    process.stdout.write(`  · ${fx.id.padEnd(35)} `);
    const t0 = Date.now();
    try {
      const metrics = await runOne(fx, model);
      const ms = Date.now() - t0;
      observed[fx.id] = metrics;
      console.log(`${shortPreview(metrics)}  (${(ms / 1000).toFixed(1)}s)`);
    } catch (err) {
      console.log(`ERROR — ${(err as Error).message}`);
      return EXIT.fixture;
    }
  }
  console.log("");

  if (rebaseline) {
    await saveBaseline({ model: liveModel, seeds: observed });
    console.log(`Wrote new baseline to ${BASELINE_PATH}.`);
    console.log("Review the diff with `git diff src/lib/canaries/baseline.json` before committing.");
    return EXIT.ok;
  }

  const report = compareToBaseline(liveModel, baseline, observed);
  console.log(formatReport(liveModel, report));
  return report.driftFound ? EXIT.drift : EXIT.ok;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(err);
    process.exit(EXIT.config);
  },
);
