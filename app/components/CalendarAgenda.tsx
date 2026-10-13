"use client";

import { useEffect, useState } from "react";

interface CalendarEvent {
  id: string;
  title: string;
  startAt: string;
  endAt: string;
  location: string | null;
}

type LoadState = "loading" | "ready" | "error";

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  day: "numeric",
  month: "short",
});

const timeFormatter = new Intl.DateTimeFormat(undefined, {
  hour: "numeric",
  minute: "2-digit",
});

function formatRange(startAt: string, endAt: string): string {
  const start = new Date(startAt);
  const end = new Date(endAt);
  return `${dateFormatter.format(start)}, ${timeFormatter.format(start)}–${timeFormatter.format(end)}`;
}

/**
 * Self-contained: fetches its own data from `GET /api/calendar` rather than
 * receiving events as a prop, since the calendar agenda has no bearing on
 * the review-queue/to-do emptiness check that gates `SuggestionCard` — it
 * doesn't need to be coordinated with the rest of the dashboard's state.
 */
export default function CalendarAgenda() {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [state, setState] = useState<LoadState>("loading");

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const res = await fetch("/api/calendar");
        if (!res.ok) {
          throw new Error("Failed to load calendar");
        }
        const data: CalendarEvent[] = await res.json();
        if (!cancelled) {
          setEvents(data);
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

  return (
    <section style={{ marginBottom: 32 }}>
      <h2 style={{ fontSize: 18, fontWeight: 700, margin: "0 0 12px" }}>Next 14 days</h2>

      {state === "loading" ? <p style={{ color: "#6b7280", margin: 0 }}>Loading calendar…</p> : null}
      {state === "error" ? (
        <p role="alert" style={{ color: "#b42318", margin: 0 }}>
          Couldn&apos;t load the calendar.
        </p>
      ) : null}
      {state === "ready" && events.length === 0 ? (
        <p style={{ color: "#6b7280", margin: 0 }}>Nothing on the calendar for the next two weeks.</p>
      ) : null}

      {state === "ready" && events.length > 0 ? (
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
          {events.map((event) => (
            <li
              key={event.id}
              style={{
                border: "1px solid #e5e7eb",
                borderRadius: 10,
                padding: "10px 12px",
                backgroundColor: "#ffffff",
              }}
            >
              <div style={{ fontSize: 13, color: "#6b7280" }}>{formatRange(event.startAt, event.endAt)}</div>
              <div style={{ fontSize: 15, fontWeight: 600 }}>{event.title}</div>
              {event.location ? (
                <div style={{ fontSize: 13, color: "#6b7280" }}>{event.location}</div>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
