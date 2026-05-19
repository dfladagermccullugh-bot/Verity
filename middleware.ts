import { NextResponse, type NextRequest } from "next/server";
import { unsealData } from "iron-session";

const WINDOW_MS = 60_000;
const MAX_REQ = 80;
const buckets = new Map<string, { count: number; resetAt: number }>();

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const b = buckets.get(ip);
  if (!b || b.resetAt < now) {
    buckets.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }
  b.count += 1;
  return b.count > MAX_REQ;
}

async function isAdminRequest(req: NextRequest): Promise<boolean> {
  const cookie = req.cookies.get("idea_seeder_admin")?.value;
  if (!cookie) return false;
  const password = process.env.SESSION_COOKIE_SECRET;
  if (!password) return false;
  try {
    const data = await unsealData<{ isAdmin?: boolean }>(cookie, { password });
    return data.isAdmin === true;
  } catch {
    return false;
  }
}

export async function middleware(req: NextRequest) {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown";

  if (rateLimited(ip)) {
    return new NextResponse("Too many requests", { status: 429 });
  }

  const { pathname } = req.nextUrl;
  if (pathname.startsWith("/admin") && pathname !== "/admin/login") {
    if (!(await isAdminRequest(req))) {
      const url = req.nextUrl.clone();
      url.pathname = "/admin/login";
      url.search = "";
      return NextResponse.redirect(url);
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
