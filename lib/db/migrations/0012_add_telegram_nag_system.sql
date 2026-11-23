ALTER TYPE "public"."task_status" ADD VALUE 'dismissed';--> statement-breakpoint
ALTER TABLE "sync_state" ADD COLUMN "morning_digest_sent_at" timestamp;--> statement-breakpoint
ALTER TABLE "sync_state" ADD COLUMN "evening_sweep_sent_at" timestamp;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "telegram_nag_sent_at" timestamp;