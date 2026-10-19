CREATE TABLE "posting_schedule_completions" (
	"entry_key" text PRIMARY KEY NOT NULL,
	"completed_at" timestamp DEFAULT now() NOT NULL
);
