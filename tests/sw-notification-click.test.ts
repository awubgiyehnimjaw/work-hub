import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { expect, test } from "vitest";

/**
 * `public/sw.js` is a classic (non-module) service worker script — it's
 * served to the browser as-is, with no bundler/TS step, and registered
 * without `{ type: "module" }`. That means it can't `export` anything
 * without breaking as a browser script, so there's no normal `import` path
 * into a test.
 *
 * Instead, this loads the real file text and runs it inside a `vm` context
 * whose global object stands in for the service-worker global scope. A
 * real service worker's `self` IS its global object (`self === globalThis`
 * there), so the sandbox is made self-referential the same way
 * (`sandbox.self = sandbox`) before running the script. That lets the
 * top-level `self.addEventListener(...)` calls execute against a stubbed
 * `addEventListener` without throwing, and — because a classic script's
 * top-level `function` declarations become properties of the global
 * object, exactly as in a real browser/service-worker scope —
 * `resolveNotificationClickAction` comes back out directly on the
 * sandbox, with zero changes needed to the shipped file to make it
 * reachable from a test.
 */
function loadServiceWorkerSandbox(): Record<string, unknown> {
  const source = readFileSync(path.resolve(import.meta.dirname, "../public/sw.js"), "utf8");
  const sandbox: Record<string, unknown> = { addEventListener: () => {} };
  sandbox.self = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: "sw.js" });
  return sandbox;
}

function getResolveFn() {
  const sandbox = loadServiceWorkerSandbox();
  const fn = sandbox.resolveNotificationClickAction as (
    clientUrls: string[],
    targetUrl: string,
  ) => { action: "focus"; index: number } | { action: "openWindow" };
  expect(typeof fn).toBe("function");
  return fn;
}

test("resolveNotificationClickAction opens a new window when no client matches the target URL exactly", () => {
  const resolve = getResolveFn();

  // The real-world case the review flagged: a Work Hub dashboard tab is
  // open (same-origin) but the notification's target is an external
  // Frame.io link — same-origin must NOT be treated as a match.
  const result = resolve(["https://workhub.example/"], "https://app.frame.io/reviews/abc123");

  expect(result).toEqual({ action: "openWindow" });
});

test("resolveNotificationClickAction focuses the client whose URL exactly matches the target", () => {
  const resolve = getResolveFn();

  const result = resolve(
    ["https://workhub.example/", "https://app.frame.io/reviews/abc123"],
    "https://app.frame.io/reviews/abc123",
  );

  expect(result).toEqual({ action: "focus", index: 1 });
});

test("resolveNotificationClickAction opens a new window when there are no open clients at all", () => {
  const resolve = getResolveFn();

  const result = resolve([], "https://app.frame.io/reviews/abc123");

  expect(result).toEqual({ action: "openWindow" });
});

test("resolveNotificationClickAction does not match on a same-origin URL that differs from the target", () => {
  const resolve = getResolveFn();

  // Two same-origin Work Hub tabs open at different routes, neither of
  // which is the (external) target — must still open a new window rather
  // than focusing either one.
  const result = resolve(
    ["https://workhub.example/", "https://workhub.example/history/client-1"],
    "https://app.frame.io/reviews/abc123",
  );

  expect(result).toEqual({ action: "openWindow" });
});
