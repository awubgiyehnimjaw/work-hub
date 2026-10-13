const STALE_THRESHOLD_MS = 2 * 24 * 60 * 60 * 1000;

interface StaleCheckTask {
  status: string;
  snoozedUntil: Date | null;
  createdAt: Date;
}

/**
 * A task is stale once it's been sitting active for 2+ days with nothing
 * snoozing it into the future. Completed tasks are never stale (closed,
 * not aging). A snooze that has already elapsed (`snoozedUntil <= now`)
 * no longer suppresses staleness — the task has "reappeared" and ages
 * exactly like an unsnoozed one.
 */
export function isTaskStale(task: StaleCheckTask, now: Date): boolean {
  if (task.status !== "active") {
    return false;
  }
  if (task.snoozedUntil !== null && task.snoozedUntil.getTime() > now.getTime()) {
    return false;
  }
  return now.getTime() - task.createdAt.getTime() >= STALE_THRESHOLD_MS;
}
