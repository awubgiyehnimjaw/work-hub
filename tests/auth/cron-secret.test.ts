import { beforeEach, expect, test } from "vitest";
import { checkCronSecret } from "@/lib/auth/cron-secret";

beforeEach(() => {
  process.env.CRON_SECRET = "test-cron-secret";
});

function requestWith(authorizationHeader?: string): Request {
  const headers: HeadersInit = {};
  if (authorizationHeader !== undefined) {
    headers["authorization"] = authorizationHeader;
  }
  return new Request("http://localhost/api/cron/poll-frameio", { headers });
}

test("accepts the correct bearer token", () => {
  expect(checkCronSecret(requestWith("Bearer test-cron-secret"))).toBe(true);
});

test("rejects a missing Authorization header", () => {
  expect(checkCronSecret(requestWith())).toBe(false);
});

test("rejects the wrong token", () => {
  expect(checkCronSecret(requestWith("Bearer wrong-secret"))).toBe(false);
});

test("rejects a header missing the Bearer scheme", () => {
  expect(checkCronSecret(requestWith("test-cron-secret"))).toBe(false);
});

test("rejects a different auth scheme", () => {
  expect(checkCronSecret(requestWith("Basic test-cron-secret"))).toBe(false);
});

test("fails closed when CRON_SECRET is not set", () => {
  delete process.env.CRON_SECRET;
  expect(checkCronSecret(requestWith("Bearer test-cron-secret"))).toBe(false);
});
