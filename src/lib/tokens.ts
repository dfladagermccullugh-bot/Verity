import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

function secret(): string {
  const s = process.env.INVITE_SIGNING_SECRET;
  if (!s) throw new Error("INVITE_SIGNING_SECRET is not set");
  return s;
}

function b64url(buf: Buffer): string {
  return buf.toString("base64url");
}

function sign(payload: string): string {
  return b64url(createHmac("sha256", secret()).update(payload).digest());
}

/** Returns a signed single-use token of the form <random>.<sig>. */
export function createInviteToken(): string {
  const payload = b64url(randomBytes(18));
  return `${payload}.${sign(payload)}`;
}

/** Verifies the HMAC. DB lookup + consumed_at enforces single-use. */
export function verifyInviteToken(token: string): boolean {
  const parts = token.split(".");
  if (parts.length !== 2) return false;
  const [payload, sig] = parts;
  const expected = sign(payload);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
