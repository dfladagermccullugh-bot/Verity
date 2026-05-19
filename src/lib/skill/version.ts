import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";

const SKILL_PATH = join(process.cwd(), "src", "lib", "skill", "idea-seeding-agent.md");

let cached: { text: string; version: string } | null = null;

function load() {
  if (cached) return cached;
  const text = readFileSync(SKILL_PATH, "utf8");
  const version = createHash("sha256").update(text).digest("hex").slice(0, 12);
  cached = { text, version };
  return cached;
}

export function getSkillPrompt(): string {
  return load().text;
}

export function getSkillVersion(): string {
  return load().version;
}
