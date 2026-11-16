CREATE TYPE "public"."llm_purpose" AS ENUM('question_generation', 'question_validation', 'audit_conformity', 'audit_skills', 'audit_scoring', 'open_grading', 'tutor', 'tutor_guard', 'recommendation', 'certificate_summary', 'vision_check', 'transcription', 'embedding');--> statement-breakpoint
CREATE TABLE "llm_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"purpose" "llm_purpose" NOT NULL,
	"model" text NOT NULL,
	"params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"prompt_version" text NOT NULL,
	"prompt_hash" text NOT NULL,
	"request" jsonb NOT NULL,
	"response" jsonb,
	"tokens_in" integer DEFAULT 0 NOT NULL,
	"tokens_out" integer DEFAULT 0 NOT NULL,
	"cost_usd" numeric DEFAULT '0' NOT NULL,
	"latency_ms" integer DEFAULT 0 NOT NULL,
	"subject_type" text,
	"subject_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "llm_runs_purpose_created_idx" ON "llm_runs" USING btree ("purpose","created_at");