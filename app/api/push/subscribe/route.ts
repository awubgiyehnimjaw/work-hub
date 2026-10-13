import { NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { pushSubscriptions } from "@/lib/db/schema";

interface SubscribePayload {
  endpoint: string;
  p256dh: string;
  auth: string;
}

/**
 * Validates the body against a browser `PushSubscription.toJSON()` shape:
 * `{ endpoint, keys: { p256dh, auth } }`. Returns null for anything that
 * doesn't match rather than throwing, so the route can respond 400 instead
 * of 500 on a malformed or missing body.
 */
function parsePayload(body: unknown): SubscribePayload | null {
  if (typeof body !== "object" || body === null) {
    return null;
  }
  const { endpoint, keys } = body as Record<string, unknown>;
  if (typeof endpoint !== "string" || endpoint.length === 0) {
    return null;
  }
  if (typeof keys !== "object" || keys === null) {
    return null;
  }
  const { p256dh, auth } = keys as Record<string, unknown>;
  if (typeof p256dh !== "string" || p256dh.length === 0) {
    return null;
  }
  if (typeof auth !== "string" || auth.length === 0) {
    return null;
  }
  return { endpoint, p256dh, auth };
}

export async function POST(request: Request) {
  const body: unknown = await request.json().catch(() => null);
  const payload = parsePayload(body);
  if (!payload) {
    return NextResponse.json(
      { error: "Body must be { endpoint, keys: { p256dh, auth } }" },
      { status: 400 },
    );
  }

  // Real upsert, not onConflictDoNothing: a browser can re-subscribe with
  // the same endpoint but rotated keys, and Task 8's sendPush needs the
  // current keys, not whichever ones happened to be stored first.
  await db
    .insert(pushSubscriptions)
    .values({
      endpoint: payload.endpoint,
      p256dh: payload.p256dh,
      auth: payload.auth,
    })
    .onConflictDoUpdate({
      target: pushSubscriptions.endpoint,
      set: { p256dh: payload.p256dh, auth: payload.auth },
    });

  return NextResponse.json({ status: "ok" }, { status: 200 });
}
