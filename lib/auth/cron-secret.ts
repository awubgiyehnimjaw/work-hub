/**
 * Bearer-secret auth for the cron endpoints (`/api/cron/*`). Those routes
 * are called by an external scheduler (GitHub Actions), not Callum's own
 * browser session, so they are explicitly allowlisted past the passcode
 * cookie check in middleware.ts and need their own gate here instead.
 */
export function checkCronSecret(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    // Fail closed: an unset secret must never be treated as "no auth
    // required".
    return false;
  }

  const header = req.headers.get("authorization");
  if (!header) {
    return false;
  }

  const [scheme, token] = header.split(" ");
  if (scheme !== "Bearer" || !token) {
    return false;
  }

  return timingSafeEqual(token, secret);
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }

  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}
