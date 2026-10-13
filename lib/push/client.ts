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

export interface PushSubscriptionPayload {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

/** Minimal shape consumed from a real `PushSubscription` — just `toJSON()`. */
export interface SubscriptionLike {
  toJSON(): { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
}

/**
 * Validates and normalizes a browser `PushSubscription` into the exact
 * `{ endpoint, keys: { p256dh, auth } }` shape `POST /api/push/subscribe`
 * expects — `null` if any required field is missing (which `toJSON()`
 * allows in its type, even though it shouldn't happen in practice for a
 * subscription the browser itself just handed back).
 */
export function toSubscriptionPayload(
  subscription: SubscriptionLike,
): PushSubscriptionPayload | null {
  const json = subscription.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
    return null;
  }
  return {
    endpoint: json.endpoint,
    keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
  };
}

export type PushReconcileAction =
  | { kind: "none" }
  | { kind: "post-existing"; payload: PushSubscriptionPayload }
  | { kind: "resubscribe" };

/**
 * Decides what `EnableNotificationsButton` should do on mount, given the
 * browser's current Notification permission and whatever
 * `pushManager.getSubscription()` returned (Critical 2's fix).
 *
 * Before this, the button inferred `state = "enabled"` purely from
 * `Notification.permission === "granted"`, with no check that a real
 * subscription is still registered server-side. `lib/push/send.ts` deletes
 * the server-side `pushSubscriptions` row whenever a push service reports
 * the subscription as dead (404/410) — normal lifecycle (OS/browser
 * invalidation, PWA reinstall, etc.) — so after that happens once, the
 * server has zero subscriptions while the UI claimed "enabled" forever,
 * with no way to re-subscribe short of revoking and re-granting the OS
 * permission.
 *
 * - Permission not granted: nothing to reconcile.
 * - Permission granted AND a subscription still exists locally: re-POST it
 *   to `/api/push/subscribe` anyway. The upsert there is keyed on
 *   `endpoint` and idempotent, so this is cheap, and it's exactly the fix
 *   for "the local subscription is still valid but the server-side row was
 *   deleted" — the case `sendPush`'s cleanup can produce without the
 *   browser ever finding out.
 * - Permission granted AND no subscription exists locally (e.g. the OS
 *   revoked it, or a push-service-side cleanup invalidated it): subscribe
 *   again automatically, the same flow the initial "Enable notifications"
 *   click uses — Callum should never have to notice this happened and
 *   manually re-click.
 */
export function decidePushReconcileAction(
  permission: NotificationPermission,
  existingSubscription: SubscriptionLike | null,
): PushReconcileAction {
  if (permission !== "granted") {
    return { kind: "none" };
  }
  if (!existingSubscription) {
    return { kind: "resubscribe" };
  }
  const payload = toSubscriptionPayload(existingSubscription);
  return payload ? { kind: "post-existing", payload } : { kind: "resubscribe" };
}
