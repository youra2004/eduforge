CREATE TABLE "experiment_assignments" (
	"user_id" uuid NOT NULL,
	"module" text NOT NULL,
	"condition" text NOT NULL,
	"period" smallint NOT NULL,
	CONSTRAINT "experiment_assignments_user_id_module_pk" PRIMARY KEY("user_id","module"),
	CONSTRAINT "experiment_assignments_user_period_unique" UNIQUE("user_id","period"),
	CONSTRAINT "experiment_assignments_module_check" CHECK ("experiment_assignments"."module" IN ('A', 'B')),
	CONSTRAINT "experiment_assignments_condition_check" CHECK ("experiment_assignments"."condition" IN ('method', 'control')),
	CONSTRAINT "experiment_assignments_period_check" CHECK ("experiment_assignments"."period" IN (1, 2))
);
--> statement-breakpoint
CREATE TABLE "experiment_participants" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"consent_at" timestamp with time zone DEFAULT now() NOT NULL,
	"order_variant" text NOT NULL,
	CONSTRAINT "experiment_participants_code_unique" UNIQUE("code"),
	CONSTRAINT "experiment_participants_order_check" CHECK ("experiment_participants"."order_variant" IN ('A_then_B', 'B_then_A'))
);
--> statement-breakpoint
ALTER TABLE "experiment_assignments" ADD CONSTRAINT "experiment_assignments_user_id_experiment_participants_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."experiment_participants"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "experiment_participants" ADD CONSTRAINT "experiment_participants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;