"use server";

import { timingSafeEqual } from "node:crypto";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { invites } from "@/lib/db/schema";
import { createInviteToken } from "@/lib/tokens";
import { getAdminSession, isAdmin } from "@/lib/session";

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export async function login(_prev: unknown, formData: FormData): Promise<{ error?: string }> {
  const password = String(formData.get("password") ?? "");
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) return { error: "Admin password is not configured." };
  if (!safeEqual(password, expected)) return { error: "Incorrect password." };

  const session = await getAdminSession();
  session.isAdmin = true;
  await session.save();
  redirect("/admin/prds");
}

export async function logout(): Promise<void> {
  const session = await getAdminSession();
  session.destroy();
  redirect("/admin/login");
}

function baseUrl(): string {
  const env = process.env.NEXT_PUBLIC_BASE_URL;
  if (env) return env.replace(/\/$/, "");
  const h = headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? "http";
  return `${proto}://${host}`;
}

export async function createInvite(
  _prev: unknown,
  formData: FormData
): Promise<{ url?: string; error?: string }> {
  if (!(await isAdmin())) return { error: "Not authorized." };

  const name = String(formData.get("name") ?? "").trim();
  const note = String(formData.get("note") ?? "").trim() || null;
  if (!name) return { error: "Invitee name is required." };

  const token = createInviteToken();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  await db.insert(invites).values({
    token,
    inviteeName: name,
    note,
    createdAt: now,
    expiresAt,
  });

  return { url: `${baseUrl()}/i/${token}` };
}
