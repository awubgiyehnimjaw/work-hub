import {
  boolean,
  integer,
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
  // Billing-profile fields for invoice generation: the client's legal
  // company name and mailing address. Nullable because most clients don't
  // need an invoice generated against them — downstream code checks
  // `legalName && addressLine1` to decide whether a client is eligible to
  // appear in the invoice-creation dropdown.
  legalName: text("legal_name"),
  addressLine1: text("address_line1"),
  addressLine2: text("address_line2"),
  attention: text("attention"),
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
  // Advance heads-up pushes ("due in 1 week/3 days/tomorrow"), each a
  // one-shot flag exactly like dueNotifiedAt but for its own threshold —
  // a to-do due in 2 days only ever needed the 3-day and 1-day columns,
  // never the week-ahead one, so these can't share a single flag.
  dueWeekAheadNotifiedAt: timestamp("due_week_ahead_notified_at"),
  dueThreeDayNotifiedAt: timestamp("due_three_day_notified_at"),
  dueOneDayNotifiedAt: timestamp("due_one_day_notified_at"),
});

export const contentIdeas = pgTable("content_ideas", {
  id: uuid("id").primaryKey().defaultRandom(),
  clientId: uuid("client_id").notNull().references(() => clients.id),
  text: text("text").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
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
  // When the posting-schedule check last ran during its daily window — set
  // whether or not anything was actually due (unlike weeklyDigestSentAt,
  // which is only set on an actual send), so a quiet day doesn't get
  // re-checked every 15 minutes for the rest of that day's window, and a
  // genuine fetch failure (left unset) gets retried on the next tick.
  postingScheduleCheckedAt: timestamp("posting_schedule_checked_at"),
});

// De-dup for the Telegram webhook: `updateId` is Telegram's own `update_id`,
// used directly as the primary key (no surrogate id needed) so a retried
// delivery of the same update is a no-op insert rather than reprocessed.
export const telegramUpdates = pgTable("telegram_updates", {
  updateId: integer("update_id").primaryKey(),
  processedAt: timestamp("processed_at").notNull().defaultNow(),
});

// Tracks posting-schedule entries Callum has pressed "Done" on. The sheet
// itself is read-only (CSV export, no OAuth write scope) and has no id
// column, so `entryKey` (lib/posting-schedule/sheet.ts's `entryKey`,
// derived from client+video+postDate) is used directly as the primary key —
// same pattern as `telegramUpdates.updateId` above.
export const postingScheduleCompletions = pgTable("posting_schedule_completions", {
  entryKey: text("entry_key").primaryKey(),
  completedAt: timestamp("completed_at").notNull().defaultNow(),
});

// Generated invoices. The client's billing-profile fields (legalName/
// addressLine1/addressLine2/attention) are snapshotted onto the invoice
// row at creation time rather than joined live from `clients` — an
// invoice is a legal document and must keep showing exactly the address
// it was issued to, even if the client's profile is edited or renamed
// later. `clientId` is kept only for display (e.g. `clientDisplayName` in
// the list API) and has no `ON DELETE` action, matching `tasks.clientId`.
export const invoices = pgTable("invoices", {
  id: uuid("id").primaryKey().defaultRandom(),
  invoiceNumber: text("invoice_number").notNull().unique(),
  clientId: uuid("client_id").notNull().references(() => clients.id),
  clientLegalName: text("client_legal_name").notNull(),
  clientAddressLine1: text("client_address_line1").notNull(),
  clientAddressLine2: text("client_address_line2"),
  clientAttention: text("client_attention").notNull(),
  invoiceDate: timestamp("invoice_date").notNull(),
  dueDate: timestamp("due_date").notNull(),
  description: text("description"),
  totalAmountCents: integer("total_amount_cents").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
