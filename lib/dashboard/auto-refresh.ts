/**
 * Important 5 fix: `app/page.tsx` and `CalendarAgenda.tsx` each previously
 * fetched their data exactly once, on mount, with no refetch on
 * visibility/focus change and no polling interval — an installed PWA
 * resumed from background after hours could sit there showing stale data
 * indefinitely.
 *
 * The scheduling logic is split out from both components (same pattern as
 * `lib/push/client.ts`) so it can be unit tested directly, without a
 * jsdom/React Testing Library setup this project doesn't have — the real
 * `document`/`window` wiring lives in `createBrowserAutoRefreshDeps`,
 * injected as a plain dependency object `createAutoRefresh` can be given
 * fakes for in tests.
 */

// 60s is a light backstop, not the primary refresh path — visibility/focus
// changes (the common "reopened the installed PWA" case) refetch
// immediately rather than waiting out this interval.
export const AUTO_REFRESH_INTERVAL_MS = 60 * 1000;

export interface AutoRefreshDeps<TimerHandle> {
  setInterval: (handler: () => void, ms: number) => TimerHandle;
  clearInterval: (handle: TimerHandle) => void;
  /** Registers a `visibilitychange` listener; returns an unsubscribe function. */
  addVisibilityListener: (listener: () => void) => () => void;
  /** Registers a `focus` listener; returns an unsubscribe function. */
  addFocusListener: (listener: () => void) => () => void;
  isVisible: () => boolean;
}

/**
 * Wires `refresh` up to fire on a periodic interval, on `focus`, and on
 * `visibilitychange` (only when the page has actually become visible, not
 * when it's hidden). Returns a single cleanup function that tears down all
 * three — call it from a `useEffect` cleanup.
 */
export function createAutoRefresh<TimerHandle>(
  refresh: () => void,
  intervalMs: number,
  deps: AutoRefreshDeps<TimerHandle>,
): () => void {
  const intervalHandle = deps.setInterval(refresh, intervalMs);

  const unsubscribeVisibility = deps.addVisibilityListener(() => {
    if (deps.isVisible()) {
      refresh();
    }
  });

  const unsubscribeFocus = deps.addFocusListener(refresh);

  return () => {
    deps.clearInterval(intervalHandle);
    unsubscribeVisibility();
    unsubscribeFocus();
  };
}

/** Real browser wiring for `createAutoRefresh`, used by the dashboard components. */
export function createBrowserAutoRefreshDeps(): AutoRefreshDeps<ReturnType<typeof setInterval>> {
  return {
    setInterval: (handler, ms) => setInterval(handler, ms),
    clearInterval: (handle) => clearInterval(handle),
    addVisibilityListener: (listener) => {
      document.addEventListener("visibilitychange", listener);
      return () => document.removeEventListener("visibilitychange", listener);
    },
    addFocusListener: (listener) => {
      window.addEventListener("focus", listener);
      return () => window.removeEventListener("focus", listener);
    },
    isVisible: () => document.visibilityState === "visible",
  };
}
