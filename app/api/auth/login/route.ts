import bcrypt from "bcryptjs";
import { NextResponse } from "next/server";
import { createSessionCookie, SESSION_COOKIE_NAME } from "@/lib/auth/session";

export async function POST(request: Request) {
  const body: unknown = await request.json().catch(() => null);
  const passcode =
    typeof body === "object" && body !== null && "passcode" in body
      ? (body as { passcode: unknown }).passcode
      : undefined;

  if (typeof passcode !== "string" || passcode.length === 0) {
    return NextResponse.json({ error: "Passcode is required" }, { status: 401 });
  }

  const passcodeHash = process.env.WORK_HUB_PASSCODE_HASH;
  if (!passcodeHash) {
    throw new Error("WORK_HUB_PASSCODE_HASH environment variable is not set");
  }

  const isValid = await bcrypt.compare(passcode, passcodeHash);
  if (!isValid) {
    return NextResponse.json({ error: "Invalid passcode" }, { status: 401 });
  }

  const response = NextResponse.json({ status: "ok" }, { status: 200 });
  response.cookies.set(SESSION_COOKIE_NAME, createSessionCookie(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
  });
  return response;
}
