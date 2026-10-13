import bcrypt from "bcryptjs";
import { NextResponse } from "next/server";
import {
  getClientKey,
  getRemainingLockoutMs,
  isLockedOut,
  recordFailedAttempt,
  recordSuccess,
} from "@/lib/auth/rate-limit";
import { createSessionCookie, MAX_SESSION_AGE_MS, SESSION_COOKIE_NAME } from "@/lib/auth/session";

/**
 * Important 9: guards against unlimited passcode-guessing on a public URL.
 * The rate-limit check runs before anything else (including parsing the
 * body) so a locked-out caller never even reaches the bcrypt comparison.
 */
export async function POST(request: Request) {
  const clientKey = getClientKey(request);
  const now = new Date();

  if (isLockedOut(clientKey, now)) {
    const retryAfterSeconds = Math.ceil(getRemainingLockoutMs(clientKey, now) / 1000);
    return NextResponse.json(
      { error: "Too many attempts. Try again shortly." },
      { status: 429, headers: { "Retry-After": String(retryAfterSeconds) } },
    );
  }

  const body: unknown = await request.json().catch(() => null);
  const passcode =
    typeof body === "object" && body !== null && "passcode" in body
      ? (body as { passcode: unknown }).passcode
      : undefined;

  if (typeof passcode !== "string" || passcode.length === 0) {
    recordFailedAttempt(clientKey, now);
    return NextResponse.json({ error: "Passcode is required" }, { status: 401 });
  }

  const passcodeHash = process.env.WORK_HUB_PASSCODE_HASH;
  if (!passcodeHash) {
    throw new Error("WORK_HUB_PASSCODE_HASH environment variable is not set");
  }

  const isValid = await bcrypt.compare(passcode, passcodeHash);
  if (!isValid) {
    recordFailedAttempt(clientKey, now);
    return NextResponse.json({ error: "Invalid passcode" }, { status: 401 });
  }

  recordSuccess(clientKey);

  const response = NextResponse.json({ status: "ok" }, { status: 200 });
  response.cookies.set(SESSION_COOKIE_NAME, createSessionCookie(now), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    // Important 10: an explicit maxAge (matching the same window
    // verifySessionCookie enforces server-side) so the cookie survives
    // iOS terminating the installed PWA between sessions, rather than
    // being a pure browser-session cookie that forces a re-login every
    // time the app is relaunched.
    maxAge: Math.floor(MAX_SESSION_AGE_MS / 1000),
  });
  return response;
}
