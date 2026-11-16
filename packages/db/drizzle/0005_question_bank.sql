CREATE TYPE "public"."question_kind" AS ENUM('mcq', 'short', 'open');--> statement-breakpoint
CREATE TYPE "public"."question_pool" AS ENUM('node', 'exam', 'assessment');--> statement-breakpoint
CREATE TYPE "public"."question_status" AS ENUM('generated', 'validated', 'rejected', 'retired');--> statement-breakpoint
CREATE TABLE "questions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"node_id" uuid NOT NULL,
	"skill_id" uuid NOT NULL,
	"pool" "question_pool" NOT NULL,
	"kind" "question_kind" NOT NULL,
	"prompt_md" text NOT NULL,
	"options" jsonb,
	"answer_key" jsonb NOT NULL,
	"rubric" text,
	"difficulty" real DEFAULT 0.5 NOT NULL,
	"guess" real NOT NULL,
	"slip" real DEFAULT 0.1 NOT NULL,
	"status" "question_status" DEFAULT 'generated' NOT NULL,
	"rejection_reason" text,
	"revision" integer DEFAULT 0 NOT NULL,
	"generator_run_id" uuid,
	"validator_run_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "questions_guess_range" CHECK ("questions"."guess" BETWEEN 0 AND 1),
	CONSTRAINT "questions_slip_range" CHECK ("questions"."slip" BETWEEN 0 AND 1),
	CONSTRAINT "questions_difficulty_range" CHECK ("questions"."difficulty" BETWEEN 0 AND 1)
);
--> statement-breakpoint
CREATE TABLE "static_hints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"node_id" uuid NOT NULL,
	"question_id" uuid,
	"level" smallint NOT NULL,
	"text" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "questions" ADD CONSTRAINT "questions_node_id_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."nodes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "questions" ADD CONSTRAINT "questions_skill_id_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "questions" ADD CONSTRAINT "questions_generator_run_id_llm_runs_id_fk" FOREIGN KEY ("generator_run_id") REFERENCES "public"."llm_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "questions" ADD CONSTRAINT "questions_validator_run_id_llm_runs_id_fk" FOREIGN KEY ("validator_run_id") REFERENCES "public"."llm_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "questions" ADD CONSTRAINT "questions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "static_hints" ADD CONSTRAINT "static_hints_node_id_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."nodes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "static_hints" ADD CONSTRAINT "static_hints_question_id_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."questions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "questions_node_pool_idx" ON "questions" USING btree ("node_id","pool","status");--> statement-breakpoint
CREATE INDEX "questions_skill_idx" ON "questions" USING btree ("skill_id");--> statement-breakpoint
CREATE INDEX "static_hints_node_idx" ON "static_hints" USING btree ("node_id");