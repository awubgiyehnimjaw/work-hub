import { beforeEach, expect, test } from "vitest";
import { createSessionCookie, verifySessionCookie } from "@/lib/auth/session";

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
  const [, signature] = cookie.split(".");
  const tampered = `admin.${signature}`;

  expect(verifySessionCookie(tampered)).toBe(false);
});

test("verifySessionCookie rejects a cookie signed under a different SESSION_SECRET", () => {
  const cookie = createSessionCookie();
  expect(verifySessionCookie(cookie)).toBe(true);

  process.env.SESSION_SECRET = "a-totally-different-secret";
  expect(verifySessionCookie(cookie)).toBe(false);
});
