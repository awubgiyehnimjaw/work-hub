export interface PostingScheduleEntry {
  client: string;
  video: string;
  /** "YYYY-MM-DD", or null if the sheet's Post Date cell was blank/unparseable. */
  postDate: string | null;
  notes: string | null;
}

const MONTHS: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};

/** Parses the sheet's "DD Mon YYYY" format (e.g. "16 Oct 2026") into "YYYY-MM-DD". */
function parseSheetDate(raw: string): string | null {
  const match = raw.trim().match(/^(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})$/);
  if (!match) {
    return null;
  }
  const [, day, monthName, year] = match;
  const month = MONTHS[monthName.toLowerCase()];
  if (!month) {
    return null;
  }
  return `${year}-${month}-${day.padStart(2, "0")}`;
}

/** Splits one CSV line into fields, honoring double-quoted fields (with "" as an escaped quote). */
function splitCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (inQuotes) {
      if (char === '"' && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        current += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      fields.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  fields.push(current);
  return fields;
}

/**
 * Parses the posting-schedule sheet's CSV export. Assumes the fixed header
 * `Client,Video,Edit By,Post Date,Notes,Posted` — `Edit By` and `Posted`
 * aren't used by this app (only Callum's own posting deadline matters
 * here, not the editor's), so they're read past rather than modeled.
 */
export function parsePostingScheduleCsv(csv: string): PostingScheduleEntry[] {
  const lines = csv.split("\n").map((line) => line.trimEnd()).filter((line) => line.length > 0);
  const [, ...rows] = lines; // drop the header row

  return rows.map((line) => {
    const [client, video, , postDateRaw, notesRaw] = splitCsvLine(line);
    const notes = notesRaw?.trim();
    return {
      client: (client ?? "").trim(),
      video: (video ?? "").trim(),
      postDate: postDateRaw ? parseSheetDate(postDateRaw) : null,
      notes: notes ? notes : null,
    };
  });
}

function requireEnv(name: "POSTING_SCHEDULE_SHEET_CSV_URL"): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} environment variable is not set`);
  }
  return value;
}

/** Fetches the posting-schedule sheet's CSV export — the sheet is link-shared, no OAuth needed. */
export async function fetchPostingScheduleCsv(): Promise<string> {
  const url = requireEnv("POSTING_SCHEDULE_SHEET_CSV_URL");
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Posting schedule sheet fetch failed: ${response.status}`);
  }
  return response.text();
}

const sgtDateKeyFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Singapore",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** The "YYYY-MM-DD" calendar date `date` falls on in Callum's own timezone. */
export function sgtDateKey(date: Date): string {
  return sgtDateKeyFormatter.format(date);
}

function dateKeyToUtcMs(key: string): number {
  const [year, month, day] = key.split("-").map(Number);
  return Date.UTC(year, month - 1, day);
}

const DAY_MS = 24 * 60 * 60 * 1000;
const DUE_SOON_WINDOW_DAYS = 2;

/** Whether `postDateKey` falls within [today, today+2] calendar days, inclusive, of `todayKey`. */
function isDueSoon(postDateKey: string, todayKey: string): boolean {
  const diffDays = (dateKeyToUtcMs(postDateKey) - dateKeyToUtcMs(todayKey)) / DAY_MS;
  return diffDays >= 0 && diffDays <= DUE_SOON_WINDOW_DAYS;
}

const SKIPPED_NOTES = new Set(["done", "hold"]);

/**
 * Entries with a Post Date within the next 2 days (Callum's own calendar,
 * not UTC's), excluding anything already marked "DONE" or put on "HOLD" —
 * the only two statuses this sheet's Notes column is actually used for.
 */
export function filterDueSoon(entries: PostingScheduleEntry[], now: Date): PostingScheduleEntry[] {
  const todayKey = sgtDateKey(now);
  return entries.filter((entry) => {
    if (!entry.postDate) {
      return false;
    }
    if (entry.notes && SKIPPED_NOTES.has(entry.notes.toLowerCase())) {
      return false;
    }
    return isDueSoon(entry.postDate, todayKey);
  });
}
