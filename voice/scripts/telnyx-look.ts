/**
 * A read-only look at a Telnyx account: what is needed for a first call, and what is already
 * there. It changes nothing. Phone numbers are shown by their last four digits only.
 *
 *   TELNYX_API_KEY=… npx tsx scripts/telnyx-look.ts [https://the-server's-public-address]
 */
const key = process.env.TELNYX_API_KEY;
if (!key) {
  console.error("TELNYX_API_KEY is not set.");
  process.exit(2);
}
const base = process.argv[2] ?? "";
const want = base ? `${base.replace(/\/$/, "")}/telnyx/webhook` : null;

async function list(path: string): Promise<Record<string, any>[]> {
  const res = await fetch(`https://api.telnyx.com/v2${path}`, { headers: { Authorization: `Bearer ${key}` } });
  if (!res.ok) throw new Error(`Telnyx answered HTTP ${res.status} for ${path.split("?")[0]}: ${(await res.text()).slice(0, 200)}`);
  return ((await res.json()) as { data?: Record<string, any>[] }).data ?? [];
}
const tail = (n: unknown) => `…${String(n ?? "").slice(-4)}`;

let failed = false;
const section = async (title: string, run: () => Promise<void>) => {
  console.log(`\n## ${title}`);
  try {
    await run();
  } catch (err) {
    failed = true;
    console.log(`Could not read this: ${err instanceof Error ? err.message : String(err)}`);
  }
};

await section("Phone numbers", async () => {
  const numbers = await list("/phone_numbers?page[size]=50");
  if (numbers.length === 0) console.log("None. A number is needed to call from.");
  for (const n of numbers) console.log(`- ${tail(n.phone_number)}  status: ${n.status}  attached to: ${n.connection_name || "nothing"} (${n.connection_id || "no connection"})`);
});

await section("Voice API applications (the server needs one of these; its ID is the connection ID)", async () => {
  const apps = await list("/call_control_applications?page[size]=50");
  if (apps.length === 0) console.log("None. One has to be created, with its webhook pointing at the server.");
  for (const a of apps) {
    const hook = String(a.webhook_event_url ?? "");
    console.log(`- "${a.application_name}"  id: ${a.id}  active: ${a.active}  webhook: ${hook || "none"}${want ? (hook === want ? "  (this server)" : "  (not this server)") : ""}  API version: ${a.webhook_api_version ?? "?"}  outbound profile: ${a.outbound?.outbound_voice_profile_id || "none"}`);
  }
});

await section("Outbound voice profiles (needed to place calls; must allow the United States)", async () => {
  const profiles = await list("/outbound_voice_profiles?page[size]=50");
  if (profiles.length === 0) console.log("None. One has to be created and attached to the application.");
  for (const p of profiles) console.log(`- "${p.name}"  id: ${p.id}  enabled: ${p.enabled}  destinations: ${(p.whitelisted_destinations ?? []).join(", ") || "none"}  connections using it: ${p.connections_count ?? "?"}`);
});

await section("Other connections on the account (not used by this server; listed so nothing is disturbed)", async () => {
  const conns = await list("/connections?page[size]=50");
  for (const c of conns) console.log(`- "${c.connection_name}"  id: ${c.id}  type: ${c.record_type}  active: ${c.active}`);
  if (conns.length === 0) console.log("None.");
});

// The key Telnyx signs its messages with. It is public by nature; only whether it can be read
// here is reported, to learn whether it has to be copied from the portal by hand.
console.log("\n## Public key");
for (const path of ["/public_key", "/webhooks/public_key"]) {
  const res = await fetch(`https://api.telnyx.com/v2${path}`, { headers: { Authorization: `Bearer ${key}` } });
  const body = await res.text();
  let found = "";
  try {
    const data = (JSON.parse(body) as { data?: Record<string, unknown> }).data ?? {};
    found = String(data.public ?? data.public_key ?? data.key ?? "");
  } catch {}
  console.log(`- GET ${path}: HTTP ${res.status}${found ? `, a key of ${found.length} characters` : `, no key in the reply (${body.slice(0, 120).replace(/\s+/g, " ")})`}`);
}

if (want) console.log(`\nThe webhook this server needs: ${want}`);
process.exit(failed ? 1 : 0);
