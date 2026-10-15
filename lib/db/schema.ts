import {
  boolean,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

export const taskTypeEnum = pgEnum("task_type", ["review", "todo"]);
export const taskStatusEnum = pgEnum("task_status", ["active", "completed"]);
export const suggestionCategoryEnum = pgEnum("suggestion_category", [
  "ulti",
  "arc",
  "general",
]);
export const oauthProviderEnum = pgEnum("oauth_provider", [
  "frameio",
  "google",
]);

export const clients = pgTable("clients", {
  id: uuid("id").primaryKey().defaultRandom(),
  tag: text("tag").notNull().unique(),
  displayName: text("display_name").notNull(),
  recognized: boolean("recognized").notNull(),
  lastActivityAt: timestamp("last_activity_at"),
});

export const tasks = pgTable("tasks", {
  id: uuid("id").primaryKey().defaultRandom(),
  type: taskTypeEnum("type").notNull(),
  title: text("title").notNull(),
  clientId: uuid("client_id").references(() => clients.id),
  frameioFileId: text("frameio_file_id").unique(),
  frameioUrl: text("frameio_url"),
  // The video's filename as Frame.io returned it (e.g. the editor's raw
  // "01.114 SALMON RICE (that place).mp4"), stored verbatim for display
  // alongside the client name — never re-derived or guessed. Null for
  // to-dos, which have no source file.
  sourceFileName: text("source_file_name"),
  status: taskStatusEnum("status").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  completedAt: timestamp("completed_at"),
  snoozedUntil: timestamp("snoozed_until"),
  // Set when a "snooze just expired" reappearance push (Important 4) has
  // been sent for the CURRENT `snoozedUntil` value — nullable so a task
  // that's never been snoozed, or never had its snooze expiry notified,
  // is trivially "needs notifying". Compared against `snoozedUntil` itself
  // (not just null-checked) so re-snoozing the same task again correctly
  // requires a fresh notification the next time that new snooze expires.
  snoozeNotifiedAt: timestamp("snooze_notified_at"),
  // Optional due date for a to-do (never set on review tasks). Null means
  // "no due date" — not every to-do needs one.
  dueAt: timestamp("due_at"),
  // Mirrors `snoozeNotifiedAt`'s pattern: set once a "this is due" push has
  // been sent, so the reminder check (every 15 min) doesn't re-notify the
  // same to-do every run after it becomes due.
  dueNotifiedAt: timestamp("due_notified_at"),
});

export const suggestions = pgTable("suggestions", {
  id: uuid("id").primaryKey().defaultRandom(),
  category: suggestionCategoryEnum("category").notNull(),
  text: text("text").notNull().unique(),
  active: boolean("active").notNull(),
  lastPickedAt: timestamp("last_picked_at"),
});

export const pushSubscriptions = pgTable("push_subscriptions", {
  id: uuid("id").primaryKey().defaultRandom(),
  endpoint: text("endpoint").notNull().unique(),
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const calendarEventsCache = pgTable("calendar_events_cache", {
  id: uuid("id").primaryKey().defaultRandom(),
  googleEventId: text("google_event_id").notNull().unique(),
  title: text("title").notNull(),
  startAt: timestamp("start_at").notNull(),
  endAt: timestamp("end_at").notNull(),
  location: text("location"),
  // Important 11: lets CalendarAgenda show "All day" instead of a nonsense
  // time range (e.g. "1:00 AM–1:00 AM") for a date-only Google Calendar
  // event. Defaults to false so this column can be added to a table that
  // may already have rows.
  allDay: boolean("all_day").notNull().default(false),
});

export const oauthTokens = pgTable("oauth_tokens", {
  id: uuid("id").primaryKey().defaultRandom(),
  provider: oauthProviderEnum("provider").notNull().unique(),
  accessToken: text("access_token").notNull(),
  refreshToken: text("refresh_token").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
});

export const syncState = pgTable("sync_state", {
  id: uuid("id").primaryKey().defaultRandom(),
  frameioLastPolledAt: timestamp("frameio_last_polled_at"),
  // When the weekly digest push was last sent — checked against the
  // current week so the digest fires at most once per week even though
  // the reminder-check cron runs every 15 minutes.
  weeklyDigestSentAt: timestamp("weekly_digest_sent_at"),
});
