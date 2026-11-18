CREATE TABLE "recommendations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"day" date NOT NULL,
	"items" jsonb NOT NULL,
	"metrics_hash" text NOT NULL,
	"llm_run_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recommendations_user_day_unique" UNIQUE("user_id","day"),
	CONSTRAINT "recommendations_items_max" CHECK (jsonb_array_length("recommendations"."items") BETWEEN 1 AND 3)
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "is_demo" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "recommendations" ADD CONSTRAINT "recommendations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recommendations" ADD CONSTRAINT "recommendations_llm_run_id_llm_runs_id_fk" FOREIGN KEY ("llm_run_id") REFERENCES "public"."llm_runs"("id") ON DELETE no action ON UPDATE no action;