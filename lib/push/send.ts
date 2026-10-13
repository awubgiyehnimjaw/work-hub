/**
 * Web Push sender. Stubbed as a no-op for Task 6 (Frame.io polling needs
 * something to import and call for every stored subscription) — Task 8
 * replaces this body with the real VAPID-signed web-push call. Task 6's
 * own tests mock this import rather than relying on this stub's behavior,
 * so swapping the implementation in later needs no change on the caller
 * side (`lib/frameio/poll.ts`).
 */

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

export async function sendPush(
  subscription: PushSubscriptionInput,
  payload: PushPayload,
): Promise<void> {
  void subscription;
  void payload;
  // No-op until Task 8 wires in the real web-push call.
}
