import { beforeEach, expect, test } from "vitest";
import {
  _resetRateLimiterForTests,
  getClientKey,
  getRemainingLockoutMs,
  isLockedOut,
  LOCKOUT_MS,
  MAX_FAILED_ATTEMPTS,
  recordFailedAttempt,
  recordSuccess,
} from "@/lib/auth/rate-limit";

beforeEach(() => {
  _resetRateLimiterForTests();
});

test("a fresh key is never locked out", () => {
  expect(isLockedOut("1.2.3.4", new Date())).toBe(false);
});

test("locks out a key after MAX_FAILED_ATTEMPTS failures", () => {
  const now = new Date();
  for (let i = 0; i < MAX_FAILED_ATTEMPTS - 1; i++) {
    recordFailedAttempt("1.2.3.4", now);
  }
  expect(isLockedOut("1.2.3.4", now)).toBe(false);

  recordFailedAttempt("1.2.3.4", now); // the MAX_FAILED_ATTEMPTS-th failure
  expect(isLockedOut("1.2.3.4", now)).toBe(true);
});

test("getRemainingLockoutMs reports close to LOCKOUT_MS immediately after lockout starts", () => {
  const now = new Date();
  for (let i = 0; i < MAX_FAILED_ATTEMPTS; i++) {
    recordFailedAttempt("1.2.3.4", now);
  }

  expect(getRemainingLockoutMs("1.2.3.4", now)).toBe(LOCKOUT_MS);
});

test("a key unlocks once LOCKOUT_MS has elapsed, and starts a fresh failure count", () => {
  const now = new Date();
  for (let i = 0; i < MAX_FAILED_ATTEMPTS; i++) {
    recordFailedAttempt("1.2.3.4", now);
  }
  expect(isLockedOut("1.2.3.4", now)).toBe(true);

  const afterLockout = new Date(now.getTime() + LOCKOUT_MS + 1);
  expect(isLockedOut("1.2.3.4", afterLockout)).toBe(false);
  expect(getRemainingLockoutMs("1.2.3.4", afterLockout)).toBe(0);

  // One more failure right after unlocking shouldn't immediately re-lock —
  // the count must have reset, not compounded onto the stale lockout.
  recordFailedAttempt("1.2.3.4", afterLockout);
  expect(isLockedOut("1.2.3.4", afterLockout)).toBe(false);
});

test("recordSuccess clears failure history for that key", () => {
  const now = new Date();
  for (let i = 0; i < MAX_FAILED_ATTEMPTS - 1; i++) {
    recordFailedAttempt("1.2.3.4", now);
  }

  recordSuccess("1.2.3.4");

  // Starting fresh: another MAX_FAILED_ATTEMPTS failures are needed again,
  // not just one more.
  for (let i = 0; i < MAX_FAILED_ATTEMPTS - 1; i++) {
    recordFailedAttempt("1.2.3.4", now);
  }
  expect(isLockedOut("1.2.3.4", now)).toBe(false);
});

test("lockout state is tracked independently per key", () => {
  const now = new Date();
  for (let i = 0; i < MAX_FAILED_ATTEMPTS; i++) {
    recordFailedAttempt("1.2.3.4", now);
  }

  expect(isLockedOut("1.2.3.4", now)).toBe(true);
  expect(isLockedOut("5.6.7.8", now)).toBe(false);
});

test("getClientKey uses the first hop of X-Forwarded-For when present", () => {
  const request = new Request("http://localhost/api/auth/login", {
    headers: { "x-forwarded-for": "203.0.113.5, 10.0.0.1" },
  });
  expect(getClientKey(request)).toBe("203.0.113.5");
});

test("getClientKey falls back to X-Real-Ip when X-Forwarded-For is absent", () => {
  const request = new Request("http://localhost/api/auth/login", {
    headers: { "x-real-ip": "203.0.113.9" },
  });
  expect(getClientKey(request)).toBe("203.0.113.9");
});

test("getClientKey falls back to a shared 'global' key when neither header is present", () => {
  const request = new Request("http://localhost/api/auth/login");
  expect(getClientKey(request)).toBe("global");
});
