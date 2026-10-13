/**
 * Web Push sender, wrapping the `web-push` npm package with VAPID signing.
 *
 * `runFrameioPoll` (lib/frameio/poll.ts) calls this once per stored
 * subscription for every new review task created in a poll run, so
 * `sendPush` must NEVER throw — one bad or stale subscription must never
 * abort processing of the rest of the batch. A 404/410 response means the
 * push service no longer recognizes the subscription (the browser
 * unregistered it); that row is deleted from `pushSubscriptions` instead of
 * being retried forever. Any other failure (including a missing/invalid
 * VAPID configuration, or a rejection in an unexpected shape) is logged and
 * swallowed.
 */

import { eq } from "drizzle-orm";
import webpush from "web-push";
import { db } from "@/lib/db/client";
import { pushSubscriptions } from "@/lib/db/schema";

export interface PushSubscriptionInput {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface PushPayload {
  title: string;
  body: string;
  url: string;
}

// Identifies the sender to push services per the Web Push protocol (a
// `mailto:` address or URL). This project has no existing contact-email
// convention, so this is a placeholder — swap in a real address at deploy
// time. Not security-sensitive, so this doesn't block the task.
const VAPID_SUBJECT = "mailto:admin@workhub.local";

/**
 * Configures VAPID details from env vars before every send. web-push
 * validates these synchronously and throws if either is missing/malformed,
 * so this is called inside sendPush's try/catch rather than once at module
 * load — a missing/invalid VAPID configuration must be logged and
 * swallowed like any other send failure, not crash whichever module
 * imports this file.
 */
function configureVapid(): void {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) {
    throw new Error("VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY are not configured");
  }
  webpush.setVapidDetails(VAPID_SUBJECT, publicKey, privateKey);
}

/** Extracts a numeric `statusCode` from an unknown rejection, if present. */
function getStatusCode(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null || !("statusCode" in error)) {
    return undefined;
  }
  const statusCode = (error as { statusCode?: unknown }).statusCode;
  return typeof statusCode === "number" ? statusCode : undefined;
}

export async function sendPush(
  subscription: PushSubscriptionInput,
  payload: PushPayload,
): Promise<void> {
  try {
    configureVapid();
    await webpush.sendNotification(
      {
        endpoint: subscription.endpoint,
        keys: { p256dh: subscription.p256dh, auth: subscription.auth },
      },
      JSON.stringify(payload),
    );
  } catch (error) {
    const statusCode = getStatusCode(error);
    if (statusCode === 404 || statusCode === 410) {
      // Dead subscription — the push service will never accept it again,
      // so stop storing it rather than retrying forever. Matched by
      // endpoint, the column that uniquely identifies a subscription here.
      // This cleanup gets its own try/catch: a DB failure while deleting
      // must not escape sendPush either (a half-done cleanup just means
      // the dead row is deleted on a later attempt instead).
      try {
        await db
          .delete(pushSubscriptions)
          .where(eq(pushSubscriptions.endpoint, subscription.endpoint));
      } catch (deleteError) {
        console.error("sendPush: failed to delete dead subscription row", deleteError);
      }
      return;
    }
    console.error("sendPush: failed to deliver push notification", error);
  }
}
