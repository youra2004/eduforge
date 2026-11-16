CREATE TYPE "public"."version_status" AS ENUM('draft', 'auditing', 'changes_requested', 'ready_to_publish', 'expert_review', 'published', 'archived');--> statement-breakpoint
CREATE TABLE "course_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"course_id" uuid NOT NULL,
	"version_no" integer NOT NULL,
	"parent_version_id" uuid,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"declared_level" text,
	"status" "version_status" DEFAULT 'draft' NOT NULL,
	"audit_attempts" integer DEFAULT 0 NOT NULL,
	"rating" smallint,
	"ai_level" text,
	"ai_hardness" real,
	"volume_cap" smallint,
	"audit_summary" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone,
	CONSTRAINT "course_versions_course_version_no_unique" UNIQUE("course_id","version_no"),
	CONSTRAINT "course_versions_rating_range" CHECK ("course_versions"."rating" IS NULL OR "course_versions"."rating" BETWEEN 1 AND 10)
);
--> statement-breakpoint
CREATE TABLE "courses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"author_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "courses_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "node_edges" (
	"prereq_node_id" uuid NOT NULL,
	"node_id" uuid NOT NULL,
	CONSTRAINT "node_edges_prereq_node_id_node_id_pk" PRIMARY KEY("prereq_node_id","node_id"),
	CONSTRAINT "node_edges_no_self_loop" CHECK ("node_edges"."prereq_node_id" <> "node_edges"."node_id")
);
--> statement-breakpoint
CREATE TABLE "node_skills" (
	"node_id" uuid NOT NULL,
	"skill_id" uuid NOT NULL,
	CONSTRAINT "node_skills_node_id_skill_id_pk" PRIMARY KEY("node_id","skill_id")
);
--> statement-breakpoint
CREATE TABLE "nodes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"course_version_id" uuid NOT NULL,
	"title" text NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"position" jsonb
);
--> statement-breakpoint
CREATE TABLE "skills" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"course_version_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"verified" boolean,
	"verification_note" text
);
--> statement-breakpoint
ALTER TABLE "course_versions" ADD CONSTRAINT "course_versions_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_versions" ADD CONSTRAINT "course_versions_parent_version_id_course_versions_id_fk" FOREIGN KEY ("parent_version_id") REFERENCES "public"."course_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "courses" ADD CONSTRAINT "courses_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "node_edges" ADD CONSTRAINT "node_edges_prereq_node_id_nodes_id_fk" FOREIGN KEY ("prereq_node_id") REFERENCES "public"."nodes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "node_edges" ADD CONSTRAINT "node_edges_node_id_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."nodes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "node_skills" ADD CONSTRAINT "node_skills_node_id_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."nodes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "node_skills" ADD CONSTRAINT "node_skills_skill_id_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nodes" ADD CONSTRAINT "nodes_course_version_id_course_versions_id_fk" FOREIGN KEY ("course_version_id") REFERENCES "public"."course_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skills" ADD CONSTRAINT "skills_course_version_id_course_versions_id_fk" FOREIGN KEY ("course_version_id") REFERENCES "public"."course_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "node_edges_node_idx" ON "node_edges" USING btree ("node_id");--> statement-breakpoint
CREATE INDEX "node_skills_skill_idx" ON "node_skills" USING btree ("skill_id");--> statement-breakpoint
CREATE INDEX "nodes_course_version_idx" ON "nodes" USING btree ("course_version_id");--> statement-breakpoint
CREATE INDEX "skills_course_version_idx" ON "skills" USING btree ("course_version_id");