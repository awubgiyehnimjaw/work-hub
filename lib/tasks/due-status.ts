const DAY_MS = 24 * 60 * 60 * 1000;

export type DueStatus = "overdue" | "red" | "yellow" | "green" | null;

/**
 * Classifies how urgent a to-do's due date is, for highlighting in the UI.
 * Bands mirror the advance heads-up push windows in lib/reminders/check.ts
 * (1 day / 3 days / 1 week), so the colors line up with the notifications
 * the user already gets at those same thresholds.
 */
export function classifyDueStatus(dueAt: Date, now: Date): DueStatus {
  const msUntilDue = dueAt.getTime() - now.getTime();
  if (msUntilDue <= 0) return "overdue";
  if (msUntilDue <= DAY_MS) return "red";
  if (msUntilDue <= 3 * DAY_MS) return "yellow";
  if (msUntilDue <= 7 * DAY_MS) return "green";
  return null;
}
