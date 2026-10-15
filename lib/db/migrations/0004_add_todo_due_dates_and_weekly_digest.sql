ALTER TABLE "sync_state" ADD COLUMN "weekly_digest_sent_at" timestamp;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "due_at" timestamp;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "due_notified_at" timestamp;