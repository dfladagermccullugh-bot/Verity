import "server-only";
import { getIronSession, type SessionOptions } from "iron-session";
import { cookies } from "next/headers";

export interface AdminSession {
  isAdmin?: boolean;
}

function sessionOptions(): SessionOptions {
  const password = process.env.SESSION_COOKIE_SECRET;
  if (!password || password.length < 32) {
    throw new Error("SESSION_COOKIE_SECRET must be set and at least 32 chars");
  }
  return {
    password,
    cookieName: "idea_seeder_admin",
    cookieOptions: {
      secure: process.env.NODE_ENV === "production",
      httpOnly: true,
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 30,
    },
  };
}

export async function getAdminSession() {
  return getIronSession<AdminSession>(cookies(), sessionOptions());
}

export async function isAdmin(): Promise<boolean> {
  const s = await getAdminSession();
  return s.isAdmin === true;
}
