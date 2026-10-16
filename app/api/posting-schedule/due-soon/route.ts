import { NextResponse } from "next/server";
import { fetchPostingScheduleCsv, filterDueSoon, parsePostingScheduleCsv } from "@/lib/posting-schedule/sheet";

/**
 * Powers the dashboard's posting-schedule card — the same within-2-days
 * filter the daily push digest uses (`lib/reminders/check.ts`), so the
 * card and the notification never disagree about what counts as "due
 * soon". Sorted soonest-first since that's the order Callum would want
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

  entries.sort((a, b) => (a.postDate ?? "").localeCompare(b.postDate ?? ""));
  return NextResponse.json(entries);
}
