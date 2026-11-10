-- 0006 state invariants. Runs on every Vercel build (previews included), so
-- every statement is idempotent and none can fail the build: each data fix
-- and each index sits in its own block whose errors are caught and reported
-- as a WARNING. No session, answered turn or round is ever deleted; the only
-- deletion is surplus *unanswered* pending turns. Duplicate step / round
-- numbers are renumbered. A unique index whose duplicates remain is skipped,
-- not forced. A busy table makes a statement give up after 5s, not hang.
SELECT set_config('lock_timeout', '5s', true);
--> statement-breakpoint
DO $$
BEGIN
  -- Sessions completed before the rounds layer (0003) still read "active".
  -- Only rows with no rounds at all: a post-0003 session that is mid-round-2
  -- also has completed_at set and must stay active.
  UPDATE "sessions" s
  SET "status" = 'complete'
  WHERE s."status" = 'active'
    AND s."completed_at" IS NOT NULL
    AND s."prd_markdown" IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM "rounds" r WHERE r."session_id" = s."id");
EXCEPTION WHEN others THEN
  RAISE WARNING '0006: legacy status backfill skipped: %', SQLERRM;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  -- Keep exactly one unanswered turn per session: the one the app displays
  -- (lowest step, then id). Only rows with answer IS NULL are deleted.
  DELETE FROM "turns" t
  USING (
    SELECT "id",
           row_number() OVER (PARTITION BY "session_id" ORDER BY "step", "id") AS rn
    FROM "turns"
    WHERE "answer" IS NULL
  ) p
  WHERE t."id" = p."id"
    AND p.rn > 1
    AND t."answer" IS NULL;
EXCEPTION WHEN others THEN
  RAISE WARNING '0006: surplus pending-turn cleanup skipped: %', SQLERRM;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  -- Sessions with two turns at one step: renumber that session's turns
  -- 1..n in (step, answered-first, id) order. Rows are kept, order preserved.
  WITH dup AS (
    SELECT DISTINCT "session_id" FROM "turns"
    GROUP BY "session_id", "step" HAVING count(*) > 1
  ), ranked AS (
    SELECT t."id",
           row_number() OVER (
             PARTITION BY t."session_id"
             ORDER BY t."step", (t."answer" IS NULL), t."id"
           ) AS rn
    FROM "turns" t
    WHERE t."session_id" IN (SELECT "session_id" FROM dup)
  )
  UPDATE "turns" t
  SET "step" = r.rn
  FROM ranked r
  WHERE t."id" = r."id" AND t."step" <> r.rn;
EXCEPTION WHEN others THEN
  RAISE WARNING '0006: duplicate step renumbering skipped: %', SQLERRM;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  -- Sessions with two rounds at one round number: renumber that session's
  -- rounds 1..n in (round_number, started_at, id) order. Rows are kept.
  WITH dup AS (
    SELECT DISTINCT "session_id" FROM "rounds"
    GROUP BY "session_id", "round_number" HAVING count(*) > 1
  ), ranked AS (
    SELECT r."id",
           row_number() OVER (
             PARTITION BY r."session_id"
             ORDER BY r."round_number", r."started_at", r."id"
           ) AS rn
    FROM "rounds" r
    WHERE r."session_id" IN (SELECT "session_id" FROM dup)
  )
  UPDATE "rounds" r
  SET "round_number" = k.rn
  FROM ranked k
  WHERE r."id" = k."id" AND r."round_number" <> k.rn;
EXCEPTION WHEN others THEN
  RAISE WARNING '0006: duplicate round renumbering skipped: %', SQLERRM;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "sessions" GROUP BY "invite_id" HAVING count(*) > 1) THEN
    RAISE WARNING '0006: index sessions_invite_id_unique skipped: duplicate rows remain (the application-level claims still enforce the invariant)';
  ELSE
    CREATE UNIQUE INDEX IF NOT EXISTS "sessions_invite_id_unique" ON "sessions" USING btree ("invite_id");
  END IF;
EXCEPTION WHEN others THEN
  RAISE WARNING '0006: index sessions_invite_id_unique skipped: %', SQLERRM;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "rounds" GROUP BY "session_id", "round_number" HAVING count(*) > 1) THEN
    RAISE WARNING '0006: index rounds_session_round_unique skipped: duplicate rows remain (the application-level claims still enforce the invariant)';
  ELSE
    CREATE UNIQUE INDEX IF NOT EXISTS "rounds_session_round_unique" ON "rounds" USING btree ("session_id","round_number");
  END IF;
EXCEPTION WHEN others THEN
  RAISE WARNING '0006: index rounds_session_round_unique skipped: %', SQLERRM;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "turns" GROUP BY "session_id", "step" HAVING count(*) > 1) THEN
    RAISE WARNING '0006: index turns_session_step_unique skipped: duplicate rows remain (the application-level claims still enforce the invariant)';
  ELSE
    CREATE UNIQUE INDEX IF NOT EXISTS "turns_session_step_unique" ON "turns" USING btree ("session_id","step");
  END IF;
EXCEPTION WHEN others THEN
  RAISE WARNING '0006: index turns_session_step_unique skipped: %', SQLERRM;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "turns" WHERE "answer" IS NULL GROUP BY "session_id" HAVING count(*) > 1) THEN
    RAISE WARNING '0006: index turns_one_pending_per_session skipped: duplicate rows remain (the application-level claims still enforce the invariant)';
  ELSE
    CREATE UNIQUE INDEX IF NOT EXISTS "turns_one_pending_per_session" ON "turns" USING btree ("session_id") WHERE "turns"."answer" is null;
  END IF;
EXCEPTION WHEN others THEN
  RAISE WARNING '0006: index turns_one_pending_per_session skipped: %', SQLERRM;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  CREATE INDEX IF NOT EXISTS "turns_round_id_idx" ON "turns" USING btree ("round_id");
EXCEPTION WHEN others THEN
  RAISE WARNING '0006: index turns_round_id_idx skipped: %', SQLERRM;
END $$;
