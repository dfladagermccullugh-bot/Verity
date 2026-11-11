# What still needs you

Everything that could be built and tested without an account login has been. What is left
needs a login, a payment, or a decision only you can make. Nothing below is urgent except B.

| | What | Why only you | Time |
|---|---|---|---|
| **B** | Change the leaked database password | Needs your Neon and Vercel logins | 10 min, **before the repo is made public** |
| **C** | Qualtrics import check | Needs your Qualtrics login | 10 min |
| **E** | Turn on the language model | Needs an Anthropic API key in the server's settings | 5 min |
| **F** | Put the demo online | Needs your Fly.io login | 15 min |
| **D** | Give the demo a real voice and real hearing | Needs a Deepgram account | 10 min |
| **G** | Compare the voices | Needs a Cartesia account as well | 15 min |
| **H** | First real phone call, to your own phone | Needs your Telnyx and Deepgram keys | 30 min |
| **I** | Call anyone other than yourself | Needs a lawyer's review of the consent wording | — |

Done without you: the old sessions are archived (a Neon copy named `archive-2026-11`,
checked against the live counts: 15 sessions, 8 rounds, 225 turns, 18 invites), and the old
code is bookmarked as branch `legacy/idea-seeder-v1`.

Keys are secrets. Enter them as GitHub repository secrets (the deploy job hands them to the
server) or in the host's secret settings, never in a file in this repo and never in a chat.

## B. Change the leaked database password

An old copy of the old app's database password is in this repo's history. Changing the
password makes that copy useless; the repo can then be made public safely.

1. Neon console → the Verity project → **Roles** → the role your app uses → **Reset
   password**. Copy the new connection string.
2. Vercel → the Verity project → **Settings** → **Environment Variables** → `DATABASE_URL`.
   Replace the value for Production and Preview. Save.
3. Vercel → **Deployments** → the current production deployment → **Redeploy**.
4. Open the live site's admin page and check that the session list loads.

Why this was not done for you: resetting the password takes the live site down until
Vercel has the new one, and there is no access to Vercel from the build session.

## C. Qualtrics import check

See [`qualtrics-test-survey.md`](qualtrics-test-survey.md). It answers the one open question
about a free account (can it import responses?) and replaces a hand-written test file with a
real export.

## E. Turn on the language model

Without a key the interviewer understands exact answers only ("About once a month", "the
third one", "eight") and probes everything else. With `ANTHROPIC_API_KEY` set it also reads
natural replies, each checked in code before it counts.

Then measure it, once, from `voice/`:

```bash
npm run eval -- --live --wrong
```

This costs a few cents. The number to look at is "wrong answers that would be recorded
without a probe". The weekly check (`voice-eval.yml`) starts working once the repo secret
`ANTHROPIC_API_KEY` is the same key.

## F. Put the demo online

From `voice/`, with the Fly.io command-line tool installed and logged in:

```bash
fly launch --no-deploy --copy-config
```

```bash
fly deploy
```

The page at the address Fly prints is the public demo. It needs no keys. The container
image has not been built anywhere yet, so expect the first deploy to need a small fix.

## D. Give the demo a real voice and real hearing

Until this is done the demo page speaks and listens with the browser's built-in speech.

1. Create an account at <https://console.deepgram.com> and make an API key (**API Keys** →
   **Create a New API Key**). Copy it.
2. GitHub → this repository → **Settings** → **Secrets and variables** → **Actions** →
   **New repository secret**. Name: `DEEPGRAM_API_KEY`. Paste the key. **Add secret**.
3. Run the deploy job (Actions → **voice-deploy** → **Run workflow**), or ask Claude to.

The demo then hears through Deepgram and speaks with a Deepgram voice, and the ribbon moves
with the actual sound. This is the first time that code meets the real service, so expect
something to need fixing. By default the microphone is not listened to while the interviewer
is speaking, because through loudspeakers it can hear the interviewer's own voice; cutting in
by voice is a setting (`DEMO_BARGE_IN=1`) to try with headphones first.

## G. Compare the voices

Needs D, and a Cartesia account: <https://play.cartesia.ai> → an API key, and the ID of a
voice you like from its voice library. Add both as repository secrets, `CARTESIA_API_KEY` and
`CARTESIA_VOICE_ID`, the same way as in D.

Then run the **voice-deploy** job with the task set to **compare-voices** (it deploys
nothing). It renders every line of the script with each voice, has the recogniser hear each
back and scores the match, checks the streaming recogniser, and keeps all the audio as a
download named `voice-comparison` on the job's page. Listen on a phone speaker, not
headphones. With the Cartesia secrets set, the demo speaks with the Cartesia voice.

The same comparison from a shell, with the keys in the environment, from `voice/`:

```bash
npm run bakeoff -- --out bakeoff
```

## H. First real phone call, to your own phone

The phone path has only ever run against a simulated carrier. Expect the first real call to
need fixes; that is what this step is for.

1. Create a separate database for Verity Voice (a new Neon project; not the old Verity one).
2. Make a contact file with one row: your own number, and consent columns filled in.
3. From `voice/`, with `DATABASE_URL` set: `npm run verity -- campaign create …` then
   `campaign start <id>` (the commands print what to do next).
4. Give the server these secrets: `DATABASE_URL`, `DIAL_CAMPAIGN_ID`, `PUBLIC_BASE_URL`,
   `TELNYX_API_KEY`, `TELNYX_CONNECTION_ID`, `TELNYX_FROM_NUMBER`, `TELNYX_PUBLIC_KEY`,
   `DEEPGRAM_API_KEY`, `CARTESIA_API_KEY`, `CARTESIA_VOICE_ID`, and
   **`DIAL_ALLOWLIST` set to your own number only**. The server will refuse every other number.
5. In Telnyx, point the connection's webhook at `<PUBLIC_BASE_URL>/telnyx/webhook`.

Things to confirm on that first call are listed at the top of `src/telephony/telnyx.ts`.

## I. Calling anyone other than yourself

`DIAL_ALLOWLIST=campaign` lifts the limit. Do not set it until a lawyer has reviewed the
consent wording in [`pilot-kit.md`](pilot-kit.md) against US call law (TCPA and state
recording rules), or an ethics board has if you are university-affiliated.
