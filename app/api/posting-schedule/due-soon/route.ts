import { NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { postingScheduleCompletions } from "@/lib/db/schema";
import {
  classifyPostingScheduleStatus,
  entryKey,
  fetchPostingScheduleCsv,
  filterByNotCompleted,
  filterDueSoon,
  parsePostingScheduleCsv,
  sgtDateKey,
} from "@/lib/posting-schedule/sheet";

/**
 * Powers the dashboard's posting-schedule card — the same within-3-days
 * (and indefinitely overdue) filter the daily push digest uses
 * (`lib/reminders/check.ts`), so the card and the notification never
 * disagree about what counts as "due soon". Entries Callum has pressed
 * "Done" on (`postingScheduleCompletions`) are excluded here, which is
 * how a stale overdue entry actually disappears, since nothing else ever
 * drops it on its own. Each entry is tagged with `entryKey` (so the UI's
 * Done button has something to post back) and `status` (its urgency
 * color). Sorted soonest-first since that's the order Callum would want
 * to act on them.
 */
export async function GET() {
  let entries;
  try {
    const csv = await fetchPostingScheduleCsv();
    entries = filterDueSoon(parsePostingScheduleCsv(csv), new Date());
  } catch (error) {
    console.error("GET /api/posting-schedule/due-soon: failed to fetch/parse the posting schedule", error);
    return NextResponse.json({ error: "Failed to load the posting schedule" }, { status: 500 });
  }

  const completions = await db.select().from(postingScheduleCompletions);
  const completedKeys = new Set(completions.map((row) => row.entryKey));
  entries = filterByNotCompleted(entries, completedKeys);

  entries.sort((a, b) => (a.postDate ?? "").localeCompare(b.postDate ?? ""));

  const todayKey = sgtDateKey(new Date());
  const tagged = entries.map((entry) => ({
    ...entry,
    entryKey: entryKey(entry),
    status: entry.postDate ? classifyPostingScheduleStatus(entry.postDate, todayKey) : "none",
  }));

  return NextResponse.json(tagged);
}
