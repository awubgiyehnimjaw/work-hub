import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";

/**
 * Single-passcode session cookie.
 *
 * This file is imported by `middleware.ts`, which Next.js runs on the Edge
 * runtime by default. Edge does not support Node's native `crypto` module
 * (no `require("crypto")`/`createHmac`), and the Web Crypto API
 * (`crypto.subtle`) is Promise-only — it cannot satisfy the synchronous
 * `string`/`boolean` signatures this module exposes. `@noble/hashes` is a
 * zero-dependency, pure-JS HMAC-SHA256 implementation with no native
 * bindings, so it runs identically (and synchronously) on Node and Edge.
 */

export const SESSION_COOKIE_NAME = "session";

// Important 10: a session cookie used to carry a constant signed payload
// ("authenticated") with no expiry check at all — any issued cookie was
// valid forever until SESSION_SECRET itself was rotated (too long-lived in
// principle), while having no `maxAge` on the cookie made it die whenever
// iOS terminated the installed PWA (too short-lived in practice). The
// payload now embeds an issued-at timestamp so `verifySessionCookie` can
// reject a cookie older than this, and the login route sets an explicit
// `maxAge` matching the same window so the cookie survives app restarts.
export const MAX_SESSION_AGE_MS = 90 * 24 * 60 * 60 * 1000; // 90 days

const PAYLOAD_PREFIX = "authenticated";
const PAYLOAD_RE = /^authenticated\.(\d+)$/;

function getSessionSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error("SESSION_SECRET environment variable is not set");
  }
  return secret;
}

function sign(payload: string): string {
  const key = utf8ToBytes(getSessionSecret());
  const message = utf8ToBytes(payload);
  return bytesToHex(hmac(sha256, key, message));
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

/**
 * Builds the signed value to store in the `session` cookie, embedding
 * `now`'s time as the issued-at timestamp `verifySessionCookie` later
 * checks against `MAX_SESSION_AGE_MS`. `now` defaults to the real clock;
 * the login route passes its own already-captured `now` so the cookie's
 * issued-at and the rest of that request's timestamps agree exactly.
 */
export function createSessionCookie(now: Date = new Date()): string {
  const payload = `${PAYLOAD_PREFIX}.${now.getTime()}`;
  return `${payload}.${sign(payload)}`;
}

/**
 * Verifies a cookie value produced by `createSessionCookie`: the
 * signature must match AND the embedded issued-at timestamp must be no
 * more than `MAX_SESSION_AGE_MS` old (and not in the future) as of `now`.
 * `now` defaults to the real clock; tests pass an explicit value to check
 * expiry without manipulating the system clock.
 */
export function verifySessionCookie(value: string | undefined, now: Date = new Date()): boolean {
  if (!value) {
    return false;
  }

  const separatorIndex = value.lastIndexOf(".");
  if (separatorIndex === -1) {
    return false;
  }

  const payload = value.slice(0, separatorIndex);
  const signature = value.slice(separatorIndex + 1);

  const payloadMatch = PAYLOAD_RE.exec(payload);
  if (!payloadMatch) {
    return false;
  }

  let expectedSignature: string;
  try {
    expectedSignature = sign(payload);
  } catch {
    // SESSION_SECRET missing/misconfigured — fail closed, not open.
    return false;
  }

  if (!timingSafeEqual(signature, expectedSignature)) {
    return false;
  }

  const issuedAtMs = Number(payloadMatch[1]);
  const ageMs = now.getTime() - issuedAtMs;
  return ageMs >= 0 && ageMs <= MAX_SESSION_AGE_MS;
}
