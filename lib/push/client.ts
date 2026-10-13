/**
 * Browser-side push helpers used by EnableNotificationsButton. Split out
 * from the component so the base64url conversion — the single
 * easiest-to-get-wrong step in the whole subscribe flow — can be unit
 * tested directly, without needing a DOM/jsdom environment (this file
 * only touches the global `atob`, available in both browsers and Node).
 */

/**
 * Converts a VAPID public key from the base64url encoding web-push and
 * `VAPID_PUBLIC_KEY`/`NEXT_PUBLIC_VAPID_PUBLIC_KEY` use into the raw
 * `Uint8Array` the Push API's `applicationServerKey` requires.
 *
 * The common mistake here is treating the key as plain base64 (or
 * forgetting the URL-safe `-`/`_` substitution): VAPID keys are
 * base64*url*, unpadded, so both restoring the `=` padding and swapping
 * `-`→`+` / `_`→`/` below are required before `atob` decodes it correctly.
 * Standard implementation, matching the widely-used MDN/web.dev reference
 * version.
 */
export function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}
