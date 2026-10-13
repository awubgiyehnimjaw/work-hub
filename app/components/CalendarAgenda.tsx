"use client";

import { useEffect, useState } from "react";
import { formatEventTiming } from "@/lib/calendar/format";
import {
  AUTO_REFRESH_INTERVAL_MS,
  createAutoRefresh,
  createBrowserAutoRefreshDeps,
} from "@/lib/dashboard/auto-refresh";

interface CalendarEvent {
  id: string;
  title: string;
  startAt: string;
  endAt: string;
  location: string | null;
  allDay: boolean;
}

type LoadState = "loading" | "ready" | "error";

/**
 * Self-contained: fetches its own data from `GET /api/calendar` rather than
 * receiving events as a prop, since the calendar agenda has no bearing on
 * the review-queue/to-do emptiness check that gates `SuggestionCard` — it
 * doesn't need to be coordinated with the rest of the dashboard's state.
 *
 * Important 5: `load` is also wired up to re-run on focus/visibility
 * changes and a light polling interval (`createAutoRefresh`), not just
 * once on mount — otherwise an installed PWA resumed from background could
 * show a stale agenda for hours. `cancelled` guards every one of those
 * repeated calls, not just the first, so a call still in flight at unmount
 * never sets state on an unmounted component.
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
    const cleanupAutoRefresh = createAutoRefresh(
      load,
      AUTO_REFRESH_INTERVAL_MS,
      createBrowserAutoRefreshDeps(),
    );

    return () => {
      cancelled = true;
      cleanupAutoRefresh();
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
              <div style={{ fontSize: 13, color: "#6b7280" }}>{formatEventTiming(event)}</div>
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
