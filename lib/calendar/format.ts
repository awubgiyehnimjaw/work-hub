/**
 * Formats a calendar event's date/time range for the dashboard agenda
 * (`CalendarAgenda.tsx`). Split out so it's unit-testable directly in
 * Node (no jsdom needed — `Intl.DateTimeFormat` is a Node global), same
 * pattern as `lib/push/client.ts` and `lib/dashboard/auto-refresh.ts`.
 *
 * Important 11: an all-day (date-only) Google Calendar event used to be
 * passed through the same formatting path as a timed event, producing
 * nonsense like "1:00 AM–1:00 AM" for what's actually a full-day block
 * (e.g. a filming day) — and worse, the displayed CALENDAR DAY itself
 * could shift depending on the viewer's local timezone offset, since an
 * all-day event is stored as a UTC-midnight-anchored instant (see
 * `lib/calendar/google-client.ts`). Reading that instant's date in the
 * viewer's local timezone would show the previous day for anyone in a
 * timezone behind UTC, until local midnight finally catches up to the
 * stored UTC instant. `buildFormatters().allDayDate` below is pinned to
 * UTC specifically to prevent that — timed events still use the viewer's
 * own local timezone (`date`/`time`), which is correct for them; only the
 * all-day case needs to be anchored to UTC.
 */

export interface TimingEvent {
  startAt: string;
  endAt: string;
  allDay: boolean;
}

/**
 * Formatters are built fresh on every call rather than hoisted to module
 * scope: `Intl.DateTimeFormat`'s resolved local timezone (used for timed
 * events, where `undefined`/no explicit `timeZone` means "the viewer's
 * own") is captured at CONSTRUCTION time, not at `.format()` time. A
 * module-level singleton would bake in whichever timezone happened to be
 * active the moment this module first loaded, which is both wrong for a
 * long-running server process and untestable. The per-call cost is
 * negligible here — this runs on dashboard renders, not in a hot loop.
 */
function buildFormatters() {
  return {
    date: new Intl.DateTimeFormat(undefined, { weekday: "short", day: "numeric", month: "short" }),
    time: new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }),
    // Pinned to UTC specifically — see the module doc comment above for why
    // an all-day event's calendar date must never follow the viewer's local
    // timezone the way a timed event's clock time correctly does.
    allDayDate: new Intl.DateTimeFormat(undefined, {
      weekday: "short",
      day: "numeric",
      month: "short",
      timeZone: "UTC",
    }),
  };
}

/**
 * `endAt` for an all-day event is already normalized to an INCLUSIVE last
 * day by `lib/calendar/google-client.ts` (Google's own `end.date` is
 * exclusive) — this just displays the given start/end, it doesn't need to
 * (and must not) redo that exclusive/inclusive adjustment itself.
 */
export function formatEventTiming(event: TimingEvent): string {
  const formatters = buildFormatters();
  const start = new Date(event.startAt);
  const end = new Date(event.endAt);

  if (event.allDay) {
    const startLabel = formatters.allDayDate.format(start);
    const endLabel = formatters.allDayDate.format(end);
    return startLabel === endLabel
      ? `${startLabel} · All day`
      : `${startLabel} – ${endLabel} · All day`;
  }

  return `${formatters.date.format(start)}, ${formatters.time.format(start)}–${formatters.time.format(end)}`;
}
