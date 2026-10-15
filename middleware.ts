import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE_NAME, verifySessionCookie } from "@/lib/auth/session";

// Everything is behind the single passcode session except: the login page
// itself, the auth routes used to establish/clear that session, the cron
// routes (which get their own separate bearer-secret auth), the Telegram
// webhook (same reasoning — it gets its own secret-header auth via
// checkTelegramWebhookSecret, since Telegram can't do the passcode
// handshake), and the PWA static assets (manifest, service worker, icons).
// Those last three must stay reachable without a session cookie: the root
// layout's `<link rel="manifest">`/service-worker registration run on
// every page load including the unauthenticated /login page, and a
// redirect-to-login response in place of the real file would make the
// manifest invalid and service-worker registration fail (wrong MIME type)
// instead of just quietly skipping. None of these expose any user data —
// same category as favicon.ico, already exempted below via the matcher.
const PUBLIC_PATH_PREFIXES = ["/login", "/api/auth", "/api/cron", "/api/telegram", "/manifest.json", "/sw.js", "/icons"];

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
