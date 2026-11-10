/**
 * Verity Voice — AI voice survey interviewers on top of Qualtrics.
 * Phase 0 scaffold: no product behaviour yet. Plan: ../voice-interviewer-plan.md.
 */

export const PACKAGE_NAME = "verity-voice";

/** Oldest Node release the package supports (matches `engines` in package.json). */
export const MIN_NODE = { major: 22, minor: 13 } as const;

export function nodeIsSupported(version: string = process.versions.node): boolean {
  const [major = 0, minor = 0] = version.split(".").map(Number);
  return major > MIN_NODE.major || (major === MIN_NODE.major && minor >= MIN_NODE.minor);
}
