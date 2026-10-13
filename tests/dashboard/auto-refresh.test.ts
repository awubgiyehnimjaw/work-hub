import { expect, test, vi } from "vitest";
import { createAutoRefresh, type AutoRefreshDeps } from "@/lib/dashboard/auto-refresh";

/** A fake AutoRefreshDeps that captures the registered listeners/interval
 * handler so a test can trigger them manually, without any real DOM. */
function fakeDeps(initialVisible = true) {
  let visible = initialVisible;
  let intervalHandler: (() => void) | undefined;
  let visibilityListener: (() => void) | undefined;
  let focusListener: (() => void) | undefined;
  let intervalCleared = false;
  let visibilityUnsubscribed = false;
  let focusUnsubscribed = false;

  const deps: AutoRefreshDeps<"the-interval-handle"> = {
    setInterval: vi.fn((handler) => {
      intervalHandler = handler;
      return "the-interval-handle" as const;
    }),
    clearInterval: vi.fn((handle) => {
      expect(handle).toBe("the-interval-handle");
      intervalCleared = true;
    }),
    addVisibilityListener: vi.fn((listener) => {
      visibilityListener = listener;
      return () => {
        visibilityUnsubscribed = true;
      };
    }),
    addFocusListener: vi.fn((listener) => {
      focusListener = listener;
      return () => {
        focusUnsubscribed = true;
      };
    }),
    isVisible: () => visible,
  };

  return {
    deps,
    setVisible: (value: boolean) => {
      visible = value;
    },
    fireInterval: () => intervalHandler?.(),
    fireVisibilityChange: () => visibilityListener?.(),
    fireFocus: () => focusListener?.(),
    wasIntervalCleared: () => intervalCleared,
    wasVisibilitySubscriptionTornDown: () => visibilityUnsubscribed,
    wasFocusSubscriptionTornDown: () => focusUnsubscribed,
  };
}

test("createAutoRefresh registers an interval with the given callback and interval", () => {
  const refresh = vi.fn();
  const { deps } = fakeDeps();

  createAutoRefresh(refresh, 60_000, deps);

  expect(deps.setInterval).toHaveBeenCalledWith(refresh, 60_000);
});

test("createAutoRefresh calls refresh when the interval fires", () => {
  const refresh = vi.fn();
  const { deps, fireInterval } = fakeDeps();

  createAutoRefresh(refresh, 60_000, deps);
  fireInterval();

  expect(refresh).toHaveBeenCalledTimes(1);
});

test("createAutoRefresh calls refresh on visibilitychange when the page is now visible", () => {
  const refresh = vi.fn();
  const { deps, fireVisibilityChange, setVisible } = fakeDeps();
  setVisible(true);

  createAutoRefresh(refresh, 60_000, deps);
  fireVisibilityChange();

  expect(refresh).toHaveBeenCalledTimes(1);
});

test("createAutoRefresh does NOT call refresh on visibilitychange when the page became hidden", () => {
  // This is the "PWA backgrounded" transition itself — not visible, so
  // there's nothing new to show and no reason to spend a network call.
  const refresh = vi.fn();
  const { deps, fireVisibilityChange, setVisible } = fakeDeps();
  setVisible(false);

  createAutoRefresh(refresh, 60_000, deps);
  fireVisibilityChange();

  expect(refresh).not.toHaveBeenCalled();
});

test("createAutoRefresh calls refresh on focus", () => {
  const refresh = vi.fn();
  const { deps, fireFocus } = fakeDeps();

  createAutoRefresh(refresh, 60_000, deps);
  fireFocus();

  expect(refresh).toHaveBeenCalledTimes(1);
});

test("the returned cleanup function tears down the interval and both listeners", () => {
  const refresh = vi.fn();
  const { deps, wasIntervalCleared, wasVisibilitySubscriptionTornDown, wasFocusSubscriptionTornDown } =
    fakeDeps();

  const cleanup = createAutoRefresh(refresh, 60_000, deps);
  cleanup();

  expect(wasIntervalCleared()).toBe(true);
  expect(wasVisibilitySubscriptionTornDown()).toBe(true);
  expect(wasFocusSubscriptionTornDown()).toBe(true);
});
