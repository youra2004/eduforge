CREATE TYPE "public"."content_kind" AS ENUM('markdown', 'video');--> statement-breakpoint
CREATE TYPE "public"."transcript_source" AS ENUM('author', 'whisper');--> statement-breakpoint
CREATE TABLE "content_chunks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"node_id" uuid NOT NULL,
	"content_item_id" uuid NOT NULL,
	"chunk_index" integer NOT NULL,
	"text" text NOT NULL,
	"token_count" integer NOT NULL,
	"embedding" vector(1024) NOT NULL,
	CONSTRAINT "content_chunks_item_index_unique" UNIQUE("content_item_id","chunk_index")
);
--> statement-breakpoint
CREATE TABLE "content_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"node_id" uuid NOT NULL,
	"kind" "content_kind" NOT NULL,
	"title" text NOT NULL,
	"ord" integer DEFAULT 0 NOT NULL,
	"body_md" text,
	"video_url" text,
	"video_storage_key" text,
	"transcript_text" text,
	"transcript_source" "transcript_source",
	"indexed_hash" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "content_items_kind_fields" CHECK (("content_items"."kind" = 'markdown' AND "content_items"."body_md" IS NOT NULL) OR ("content_items"."kind" = 'video' AND ("content_items"."video_url" IS NOT NULL OR "content_items"."video_storage_key" IS NOT NULL)))
);
--> statement-breakpoint
ALTER TABLE "content_chunks" ADD CONSTRAINT "content_chunks_node_id_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."nodes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_chunks" ADD CONSTRAINT "content_chunks_content_item_id_content_items_id_fk" FOREIGN KEY ("content_item_id") REFERENCES "public"."content_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_items" ADD CONSTRAINT "content_items_node_id_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."nodes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "content_chunks_node_idx" ON "content_chunks" USING btree ("node_id");--> statement-breakpoint
CREATE INDEX "content_chunks_embedding_idx" ON "content_chunks" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "content_items_node_idx" ON "content_items" USING btree ("node_id","ord");