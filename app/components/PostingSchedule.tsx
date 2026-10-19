"use client";

import { useEffect, useState } from "react";

type PostingScheduleStatus = "none" | "green" | "red";

interface DueSoonEntry {
  client: string;
  video: string;
  postDate: string | null;
  notes: string | null;
  entryKey: string;
  status: PostingScheduleStatus;
}

type LoadState = "loading" | "ready" | "error";

const dueDateFormatter = new Intl.DateTimeFormat(undefined, { weekday: "short", day: "numeric", month: "short" });

function formatPostDate(postDate: string): string {
  // postDate is "YYYY-MM-DD" (a plain calendar date, not an instant) — read
  // as UTC-midnight so the browser's own timezone conversion can't shift
  // it onto the wrong day.
  return dueDateFormatter.format(new Date(`${postDate}T00:00:00Z`));
}

// Card border/background per status — mirrors TodoList's dueCardStyle, just
// a 2-color scheme (no green/no colour/red instead of green/yellow/red).
function statusCardStyle(status: PostingScheduleStatus): { border: string; backgroundColor: string } {
  switch (status) {
    case "red":
      return { border: "1px solid var(--color-danger-border)", backgroundColor: "var(--color-danger-bg)" };
    case "green":
      return { border: "1px solid var(--color-success-border)", backgroundColor: "var(--color-success-bg)" };
    default:
      return { border: "1px solid var(--color-border)", backgroundColor: "var(--color-surface)" };
  }
}

/**
 * Always mounted on the dashboard like SuggestionCard — fetches
 * `GET /api/posting-schedule/due-soon` and renders nothing at all when
 * there's genuinely nothing due in the next 3 days. An entry that goes
 * overdue keeps showing (and turns red) rather than silently dropping off;
 * pressing "Done" is what actually removes it, via
 * `POST /api/posting-schedule/complete`.
 */
export default function PostingSchedule() {
  const [entries, setEntries] = useState<DueSoonEntry[]>([]);
  const [state, setState] = useState<LoadState>("loading");
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [errorKey, setErrorKey] = useState<string | null>(null);

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

  async function handleDone(entryKey: string) {
    setBusyKey(entryKey);
    setErrorKey(null);
    try {
      const res = await fetch("/api/posting-schedule/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entryKey }),
      });
      if (!res.ok) {
        throw new Error("Failed to mark done");
      }
      setEntries((current) => current.filter((entry) => entry.entryKey !== entryKey));
    } catch {
      setErrorKey(entryKey);
    } finally {
      setBusyKey(null);
    }
  }

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
          {entries.map((entry) => {
            const cardStyle = statusCardStyle(entry.status);
            const isBusy = busyKey === entry.entryKey;
            return (
              <li
                key={entry.entryKey}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 8,
                  border: cardStyle.border,
                  backgroundColor: cardStyle.backgroundColor,
                  borderRadius: 10,
                  padding: "10px 12px",
                  boxShadow: "var(--shadow-card)",
                }}
              >
                <div>
                  <div style={{ fontSize: 13, color: "var(--color-text-muted)" }}>
                    {entry.postDate ? formatPostDate(entry.postDate) : null}
                  </div>
                  <div style={{ fontSize: 15, fontWeight: 600 }}>{entry.video}</div>
                  <div style={{ fontSize: 13, color: "var(--color-text-muted)" }}>{entry.client}</div>
                </div>
                <button
                  type="button"
                  disabled={isBusy}
                  onClick={() => handleDone(entry.entryKey)}
                  aria-label={`Mark "${entry.video}" done`}
                  className="interactive"
                  style={{
                    backgroundColor: "var(--color-surface-muted)",
                    color: "var(--color-text)",
                    border: "1px solid var(--color-border)",
                    borderRadius: 8,
                    padding: "6px 10px",
                    fontSize: 13,
                    fontWeight: 600,
                    opacity: isBusy ? 0.6 : 1,
                    whiteSpace: "nowrap",
                  }}
                >
                  Done
                </button>
                {errorKey === entry.entryKey ? (
                  <span role="alert" style={{ color: "var(--color-danger)", fontSize: 12 }}>
                    Failed
                  </span>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}
