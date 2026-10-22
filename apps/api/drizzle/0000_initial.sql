CREATE EXTENSION IF NOT EXISTS postgis;
--> statement-breakpoint
CREATE TABLE "cities" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"bbox" geometry(Polygon, 4326) NOT NULL,
	"timezone" text NOT NULL,
	"country" text NOT NULL,
	"holiday_region" text NOT NULL,
	"transit_area_ids" text[] DEFAULT '{}'::text[] NOT NULL,
	"locale" text NOT NULL,
	"curated_facts_path" text NOT NULL,
	"eval_corpus_path" text NOT NULL,
	"capabilities" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
