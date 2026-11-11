/**
 * The report for a finished (or running) campaign: what happened to every case, the standard
 * outcome rates, answer-quality signals, what a person still needs to check, and a methodology
 * disclosure covering the AI-specific items in AAPOR's Transparency Initiative.
 */

import type { Store, Campaign, Case, Attempt } from "../dialer/store.js";
import { DEFAULT_SETTINGS } from "../dialer/rules.js";
import { AI_DISCLOSURE, buildProtocol } from "../interviewer/protocol.js";
import { analyzeQuality, completionShare, renderQualityMarkdown, type InterviewRecord as QualityRecord } from "../quality/analysis.js";
import { summarizeDispositions, type CaseHistory, type DispositionSummary, type RateName } from "../quality/dispositions.js";
import { buildScript } from "../script/script.js";

export interface ReportContext {
  /** Who ran the study, for the disclosure. */
  researcher: string;
  /** How the people called were recruited, in a sentence. */
  recruitment: string;
  /** Identifier of the model that read unclear replies, or null when only rules were used. */
  classifier: string | null;
  /** Identifier of the voice that spoke the script. */
  voice: string;
  /** Identifier of the speech recogniser. */
  recogniser: string;
  /** How the calls were carried: "simulated", "browser" or "telephone". */
  transport: string;
}

const RATE_NOTES: Partial<Record<RateName, string>> = {
  RR1: "Response rate, completes only",
  RR2: "Response rate, completes and partials",
  COOP1: "Cooperation rate, completes only, among those reached",
  REF1: "Refusal rate",
  CON1: "Contact rate",
};

const pct = (x: number | null) => (x === null ? "n/a" : `${(100 * x).toFixed(1)}%`);
const day = (d: Date) => d.toISOString().slice(0, 10);

function histories(campaign: Campaign, cases: Case[], attempts: Attempt[]): CaseHistory[] {
  return cases.map((c) => {
    const share = completionShare(campaign.instrument, c.interview.answers) ?? 0;
    const mine = attempts.filter((a) => a.caseId === c.id && a.outcome !== null).sort((a, b) => a.number - b.number);
    return {
      attempts: mine.map((a, i) => ({
        outcome: a.outcome!,
        // Answers accumulate across calls, so the share answered belongs to the last call that reached the person.
        ...(a.outcome === "complete" || a.outcome === "breakoff" ? { completion: i === mine.length - 1 || mine.slice(i + 1).every((x) => x.outcome !== "complete" && x.outcome !== "breakoff") ? share : 0 } : {}),
      })),
    };
  });
}

function dispositionTable(d: DispositionSummary): string[] {
  const out = ["| AAPOR code | Final disposition | Cases |", "|---|---|---|"];
  for (const row of d.byCode) out.push(`| ${row.code} | ${row.label} | ${row.count} |`);
  return out;
}

export async function campaignReport(store: Store, campaignId: string, ctx: ReportContext): Promise<string> {
  const campaign = await store.getCampaign(campaignId);
  const allCases = await store.listCases(campaignId);
  const attempts = await store.listAttempts(campaignId);
  const sample = allCases.filter((c) => c.consent !== null);
  const excluded = allCases.length - sample.length;
  const settings = { ...DEFAULT_SETTINGS, ...campaign.settings };
  const script = buildScript(campaign.instrument);
  const protocol = buildProtocol(campaign.wording);
  const line = (key: string) => protocol.find((l) => l.key === key)?.text ?? "";

  // Everyone in the sample asked to be called, so all are eligible: cases never reached count as
  // eligible non-respondents (AAPOR's guidance for lists of known-eligible people). This lowers
  // the rates compared with treating them as "unknown eligibility".
  const dispositions = summarizeDispositions(histories(campaign, sample, attempts), { rules: { eligibility: "assumed" }, e: 1 });

  const interviewed = sample.filter((c) => Object.keys(c.interview.answers).length > 0);
  const quality = analyzeQuality(
    campaign.instrument,
    interviewed.map((c): QualityRecord => ({ id: c.externalRef ?? c.id, answers: c.interview.answers, review: c.review, finished: c.finalOutcome === "complete", latencyMs: c.latencyMs })),
  );
  const ref = (c: Case) => c.externalRef ?? c.id;
  const flagged = interviewed.filter((c) => c.review.length > 0).sort((a, b) => ref(a).localeCompare(ref(b)));
  const dnc = (await store.doNotCallList()).filter((d) => sample.some((c) => c.phone === d.phone));
  const ended = attempts.filter((a) => a.endedAt);
  const minutes = ended.reduce((n, a) => n + (a.endedAt!.getTime() - a.startedAt.getTime()) / 60_000, 0);

  const out: string[] = [];
  out.push(`# ${campaign.name}: field report`, "");
  out.push(`Survey: **${campaign.instrument.name}** (${campaign.instrument.items.filter((i) => i.kind !== "statement").length} questions). Mode: AI voice interviewer, ${ctx.transport}.`);
  if (ended.length > 0) out.push(`Field period: ${day(ended[0]!.startedAt)} to ${day(ended[ended.length - 1]!.endedAt!)}. Calls placed: ${ended.length}. Call time: ${minutes.toFixed(0)} minutes.`);
  out.push("");

  out.push("## 1. What happened to each case", "");
  out.push(`Sample: ${sample.length} people with consent on file.${excluded > 0 ? ` ${excluded} contact${excluded === 1 ? "" : "s"} had no valid consent on file and ${excluded === 1 ? "was" : "were"} never called; ${excluded === 1 ? "it is" : "they are"} not part of the sample.` : ""}`, "");
  out.push(...dispositionTable(dispositions), "");
  out.push(`Calls per case: mean ${dispositions.attempts.mean === null ? "n/a" : dispositions.attempts.mean.toFixed(2)}, most ${dispositions.attempts.max}. Removed from the call list at their own request: ${dnc.length}.`, "");

  out.push("## 2. Outcome rates", "");
  out.push("Calculated with the formulas in AAPOR *Standard Definitions* (10th edition, 2023). Everyone sampled had asked to be called, so all are counted as eligible (e = 1) and people never reached count against the rates.", "");
  out.push("| Rate | Value | Meaning |", "|---|---|---|");
  for (const name of ["RR1", "RR2", "COOP1", "REF1", "CON1"] as RateName[]) out.push(`| ${name} | ${pct(dispositions.rates[name])} | ${RATE_NOTES[name]} |`);
  out.push("", "These describe how many of the people on the list took part. They are not the response rate of a probability sample, and no margin of sampling error applies.", "");

  out.push("## 3. Answer quality", "");
  out.push(renderQualityMarkdown(quality).replace(/^#+ .*\n+/, ""), "");

  out.push("## 4. For a person to check", "");
  if (flagged.length === 0) out.push("No answers were flagged for human review.", "");
  else {
    out.push(`${flagged.reduce((n, c) => n + c.review.length, 0)} answers in ${flagged.length} interviews were flagged: the reading was uncertain after probing, no usable answer was given, or the respondent answered before hearing the whole question. Each has a full audit trail.`, "");
    out.push("| Case | Flagged questions |", "|---|---|", ...flagged.map((c) => `| ${ref(c)} | ${c.review.join(", ")} |`), "");
  }

  out.push("## 5. Methodology disclosure", "");
  out.push("Follows the AAPOR Transparency Initiative's disclosure items, including those that apply when AI conducts interviews: the script and instructions used, the mode, the tasks the AI performed, and how people oversaw them.", "");
  out.push(`- **Who conducted the study:** ${ctx.researcher}.`);
  out.push(`- **Population and recruitment:** ${ctx.recruitment} This is a list of volunteers, not a probability sample; results describe these respondents only.`);
  out.push(`- **Mode:** telephone interview conducted by an AI voice assistant (${ctx.transport}), in English.`);
  out.push(`- **Questionnaire:** built in Qualtrics and read by this system from its survey file. Question and answer wording was spoken exactly as written. The complete list of everything the interviewer could say is fixed in advance and identified by script version \`${campaign.speechHash.slice(0, 12)}\` (${script.lines.length} survey lines, ${protocol.length} call-handling lines).`);
  out.push(`- **What respondents were told first:** "${line("intro")} ${line("purpose")} ${line("transcribed")} ${line("how_to_stop")}" They were then asked: "${line("consent_ask")}" No question was asked without a clear yes.`);
  out.push(`- **Tasks performed by AI:**`);
  out.push(`  - *Speaking.* A synthetic voice (${ctx.voice}) read the fixed script. Each line was rendered once and replayed, so every respondent heard the same recording. The AI did not compose, reword or add anything. The interviewer identified itself as AI in its first sentence ("${AI_DISCLOSURE}").`);
  out.push(`  - *Listening.* Speech was transcribed by ${ctx.recogniser}.`);
  out.push(`  - *Coding answers.* Fixed rules coded replies that exactly matched an option, a number or a keypad press. ${ctx.classifier ? `Other replies were read by a language model (${ctx.classifier}), which returned a code, a confidence and the respondent's words it relied on. A reading was used only if the code was a real option and those words were actually in the transcript.` : "No language model was used; replies the rules could not code were probed."}`);
  out.push(`  - *Probing.* When a reply was unclear or uncertain (confidence below ${campaign.policy.acceptAt}), the interviewer used one of a fixed set of neutral probes, at most ${campaign.policy.maxProbes} per question, then coded the question as not answered. It never explained a question and never commented on an answer.`);
  out.push(`- **Human oversight:** every line spoken, every transcript, every reading and every decision is kept in an append-only log. ${flagged.length === 0 ? "No answers were flagged for review." : `${flagged.reduce((n, c) => n + c.review.length, 0)} answers were flagged for a person to check (section 4).`} Open-ended answers are the respondent's own transcribed words, not a summary.`);
  out.push(`- **Contact rules:** calls only to people with consent on file no older than ${settings.consentValidDays} days; ${settings.window.startHour}:00 to ${settings.window.endHour}:00 in the respondent's local time; at most ${settings.maxAttempts} calls per person; no messages left on answering machines; a request to be removed was honoured immediately and permanently.`);
  out.push(`- **Recording:** ${campaign.wording.askRecording ? "audio was kept only for respondents who separately agreed to it." : "no audio was kept. Transcripts were kept."}`);
  out.push(`- **Limitations:** speech recognition makes errors, more so with accents, noise and weak lines; answers by voice can differ from answers on screen (mode effects); the measures in section 3 are screening signals, not proof of good or poor data.`);
  out.push("");
  return out.join("\n");
}
