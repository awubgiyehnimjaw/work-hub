import { sgtDateKey } from "@/lib/posting-schedule/sheet";

/** True between 23:00 and 08:00 SGT — overdue-to-do nags are suppressed in this window. */
export function isQuietHoursSgt(now: Date): boolean {
  const sgtHour = (now.getUTCHours() + 8) % 24;
  return sgtHour >= 23 || sgtHour < 8;
}

function tomorrowSgtYmd(now: Date): { year: number; month: number; day: number } {
  const [year, month, day] = sgtDateKey(now).split("-").map(Number);
  return { year, month, day };
}

/** 9am SGT on the next SGT calendar day — 9am SGT is 01:00 UTC. */
export function tomorrowNineAmSgt(now: Date): Date {
  const { year, month, day } = tomorrowSgtYmd(now);
  return new Date(Date.UTC(year, month - 1, day + 1, 1, 0, 0));
}

/** Midnight SGT at the start of the next SGT calendar day — midnight SGT is 16:00 UTC the day before. */
export function startOfTomorrowSgt(now: Date): Date {
  const { year, month, day } = tomorrowSgtYmd(now);
  return new Date(Date.UTC(year, month - 1, day, 16, 0, 0));
}
