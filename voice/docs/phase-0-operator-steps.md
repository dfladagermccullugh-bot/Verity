# Phase 0 — steps for the operator

Four jobs only you can do, because they need your logins. About 45 minutes in total.
Do them in this order. Menu names may differ slightly from what you see; if a step does
not match, note what you saw and ask.

## A. Archive the old Verity sessions (10 minutes)

Two copies, because each catches what the other misses.

**A1. Download the export file.**

1. Log in to the live Verity admin page (`/admin/login` on your site).
2. In the same browser, open `/api/admin/export` on your site. A file named
   `training-data-<date>.json` downloads.
3. Open it in a text editor and search for `"session_id"`. Write down how many matches
   there are. That is the number of sessions in the file.
4. Store the file somewhere private that you back up. **Do not put it in the repo folder.**

This file holds every question, answer and PRD. It leaves out invitee names, the construct
brief and the methodology text, which is why A2 exists.

**A2. Make a frozen full copy inside Neon.**

1. Log in to the Neon console and open the Verity project.
2. Open **Branches** → **Create branch**. Branch from your main (production) branch, as of
   now. Name it `archive-2026-11`.
3. Do not connect anything to this branch. It is a complete copy; leave it alone.

Whether your Neon plan allows an extra branch was not checked. If it does not, say so
and I will give you a one-command alternative.

**A3. Count the live rows.**

In the Neon console, open **SQL Editor**, make sure the main branch is selected, and run:

```sql
select
  (select count(*) from sessions) as sessions,
  (select count(*) from rounds)   as rounds,
  (select count(*) from turns)    as turns,
  (select count(*) from invites)  as invites;
```

**Send me:** the four numbers, and the count from A1 step 3. The `sessions` number and
the A1 count must match. Nothing in this step changes any data.

## B. Change the leaked database password (10 minutes)

An old copy of the database password is in this repo's history. Once the password is
changed, that old copy is useless, and the repo can be made public safely. **Do this
before making the repo public.** Do A first.

1. Neon console → the Verity project → **Roles** (may be under "Roles & Databases") → the
   role your app uses → **Reset password**. Copy the new connection string.
2. Vercel → the Verity project → **Settings** → **Environment Variables** → `DATABASE_URL`.
   Replace the value for Production and Preview. Save.
3. Vercel → **Deployments** → the current production deployment → **Redeploy**.
4. Open the live site's admin page and check that the session list loads.
5. If you keep a copy of the old connection string on your own computer (for example in
   `.claude/settings.local.json` or a `.env.local` file), update it there too.

**Send me:** "password rotated, admin page loads" — not the password or connection string.

## C. The Qualtrics check (20 minutes)

Follow [`qualtrics-test-survey.md`](qualtrics-test-survey.md). It ends with a list of
files and notes to send back.

## D. Tag the old code (2 minutes)

A tag is a permanent bookmark on the old app's code, so it can always be found again.
It could not be created from the build session (that session may only push its own branch).

1. On GitHub, open the repo → **Releases** → **Draft a new release**.
2. **Choose a tag** → type `idea-seeder-v1` → **Create new tag**. Target: `main`.
   Do this before any Verity Voice work is merged into `main`.
3. Title: `Legacy Verity web app`. Publish.

## What happens next

When A, B, C and D are done, Phase 0 is verified and closed, and Phase 1 (survey file in,
responses out) can start on your "go".
