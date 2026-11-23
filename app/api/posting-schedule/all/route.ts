import { NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { postingScheduleCompletions } from "@/lib/db/schema";
import {
  classifyFullPostingScheduleStatus,
  entryKey,
  fetchPostingScheduleCsv,
  parsePostingScheduleCsv,
  sgtDateKey,
} from "@/lib/posting-schedule/sheet";

// Entries with no Post Date have nothing to sort by — sorted after every
// real date instead of before it (a bare `.postDate ?? ""` comparison, as
// the due-soon route uses, would put them first).
const NO_DATE_SORT_KEY = "9999-99-99";

/**
 * The full posting schedule, unfiltered — every entry in the sheet, not
 * just what's due soon — for the team dashboard's Posting Schedule tab.
 * Tagged with `entryKey` and a richer `status` than the due-soon card uses,
 * since this view also needs to show what's already done or on hold.
 */
export async function GET() {
  let entries;
  try {
    const csv = await fetchPostingScheduleCsv();
    entries = parsePostingScheduleCsv(csv);
  } catch (error) {
    console.error("GET /api/posting-schedule/all: failed to fetch/parse the posting schedule", error);
    return NextResponse.json({ error: "Failed to load the posting schedule" }, { status: 500 });
  }

  const completions = await db.select().from(postingScheduleCompletions);
  const completedKeys = new Set(completions.map((row) => row.entryKey));

  const todayKey = sgtDateKey(new Date());
  const tagged = entries.map((entry) => {
    const key = entryKey(entry);
    return {
      ...entry,
      entryKey: key,
      status: classifyFullPostingScheduleStatus(entry, todayKey, completedKeys.has(key)),
    };
  });

  tagged.sort((a, b) => (a.postDate ?? NO_DATE_SORT_KEY).localeCompare(b.postDate ?? NO_DATE_SORT_KEY));

  return NextResponse.json(tagged);
}
