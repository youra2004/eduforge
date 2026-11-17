CREATE TYPE "public"."assessment_kind" AS ENUM('node_test', 'exam', 'pretest', 'posttest', 'delayed_posttest');--> statement-breakpoint
CREATE TYPE "public"."assessment_status" AS ENUM('in_progress', 'submitted', 'passed', 'failed', 'interrupted', 'annulled');--> statement-breakpoint
CREATE TYPE "public"."node_state" AS ENUM('locked', 'available', 'in_progress', 'passed', 'cooldown');--> statement-breakpoint
CREATE TABLE "assessment_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"assessment_id" uuid NOT NULL,
	"question_id" uuid NOT NULL,
	"ord" integer NOT NULL,
	"shown_at" timestamp with time zone,
	"answered_at" timestamp with time zone,
	"answer" jsonb,
	"is_correct" boolean,
	"score" real,
	"graded_by" text,
	"grader_run_id" uuid,
	"time_ms" integer,
	"hints_used" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "assessment_items_assessment_ord_unique" UNIQUE("assessment_id","ord")
);
--> statement-breakpoint
CREATE TABLE "assessments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" "assessment_kind" NOT NULL,
	"course_version_id" uuid NOT NULL,
	"node_id" uuid,
	"round_no" integer DEFAULT 1 NOT NULL,
	"attempt_no" integer DEFAULT 1 NOT NULL,
	"status" "assessment_status" DEFAULT 'in_progress' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deadline_at" timestamp with time zone,
	"submitted_at" timestamp with time zone,
	"score_pct" real,
	"per_skill" jsonb,
	"interruptions" integer DEFAULT 0 NOT NULL,
	"risk_score" real DEFAULT 0 NOT NULL,
	"question_set_seed" bigint NOT NULL,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "enrollments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"course_version_id" uuid NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "enrollments_user_version_unique" UNIQUE("user_id","course_version_id")
);
--> statement-breakpoint
CREATE TABLE "event_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"ts" timestamp with time zone DEFAULT now() NOT NULL,
	"user_id" uuid,
	"session_key" text,
	"name" text NOT NULL,
	"props" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mastery_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"skill_id" uuid NOT NULL,
	"assessment_item_id" uuid NOT NULL,
	"p_before" real NOT NULL,
	"p_after" real NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "node_progress" (
	"user_id" uuid NOT NULL,
	"node_id" uuid NOT NULL,
	"state" "node_state" NOT NULL,
	"round_no" integer DEFAULT 1 NOT NULL,
	"attempts_in_round" integer DEFAULT 0 NOT NULL,
	"cooldown_until" timestamp with time zone,
	"passed_at" timestamp with time zone,
	CONSTRAINT "node_progress_user_id_node_id_pk" PRIMARY KEY("user_id","node_id")
);
--> statement-breakpoint
CREATE TABLE "skill_mastery" (
	"user_id" uuid NOT NULL,
	"skill_id" uuid NOT NULL,
	"p_known" real NOT NULL,
	"n_obs" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "skill_mastery_user_id_skill_id_pk" PRIMARY KEY("user_id","skill_id")
);
--> statement-breakpoint
ALTER TABLE "assessment_items" ADD CONSTRAINT "assessment_items_assessment_id_assessments_id_fk" FOREIGN KEY ("assessment_id") REFERENCES "public"."assessments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessment_items" ADD CONSTRAINT "assessment_items_question_id_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."questions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessment_items" ADD CONSTRAINT "assessment_items_grader_run_id_llm_runs_id_fk" FOREIGN KEY ("grader_run_id") REFERENCES "public"."llm_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessments" ADD CONSTRAINT "assessments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessments" ADD CONSTRAINT "assessments_course_version_id_course_versions_id_fk" FOREIGN KEY ("course_version_id") REFERENCES "public"."course_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessments" ADD CONSTRAINT "assessments_node_id_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."nodes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_course_version_id_course_versions_id_fk" FOREIGN KEY ("course_version_id") REFERENCES "public"."course_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_log" ADD CONSTRAINT "event_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mastery_history" ADD CONSTRAINT "mastery_history_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mastery_history" ADD CONSTRAINT "mastery_history_skill_id_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mastery_history" ADD CONSTRAINT "mastery_history_assessment_item_id_assessment_items_id_fk" FOREIGN KEY ("assessment_item_id") REFERENCES "public"."assessment_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "node_progress" ADD CONSTRAINT "node_progress_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "node_progress" ADD CONSTRAINT "node_progress_node_id_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."nodes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_mastery" ADD CONSTRAINT "skill_mastery_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_mastery" ADD CONSTRAINT "skill_mastery_skill_id_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "assessment_items_question_idx" ON "assessment_items" USING btree ("question_id");--> statement-breakpoint
CREATE INDEX "assessments_user_node_idx" ON "assessments" USING btree ("user_id","node_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "assessments_node_test_in_progress_unique" ON "assessments" USING btree ("user_id","node_id") WHERE "assessments"."kind" = 'node_test' AND "assessments"."status" = 'in_progress';--> statement-breakpoint
CREATE INDEX "event_log_user_ts_idx" ON "event_log" USING btree ("user_id","ts");--> statement-breakpoint
CREATE INDEX "event_log_name_idx" ON "event_log" USING btree ("name");--> statement-breakpoint
CREATE INDEX "mastery_history_user_skill_idx" ON "mastery_history" USING btree ("user_id","skill_id","at");