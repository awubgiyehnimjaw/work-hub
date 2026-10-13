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
  status: taskStatusEnum("status").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  completedAt: timestamp("completed_at"),
  snoozedUntil: timestamp("snoozed_until"),
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
});
