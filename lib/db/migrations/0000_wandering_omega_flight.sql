CREATE TYPE "public"."oauth_provider" AS ENUM('frameio', 'google');--> statement-breakpoint
CREATE TYPE "public"."suggestion_category" AS ENUM('ulti', 'arc', 'general');--> statement-breakpoint
CREATE TYPE "public"."task_status" AS ENUM('active', 'completed');--> statement-breakpoint
CREATE TYPE "public"."task_type" AS ENUM('review', 'todo');--> statement-breakpoint
CREATE TABLE "calendar_events_cache" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"google_event_id" text NOT NULL,
	"title" text NOT NULL,
	"start_at" timestamp NOT NULL,
	"end_at" timestamp NOT NULL,
	"location" text,
	CONSTRAINT "calendar_events_cache_google_event_id_unique" UNIQUE("google_event_id")
);
--> statement-breakpoint
CREATE TABLE "clients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tag" text NOT NULL,
	"display_name" text NOT NULL,
	"recognized" boolean NOT NULL,
	"last_activity_at" timestamp,
	CONSTRAINT "clients_tag_unique" UNIQUE("tag")
);
--> statement-breakpoint
CREATE TABLE "oauth_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" "oauth_provider" NOT NULL,
	"access_token" text NOT NULL,
	"refresh_token" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	CONSTRAINT "oauth_tokens_provider_unique" UNIQUE("provider")
);
--> statement-breakpoint
CREATE TABLE "push_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "push_subscriptions_endpoint_unique" UNIQUE("endpoint")
);
--> statement-breakpoint
CREATE TABLE "suggestions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"category" "suggestion_category" NOT NULL,
	"text" text NOT NULL,
	"active" boolean NOT NULL,
	"last_picked_at" timestamp,
	CONSTRAINT "suggestions_text_unique" UNIQUE("text")
);
--> statement-breakpoint
CREATE TABLE "sync_state" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"frameio_last_polled_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" "task_type" NOT NULL,
	"title" text NOT NULL,
	"client_id" uuid,
	"frameio_file_id" text,
	"frameio_url" text,
	"status" "task_status" NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp,
	"snoozed_until" timestamp,
	CONSTRAINT "tasks_frameio_file_id_unique" UNIQUE("frameio_file_id")
);
--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;