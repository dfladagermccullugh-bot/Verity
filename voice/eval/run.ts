/**
 * Measure answer reading against the labelled replies.
 *
 *   npm run eval                 rules only (free, no key needed)
 *   npm run eval -- --live       rules, then Claude for what the rules leave (needs ANTHROPIC_API_KEY; costs a little)
 *   npm run eval -- --live --min-accuracy 0.9 --max-false-accepts 3    exit 10 when below the bar
 */

import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { claudeClassifier } from "../src/interviewer/claude-classifier.js";
import { readQsf } from "../src/qualtrics/qsf.js";
import { renderSummary, scoreAll, summarize } from "./score.js";

const { values } = parseArgs({ options: { live: { type: "boolean" }, model: { type: "string" }, out: { type: "string" }, "min-accuracy": { type: "string" }, "max-false-accepts": { type: "string" }, wrong: { type: "boolean" } } });
const instrument = readQsf(readFileSync(new URL("../fixtures/qualtrics/library-test.qsf", import.meta.url), "utf8")).instrument;
if (!instrument) throw new Error("The Library test survey could not be read.");

const model = values.live ? claudeClassifier(values.model ? { model: values.model } : {}) : undefined;
const scored = await scoreAll(instrument, model);
const summary = summarize(scored);
const report = renderSummary(summary, model ? `Rules, then ${model.id}` : "Rules only (no model)");
console.log(report);
if (values.wrong) for (const w of summary.wrong) console.log(`- ${w.target}: "${w.utterance}" → ${w.got} (expected ${w.expected.join(" or ")}) [${w.classification.by}${w.classification.rejected ? `, discarded: ${w.classification.rejected}` : ""}]`);
if (values.out) writeFileSync(values.out, JSON.stringify({ at: new Date().toISOString(), model: model?.id ?? null, summary: { ...summary, wrong: summary.wrong.length, falseAccepts: summary.falseAccepts.length }, scored }, null, 2));

const minAccuracy = values["min-accuracy"] ? Number(values["min-accuracy"]) : null;
const maxFalse = values["max-false-accepts"] ? Number(values["max-false-accepts"]) : null;
if ((minAccuracy !== null && summary.accuracy < minAccuracy) || (maxFalse !== null && summary.falseAccepts.length > maxFalse)) {
  console.error("Below the bar.");
  process.exit(10);
}
