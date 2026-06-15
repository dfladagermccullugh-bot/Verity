CREATE TABLE IF NOT EXISTS "rounds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"round_number" integer NOT NULL,
	"prd_version" integer NOT NULL,
	"status" text DEFAULT 'in_progress' NOT NULL,
	"termination_reason" text,
	"focus_brief" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"prd_markdown" text,
	"methodology_markdown" text,
	"analysis_markdown" text
);
--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "status" text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "resume_phrase" text;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "seed_warnings" text;--> statement-breakpoint
ALTER TABLE "turns" ADD COLUMN "round_id" uuid;--> statement-breakpoint
ALTER TABLE "turns" ADD COLUMN "construct_dimension" text;--> statement-breakpoint
ALTER TABLE "turns" ADD COLUMN "regen_count" integer;--> statement-breakpoint
ALTER TABLE "turns" ADD COLUMN "guard_rejections" text;--> statement-breakpoint
ALTER TABLE "turns" ADD COLUMN "leading_verdict" text;--> statement-breakpoint
ALTER TABLE "turns" ADD COLUMN "is_triangulation_probe" boolean;--> statement-breakpoint
ALTER TABLE "turns" ADD COLUMN "device_class" text;--> statement-breakpoint
ALTER TABLE "turns" ADD COLUMN "viewport" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "rounds" ADD CONSTRAINT "rounds_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "turns" ADD CONSTRAINT "turns_round_id_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."rounds"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
