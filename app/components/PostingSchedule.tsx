"use client";

import { useEffect, useState } from "react";

interface DueSoonEntry {
  client: string;
  video: string;
  postDate: string | null;
  notes: string | null;
}

type LoadState = "loading" | "ready" | "error";

const dueDateFormatter = new Intl.DateTimeFormat(undefined, { weekday: "short", day: "numeric", month: "short" });

function formatPostDate(postDate: string): string {
  // postDate is "YYYY-MM-DD" (a plain calendar date, not an instant) — read
  // as UTC-midnight so the browser's own timezone conversion can't shift
  // it onto the wrong day.
  return dueDateFormatter.format(new Date(`${postDate}T00:00:00Z`));
}

/**
 * Always mounted on the dashboard like SuggestionCard — fetches
 * `GET /api/posting-schedule/due-soon` and renders nothing at all when
 * there's genuinely nothing due in the next 2 days, so a quiet stretch
 * doesn't clutter the dashboard with an empty card.
 */
export default function PostingSchedule() {
  const [entries, setEntries] = useState<DueSoonEntry[]>([]);
  const [state, setState] = useState<LoadState>("loading");

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const res = await fetch("/api/posting-schedule/due-soon");
        if (!res.ok) {
          throw new Error("Failed to load posting schedule");
        }
        const data: DueSoonEntry[] = await res.json();
        if (!cancelled) {
          setEntries(data);
          setState("ready");
        }
      } catch {
        if (!cancelled) {
          setState("error");
        }
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  if (state === "loading" || (state === "ready" && entries.length === 0)) {
    return null;
  }

  return (
    <section style={{ marginBottom: 32 }}>
      <h2 style={{ fontSize: 18, fontWeight: 700, margin: "0 0 12px" }}>Posting schedule — due soon</h2>

      {state === "error" ? (
        <p role="alert" style={{ color: "var(--color-danger)", margin: 0 }}>
          Couldn&apos;t load the posting schedule.
        </p>
      ) : null}

      {state === "ready" && entries.length > 0 ? (
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
          {entries.map((entry, index) => (
            <li
              // Sheet rows have no stable id of their own — index is fine
              // here since this list is re-fetched wholesale, never
              // reordered/edited in place.
              key={`${entry.client}-${entry.video}-${index}`}
              style={{
                border: "1px solid var(--color-border)",
                borderRadius: 10,
                padding: "10px 12px",
                backgroundColor: "var(--color-surface)",
                boxShadow: "var(--shadow-card)",
              }}
            >
              <div style={{ fontSize: 13, color: "var(--color-text-muted)" }}>
                {entry.postDate ? formatPostDate(entry.postDate) : null}
              </div>
              <div style={{ fontSize: 15, fontWeight: 600 }}>{entry.video}</div>
              <div style={{ fontSize: 13, color: "var(--color-text-muted)" }}>{entry.client}</div>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
