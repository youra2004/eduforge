CREATE TYPE "public"."event_severity" AS ENUM('info', 'soft', 'hard');--> statement-breakpoint
CREATE TYPE "public"."strike_status" AS ENUM('pending_review', 'confirmed', 'dismissed', 'appealed', 'overturned');--> statement-breakpoint
CREATE TABLE "proctor_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"assessment_id" uuid NOT NULL,
	"ts" timestamp with time zone DEFAULT now() NOT NULL,
	"source" text NOT NULL,
	"type" text NOT NULL,
	"severity" "event_severity" NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "proctor_events_source_check" CHECK ("proctor_events"."source" IN ('browser', 'frame', 'keystroke', 'server'))
);
--> statement-breakpoint
CREATE TABLE "proctor_evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"storage_key" text NOT NULL,
	"sha256" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "proctor_evidence_event_id_unique" UNIQUE("event_id")
);
--> statement-breakpoint
CREATE TABLE "strikes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"assessment_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"status" "strike_status" NOT NULL,
	"level" smallint DEFAULT 0 NOT NULL,
	"ban_until" timestamp with time zone,
	"reviewed_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	CONSTRAINT "strikes_assessment_id_unique" UNIQUE("assessment_id")
);
--> statement-breakpoint
ALTER TABLE "proctor_events" ADD CONSTRAINT "proctor_events_assessment_id_assessments_id_fk" FOREIGN KEY ("assessment_id") REFERENCES "public"."assessments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proctor_evidence" ADD CONSTRAINT "proctor_evidence_event_id_proctor_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."proctor_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "strikes" ADD CONSTRAINT "strikes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "strikes" ADD CONSTRAINT "strikes_assessment_id_assessments_id_fk" FOREIGN KEY ("assessment_id") REFERENCES "public"."assessments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "strikes" ADD CONSTRAINT "strikes_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "proctor_events_assessment_idx" ON "proctor_events" USING btree ("assessment_id","ts");--> statement-breakpoint
CREATE INDEX "proctor_evidence_expires_idx" ON "proctor_evidence" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "strikes_user_idx" ON "strikes" USING btree ("user_id","status");