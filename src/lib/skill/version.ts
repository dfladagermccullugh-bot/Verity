import { createHash } from "node:crypto";
import skillText from "./idea-seeding-agent.md";

// idea-seeding-agent.md is the single source of truth; webpack inlines it
// as a string at build time (see next.config.mjs).
const TEXT: string = skillText as unknown as string;
const VERSION = createHash("sha256").update(TEXT).digest("hex").slice(0, 12);

export function getSkillPrompt(): string {
  return TEXT;
}

export function getSkillVersion(): string {
  return VERSION;
}
