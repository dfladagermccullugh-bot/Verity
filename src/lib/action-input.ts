/**
 * Runtime validation for values that arrive from the browser through server
 * actions. TypeScript types do not survive the network boundary.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isTurnId(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v);
}

/** Longest believable time on one yes/no question; longer is an idle tab. */
export const MAX_ANSWER_MS = 60 * 60 * 1000;

const DEVICE_CLASSES = new Set(["mobile", "tablet", "desktop"]);

export interface CleanParadata {
  timeToAnswerMs: number | null;
  deviceClass: string | null;
  viewport: string | null;
}

/** Clamp client paradata to plausible values; anything else becomes null. */
export function sanitizeParadata(input: unknown): CleanParadata {
  const p = (typeof input === "object" && input !== null ? input : {}) as Record<string, unknown>;
  const ms = p.timeToAnswerMs;
  const timeToAnswerMs =
    typeof ms === "number" && Number.isFinite(ms) && ms >= 0
      ? Math.min(Math.round(ms), MAX_ANSWER_MS)
      : null;
  const deviceClass =
    typeof p.deviceClass === "string" && DEVICE_CLASSES.has(p.deviceClass) ? p.deviceClass : null;
  const viewport =
    typeof p.viewport === "string" && /^\d{1,5}x\d{1,5}$/.test(p.viewport) ? p.viewport : null;
  return { timeToAnswerMs, deviceClass, viewport };
}
