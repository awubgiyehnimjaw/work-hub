import bcrypt from "bcryptjs";
import { beforeAll, expect, test } from "vitest";
import { POST } from "@/app/api/auth/login/route";
import { verifySessionCookie } from "@/lib/auth/session";

const TEST_PASSCODE = "test-passcode";

beforeAll(() => {
  process.env.SESSION_SECRET = "test-session-secret";
  process.env.WORK_HUB_PASSCODE_HASH = bcrypt.hashSync(TEST_PASSCODE, 10);
});

function loginRequest(passcode: unknown) {
  return new Request("http://localhost/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
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
