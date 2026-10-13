import { NextRequest } from "next/server";
import { beforeEach, expect, test } from "vitest";
import { middleware } from "@/middleware";
import { createSessionCookie, SESSION_COOKIE_NAME } from "@/lib/auth/session";

// middleware.ts is the sole access-control chokepoint for every protected
// route in the app: if its allowlist or cookie check regresses, nothing
// else catches it. These tests call the exported `middleware` function
// directly with a real `NextRequest` (constructing one works fine outside
// an actual server — verified by probing `nextUrl`/`cookies` parsing before
// writing these), rather than spinning up a Next.js server, mirroring how
// `tests/api/auth-login.test.ts` calls the route handler's exported `POST`
// directly instead of going through a real HTTP stack.

beforeEach(() => {
  process.env.SESSION_SECRET = "test-session-secret";
});

function requestFor(pathname: string, cookieValue?: string): NextRequest {
  const headers: HeadersInit = {};
  if (cookieValue !== undefined) {
    headers["cookie"] = `${SESSION_COOKIE_NAME}=${cookieValue}`;
  }
  return new NextRequest(new URL(pathname, "http://localhost"), { headers });
}

test("protected path with no session cookie redirects to /login", () => {
  const res = middleware(requestFor("/"));

  expect(res.status).toBe(307);
  expect(res.headers.get("location")).toBe("http://localhost/login");
});

test("protected path with a valid session cookie passes through", () => {
  const cookie = createSessionCookie();
  const res = middleware(requestFor("/", cookie));

  expect(res.headers.get("location")).toBeNull();
  expect(res.status).toBe(200);
});

test.each(["/login", "/api/auth/login", "/api/auth/logout", "/api/cron/poll-frameio"])(
  "allowlisted path %s with no cookie passes through without redirect",
  (path) => {
    const res = middleware(requestFor(path));

    expect(res.headers.get("location")).toBeNull();
    expect(res.status).toBe(200);
  },
);

test("protected path with a tampered/invalid cookie redirects to /login", () => {
  const res = middleware(requestFor("/", "garbage"));

  expect(res.status).toBe(307);
  expect(res.headers.get("location")).toBe("http://localhost/login");
});

test("protected path with a cookie signed under a different secret redirects to /login", () => {
  const cookie = createSessionCookie();
  process.env.SESSION_SECRET = "a-totally-different-secret";

  const res = middleware(requestFor("/", cookie));

  expect(res.status).toBe(307);
  expect(res.headers.get("location")).toBe("http://localhost/login");
});

test("a non-allowlisted nested path is also protected", () => {
  const res = middleware(requestFor("/settings/profile"));

  expect(res.status).toBe(307);
  expect(res.headers.get("location")).toBe("http://localhost/login");
});
