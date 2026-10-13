/**
 * Important 9: a simple in-memory rate limiter for `POST /api/auth/login`.
 *
 * Before this, the login route accepted unlimited attempts with no
 * throttle or lockout, guarding an app that holds real client business
 * data on a public URL. This is a single-tenant, single-passcode app —
 * not a general-purpose auth system — so a process-level (best-effort
 * IP-keyed) counter is the simplest effective approach: it throttles a
 * brute-force script without needing Redis, a DB table, or anything that
 * survives a restart. It resets on deploy/restart and isn't shared across
 * multiple server instances; that's an accepted trade-off here, not an
 * oversight — the goal is raising the cost of guessing, not airtight
 * distributed rate limiting.
 */

export const MAX_FAILED_ATTEMPTS = 5;
export const LOCKOUT_MS = 60 * 1000;

interface AttemptState {
  failedCount: number;
  lockedUntil: number | null;
}

const attemptsByKey = new Map<string, AttemptState>();

/** Milliseconds remaining in an active lockout for `key`, or 0 if none. */
export function getRemainingLockoutMs(key: string, now: Date): number {
  const state = attemptsByKey.get(key);
  if (!state?.lockedUntil) {
    return 0;
  }
  const remaining = state.lockedUntil - now.getTime();
  return remaining > 0 ? remaining : 0;
}

export function isLockedOut(key: string, now: Date): boolean {
  return getRemainingLockoutMs(key, now) > 0;
}

/**
 * Records one failed passcode attempt for `key`. Once
 * `MAX_FAILED_ATTEMPTS` is reached, `key` is locked out for `LOCKOUT_MS`.
 * An attempt made after a previous lockout has already expired starts a
 * fresh count rather than compounding onto the stale one.
 */
export function recordFailedAttempt(key: string, now: Date): void {
  const existing = attemptsByKey.get(key);
  const state: AttemptState =
    existing && (!existing.lockedUntil || existing.lockedUntil > now.getTime())
      ? existing
      : { failedCount: 0, lockedUntil: null };

  state.failedCount += 1;
  if (state.failedCount >= MAX_FAILED_ATTEMPTS) {
    state.lockedUntil = now.getTime() + LOCKOUT_MS;
  }
  attemptsByKey.set(key, state);
}

/** Clears any failure history for `key` — called on a successful login. */
export function recordSuccess(key: string): void {
  attemptsByKey.delete(key);
}

/** Test-only: clears all tracked state so tests don't leak into each other. */
export function _resetRateLimiterForTests(): void {
  attemptsByKey.clear();
}

/**
 * Best-effort client identifier for keying rate-limit state: the first
 * hop in `X-Forwarded-For` (what Vercel sets to the real client IP),
 * falling back to `X-Real-Ip`, falling back to a single shared `"global"`
 * key when neither header is present (e.g. local dev without a proxy in
 * front). The `"global"` fallback still throttles a single attacker's
 * script effectively — it's just coarser (one key for everyone) rather
 * than failing open.
 */
export function getClientKey(request: Request): string {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    const firstHop = forwardedFor.split(",")[0]?.trim();
    if (firstHop) {
      return firstHop;
    }
  }
  const realIp = request.headers.get("x-real-ip");
  if (realIp) {
    return realIp;
  }
  return "global";
}
