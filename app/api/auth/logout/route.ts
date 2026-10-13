import { NextResponse } from "next/server";
import { SESSION_COOKIE_NAME } from "@/lib/auth/session";

export async function POST() {
  const response = NextResponse.json({ status: "ok" }, { status: 200 });
  response.cookies.delete(SESSION_COOKIE_NAME);
  return response;
}
