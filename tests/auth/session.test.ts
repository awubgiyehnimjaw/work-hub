import { beforeEach, expect, test } from "vitest";
import { createSessionCookie, MAX_SESSION_AGE_MS, verifySessionCookie } from "@/lib/auth/session";

beforeEach(() => {
  process.env.SESSION_SECRET = "test-session-secret";
});

test("verifySessionCookie accepts a cookie created by createSessionCookie", () => {
  const cookie = createSessionCookie();
  expect(verifySessionCookie(cookie)).toBe(true);
});

test("verifySessionCookie rejects a tampered cookie", () => {
  expect(verifySessionCookie("garbage")).toBe(false);
});

test("verifySessionCookie rejects an undefined cookie", () => {
  expect(verifySessionCookie(undefined)).toBe(false);
});

test("verifySessionCookie rejects an empty string cookie", () => {
  expect(verifySessionCookie("")).toBe(false);
});

test("verifySessionCookie rejects a real cookie with one signature character flipped", () => {
  const cookie = createSessionCookie();
  const lastChar = cookie.at(-1);
  const flippedChar = lastChar === "0" ? "1" : "0";
  const tampered = cookie.slice(0, -1) + flippedChar;

  expect(tampered).not.toBe(cookie);
  expect(verifySessionCookie(tampered)).toBe(false);
});

test("verifySessionCookie rejects a real cookie with the payload altered", () => {
  const cookie = createSessionCookie();
  // The real signature is everything after the LAST "." — the payload
  // itself (Important 10's fix) now contains an internal "." between the
  // "authenticated" marker and the issued-at timestamp, so a naive
  // `cookie.split(".")` destructure would grab the timestamp instead of
  // the signature.
  const signature = cookie.slice(cookie.lastIndexOf(".") + 1);
  const tampered = `admin.${signature}`;

  expect(verifySessionCookie(tampered)).toBe(false);
});

test("verifySessionCookie rejects a cookie signed under a different SESSION_SECRET", () => {
  const cookie = createSessionCookie();
  expect(verifySessionCookie(cookie)).toBe(true);

  process.env.SESSION_SECRET = "a-totally-different-secret";
  expect(verifySessionCookie(cookie)).toBe(false);
});

// Important 10 regression coverage: the signed payload used to be a
// constant string with no expiry at all — any issued cookie was valid
// forever. It now embeds an issued-at timestamp, checked against
// MAX_SESSION_AGE_MS.

test("verifySessionCookie accepts a cookie well within MAX_SESSION_AGE_MS", () => {
  const issuedAt = new Date("2026-01-01T00:00:00.000Z");
  const cookie = createSessionCookie(issuedAt);
  const checkAt = new Date(issuedAt.getTime() + 1 * 24 * 60 * 60 * 1000); // 1 day later

  expect(verifySessionCookie(cookie, checkAt)).toBe(true);
});

test("verifySessionCookie accepts a cookie exactly at the MAX_SESSION_AGE_MS boundary", () => {
  const issuedAt = new Date("2026-01-01T00:00:00.000Z");
  const cookie = createSessionCookie(issuedAt);
  const checkAt = new Date(issuedAt.getTime() + MAX_SESSION_AGE_MS);

  expect(verifySessionCookie(cookie, checkAt)).toBe(true);
});

test("verifySessionCookie rejects a cookie one millisecond past MAX_SESSION_AGE_MS", () => {
  const issuedAt = new Date("2026-01-01T00:00:00.000Z");
  const cookie = createSessionCookie(issuedAt);
  const checkAt = new Date(issuedAt.getTime() + MAX_SESSION_AGE_MS + 1);

  expect(verifySessionCookie(cookie, checkAt)).toBe(false);
});

test("verifySessionCookie rejects a cookie that's been expired for a long time (e.g. 120 days old)", () => {
  const issuedAt = new Date("2026-01-01T00:00:00.000Z");
  const cookie = createSessionCookie(issuedAt);
  const checkAt = new Date(issuedAt.getTime() + 120 * 24 * 60 * 60 * 1000);

  expect(verifySessionCookie(cookie, checkAt)).toBe(false);
});

test("verifySessionCookie rejects a cookie whose issued-at is in the future", () => {
  const now = new Date("2026-01-01T00:00:00.000Z");
  const issuedInFuture = new Date(now.getTime() + 60 * 1000);
  const cookie = createSessionCookie(issuedInFuture);

  expect(verifySessionCookie(cookie, now)).toBe(false);
});

test("verifySessionCookie rejects a cookie with a non-numeric issued-at in the payload", () => {
  // Can't be produced by createSessionCookie, but guards the payload
  // shape check itself against malformed/hand-crafted input.
  expect(verifySessionCookie("authenticated.not-a-number.deadbeef")).toBe(false);
});
