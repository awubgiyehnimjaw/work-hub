import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE_NAME, verifySessionCookie } from "@/lib/auth/session";

// Everything is behind the single passcode session except: the login page
// itself, the auth routes used to establish/clear that session, and the
// cron routes — those get their own separate bearer-secret auth (added in
// a later task), not this cookie check.
const PUBLIC_PATH_PREFIXES = ["/login", "/api/auth", "/api/cron"];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATH_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  const sessionCookie = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!verifySessionCookie(sessionCookie)) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
