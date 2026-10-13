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

// There is no per-user data in a single-passcode session, so the signed
// payload is just a fixed marker. Its value doesn't matter for security —
// what matters is that only someone holding SESSION_SECRET can produce a
// signature that verifies against it.
const SESSION_PAYLOAD = "authenticated";

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

/** Builds the signed value to store in the `session` cookie. */
export function createSessionCookie(): string {
  return `${SESSION_PAYLOAD}.${sign(SESSION_PAYLOAD)}`;
}

/** Verifies a cookie value produced by `createSessionCookie`. */
export function verifySessionCookie(value: string | undefined): boolean {
  if (!value) {
    return false;
  }

  const separatorIndex = value.lastIndexOf(".");
  if (separatorIndex === -1) {
    return false;
  }

  const payload = value.slice(0, separatorIndex);
  const signature = value.slice(separatorIndex + 1);

  if (payload !== SESSION_PAYLOAD) {
    return false;
  }

  let expectedSignature: string;
  try {
    expectedSignature = sign(payload);
  } catch {
    // SESSION_SECRET missing/misconfigured — fail closed, not open.
    return false;
  }

  return timingSafeEqual(signature, expectedSignature);
}
