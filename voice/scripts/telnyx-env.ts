/**
 * Two small jobs against a Telnyx account, so that its settings need not be copied by hand.
 *
 *   npx tsx scripts/telnyx-env.ts ensure-app https://the-server
 *       Makes sure a Voice API application named "verity-voice" exists with its webhook at that
 *       server. Creates it if missing; corrects the webhook of that one application if it
 *       differs. Touches no other application, number or profile.
 *
 *   npx tsx scripts/telnyx-env.ts env
 *       Prints NAME=value lines for the settings the server needs and that were not already
 *       given in the environment: TELNYX_CONNECTION_ID (that application's ID),
 *       TELNYX_FROM_NUMBER (the account's number, when it has exactly one) and
 *       TELNYX_PUBLIC_KEY. Notes go to the error stream, never the values.
 *
 * Needs TELNYX_API_KEY.
 */
const key = process.env.TELNYX_API_KEY;
if (!key) {
  console.error("TELNYX_API_KEY is not set.");
  process.exit(2);
}
const APP_NAME = "verity-voice";
const [mode, base] = process.argv.slice(2);

async function call(method: string, path: string, body?: unknown): Promise<Record<string, any>> {
  const res = await fetch(`https://api.telnyx.com/v2${path}`, { method, headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
  if (!res.ok) throw new Error(`Telnyx answered HTTP ${res.status} for ${method} ${path.split("?")[0]}: ${(await res.text()).slice(0, 300)}`);
  return (await res.json()) as Record<string, any>;
}
const apps = async (): Promise<Record<string, any>[]> => ((await call("GET", "/call_control_applications?page[size]=100")).data ?? []).filter((a: Record<string, any>) => a.application_name === APP_NAME);

if (mode === "ensure-app") {
  if (!base || !/^https:\/\//.test(base)) throw new Error("Give the server's public https address.");
  const hook = `${base.replace(/\/$/, "")}/telnyx/webhook`;
  const found = await apps();
  if (found.length > 1) throw new Error(`There are ${found.length} applications named "${APP_NAME}"; remove the extra ones in the Telnyx portal.`);
  if (found.length === 1) {
    const app = found[0]!;
    if (app.webhook_event_url !== hook) {
      await call("PATCH", `/call_control_applications/${app.id}`, { application_name: APP_NAME, webhook_event_url: hook });
      console.log(`The "${APP_NAME}" application (${app.id}) already existed; its webhook now points at ${hook}.`);
    } else console.log(`The "${APP_NAME}" application (${app.id}) already exists and points at ${hook}. Nothing changed.`);
  } else {
    const profiles: Record<string, any>[] = (await call("GET", "/outbound_voice_profiles?page[size]=100")).data ?? [];
    const profile = profiles.find((p) => p.enabled && (p.whitelisted_destinations ?? []).includes("US"));
    if (!profile) throw new Error("No enabled outbound voice profile allows calls to the United States. One is needed before an application can place calls.");
    const made = (await call("POST", "/call_control_applications", { application_name: APP_NAME, webhook_event_url: hook, webhook_api_version: "2", active: true, outbound: { outbound_voice_profile_id: profile.id } })).data;
    console.log(`Created the "${APP_NAME}" application (${made.id}) with its webhook at ${hook}, placing calls through the "${profile.name}" outbound profile. Nothing else on the account was changed.`);
  }
} else if (mode === "env") {
  const out: string[] = [];
  if (!process.env.TELNYX_CONNECTION_ID) {
    const found = await apps();
    if (found.length === 1) out.push(`TELNYX_CONNECTION_ID=${found[0]!.id}`);
    else console.error(`TELNYX_CONNECTION_ID: ${found.length === 0 ? `no application named "${APP_NAME}" yet` : "more than one application with that name"}; not set.`);
  }
  if (!process.env.TELNYX_FROM_NUMBER) {
    const numbers: Record<string, any>[] = ((await call("GET", "/phone_numbers?page[size]=100")).data ?? []).filter((n: Record<string, any>) => n.status === "active" && /^\+1\d{10}$/.test(String(n.phone_number)));
    if (numbers.length === 1) out.push(`TELNYX_FROM_NUMBER=${numbers[0]!.phone_number}`);
    else console.error(`TELNYX_FROM_NUMBER: the account has ${numbers.length} active US numbers; say which with the TELNYX_FROM_NUMBER secret.`);
  }
  if (!process.env.TELNYX_PUBLIC_KEY) {
    const pub = String((await call("GET", "/public_key")).data?.public ?? "");
    if (pub) out.push(`TELNYX_PUBLIC_KEY=${pub}`);
    else console.error("TELNYX_PUBLIC_KEY: Telnyx returned no public key; not set.");
  }
  for (const line of out) console.error(`${line.split("=")[0]}: read from the Telnyx account.`);
  if (out.length > 0) console.log(out.join("\n"));
} else {
  console.error("Say ensure-app <https address> or env.");
  process.exit(2);
}
