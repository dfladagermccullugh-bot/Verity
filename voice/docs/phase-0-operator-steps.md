# What still needs the operator

The build does not wait on any of this. These are the few things that cannot be done
from the build session, because they need a login it has no way to hold.

| | What | Why only you | Time | When |
|---|---|---|---|---|
| **B** | Change the leaked database password | Needs your Neon and Vercel logins | 10 min | **Before the repo is made public** |
| **A** | Archive the old Verity sessions | Needs database access | 2 min to connect Neon, or 10 min by hand | Before the old app is switched off |
| **C** | Qualtrics import check | Needs your Qualtrics login | 10 min | Any time |

Done without you: the old code is bookmarked as branch `legacy/idea-seeder-v1` (a tag
could not be pushed from the build session; the branch does the same job).

## B. Change the leaked database password

An old copy of the database password is in this repo's history. Changing the password
makes that copy useless; the repo can then be made public safely.

1. Neon console → the Verity project → **Roles** (may be under "Roles & Databases") → the
   role your app uses → **Reset password**. Copy the new connection string.
2. Vercel → the Verity project → **Settings** → **Environment Variables** → `DATABASE_URL`.
   Replace the value for Production and Preview. Save.
3. Vercel → **Deployments** → the current production deployment → **Redeploy**.
4. Open the live site's admin page and check that the session list loads.

The build session cannot do this: it has no Neon or Vercel login, the Vercel connector
cannot edit settings, and it is not permitted to use the old password from the history.

## A. Archive the old sessions

**Easiest:** connect the **Neon** connector in your claude.ai connector settings, then
say "Neon is connected". The build session will then make a frozen copy
(`archive-2026-11`), count the rows and confirm the copy matches. No other step.

**By hand, if you prefer:**

1. Log in to the live Verity admin page, then open `/api/admin/export` on the same site.
   A file `training-data-<date>.json` downloads. Keep it somewhere private, **never in
   the repo folder**. It leaves out invitee names, the construct brief and the
   methodology text.
2. Neon console → **Branches** → **Create branch** from main, named `archive-2026-11`.
   That is a complete copy; leave it alone.
3. Neon console → **SQL Editor** on the main branch, run the query below, and send the
   four numbers.

```sql
select
  (select count(*) from sessions) as sessions,
  (select count(*) from rounds)   as rounds,
  (select count(*) from turns)    as turns,
  (select count(*) from invites)  as invites;
```

## C. Qualtrics import check

See [`qualtrics-test-survey.md`](qualtrics-test-survey.md).
