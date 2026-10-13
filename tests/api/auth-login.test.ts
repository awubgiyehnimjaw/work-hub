import bcrypt from "bcryptjs";
import { beforeAll, beforeEach, expect, test } from "vitest";
import { POST } from "@/app/api/auth/login/route";
import { _resetRateLimiterForTests, MAX_FAILED_ATTEMPTS } from "@/lib/auth/rate-limit";
import { verifySessionCookie } from "@/lib/auth/session";

const TEST_PASSCODE = "test-passcode";

beforeAll(() => {
  process.env.SESSION_SECRET = "test-session-secret";
  process.env.WORK_HUB_PASSCODE_HASH = bcrypt.hashSync(TEST_PASSCODE, 10);
});

// Important 9's rate limiter is process-level state, keyed on the request's
// (missing, in these tests) IP headers — every request below shares the
// same "global" key, so each test needs a clean slate or they'd bleed
// failed-attempt counts into each other.
beforeEach(() => {
  _resetRateLimiterForTests();
});

function loginRequest(passcode: unknown, headers: HeadersInit = {}) {
  return new Request("http://localhost/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify({ passcode }),
  });
}

test("POST /api/auth/login sets a valid session cookie and returns 200 for the correct passcode", async () => {
  const res = await POST(loginRequest(TEST_PASSCODE));

  expect(res.status).toBe(200);

  const cookieHeader = res.headers.get("set-cookie");
  expect(cookieHeader).toBeTruthy();
  expect(cookieHeader).toMatch(/^session=/);
  expect(cookieHeader).toContain("HttpOnly");

  const cookieValue = cookieHeader!.split(";")[0].split("=").slice(1).join("=");
  expect(verifySessionCookie(cookieValue)).toBe(true);
});

test("POST /api/auth/login returns 401 and sets no cookie for an incorrect passcode", async () => {
  const res = await POST(loginRequest("wrong-passcode"));

  expect(res.status).toBe(401);
  expect(res.headers.get("set-cookie")).toBeNull();
});

test("POST /api/auth/login returns 401 when the passcode is missing from the body", async () => {
  const res = await POST(loginRequest(undefined));

  expect(res.status).toBe(401);
  expect(res.headers.get("set-cookie")).toBeNull();
});

test("POST /api/auth/login returns 401 for a non-JSON body instead of throwing", async () => {
  const res = await POST(
    new Request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not json",
    }),
  );

  expect(res.status).toBe(401);
});

// Important 9 regression coverage: unlimited login attempts used to be
// accepted with no throttle or lockout at all.

test(`POST /api/auth/login returns 429 after ${MAX_FAILED_ATTEMPTS} failed attempts from the same client`, async () => {
  for (let i = 0; i < MAX_FAILED_ATTEMPTS; i++) {
    const res = await POST(loginRequest("wrong-passcode"));
    expect(res.status).toBe(401);
  }

  // The next attempt is locked out even though it's otherwise unauthenticated.
  const lockedOutRes = await POST(loginRequest("wrong-passcode"));
  expect(lockedOutRes.status).toBe(429);
  expect(lockedOutRes.headers.get("Retry-After")).toBeTruthy();
});

test("POST /api/auth/login returns 429 and rejects even the CORRECT passcode once locked out", async () => {
  for (let i = 0; i < MAX_FAILED_ATTEMPTS; i++) {
    await POST(loginRequest("wrong-passcode"));
  }

  const res = await POST(loginRequest(TEST_PASSCODE));

  expect(res.status).toBe(429);
  expect(res.headers.get("set-cookie")).toBeNull();
});

test("POST /api/auth/login tracks failed attempts independently per client (X-Forwarded-For)", async () => {
  for (let i = 0; i < MAX_FAILED_ATTEMPTS; i++) {
    await POST(loginRequest("wrong-passcode", { "x-forwarded-for": "203.0.113.5" }));
  }

  // A different client is unaffected by the first one's lockout.
  const res = await POST(
    loginRequest(TEST_PASSCODE, { "x-forwarded-for": "203.0.113.9" }),
  );
  expect(res.status).toBe(200);
});

test("POST /api/auth/login does not count a successful login as a failed attempt toward lockout", async () => {
  for (let i = 0; i < MAX_FAILED_ATTEMPTS - 1; i++) {
    await POST(loginRequest("wrong-passcode"));
  }

  const successRes = await POST(loginRequest(TEST_PASSCODE));
  expect(successRes.status).toBe(200);

  // A fresh set of failures is needed to lock out again — the successful
  // login must have reset the counter, not left it one away from tripping.
  for (let i = 0; i < MAX_FAILED_ATTEMPTS - 1; i++) {
    const res = await POST(loginRequest("wrong-passcode"));
    expect(res.status).toBe(401);
  }
});
