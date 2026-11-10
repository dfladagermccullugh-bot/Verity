import { notFound } from "next/navigation";
import Harness from "./harness";

export const dynamic = "force-dynamic";

/**
 * Development-only harness: the real interview client with stubbed actions,
 * for the Playwright check in scripts/e2e/interview-client.mjs. Returns 404
 * in production builds (Vercel previews included).
 */
export default function InterviewHarnessPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <Harness />;
}
