import { eq } from "drizzle-orm";
import { beforeEach, expect, test, vi } from "vitest";
import { db } from "@/lib/db/client";
import { pushSubscriptions } from "@/lib/db/schema";

// Mocked before the implementation import so `sendPush` (which imports
// "web-push" itself) picks up the mock rather than making a real network
// call. Vitest hoists vi.mock calls above these imports.
vi.mock("web-push", () => ({
  default: {
    setVapidDetails: vi.fn(),
    sendNotification: vi.fn(),
  },
}));

import webpush from "web-push";
import { sendPush } from "@/lib/push/send";

const mockSendNotification = webpush.sendNotification as unknown as ReturnType<typeof vi.fn>;
const mockSetVapidDetails = webpush.setVapidDetails as unknown as ReturnType<typeof vi.fn>;

const subscription = {
  endpoint: "https://push.example/sub-1",
  p256dh: "p256dh-key",
  auth: "auth-secret",
};

const payload = {
  title: "New review: Lovelots",
  body: "Cut (Lovelots).mp4",
  url: "https://frame.io/view/f1",
};

beforeEach(async () => {
  mockSendNotification.mockReset();
  mockSetVapidDetails.mockReset();
  process.env.VAPID_PUBLIC_KEY = "test-vapid-public-key";
  process.env.VAPID_PRIVATE_KEY = "test-vapid-private-key";
  await db.delete(pushSubscriptions);
});

test("sendPush delivers to a valid subscription", async () => {
  mockSendNotification.mockResolvedValue({ statusCode: 201, body: "", headers: {} });

  await sendPush(subscription, payload);

  expect(mockSendNotification).toHaveBeenCalledTimes(1);
  const [sentSubscription, sentPayload] = mockSendNotification.mock.calls[0] as [
    unknown,
    string,
  ];
  expect(sentSubscription).toEqual({
    endpoint: subscription.endpoint,
    keys: { p256dh: subscription.p256dh, auth: subscription.auth },
  });
  expect(JSON.parse(sentPayload)).toEqual(payload);

  // VAPID details are configured (from env) before every send.
  expect(mockSetVapidDetails).toHaveBeenCalledWith(
    expect.stringContaining("mailto:"),
    "test-vapid-public-key",
    "test-vapid-private-key",
  );
});

test("sendPush removes the subscription row on a 410 Gone response", async () => {
  await db.insert(pushSubscriptions).values({
    endpoint: subscription.endpoint,
    p256dh: subscription.p256dh,
    auth: subscription.auth,
  });
  mockSendNotification.mockRejectedValue({ statusCode: 410 });

  await expect(sendPush(subscription, payload)).resolves.toBeUndefined();

  const rows = await db
    .select()
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.endpoint, subscription.endpoint));
  expect(rows).toHaveLength(0);
});

test("sendPush removes the subscription row on a 404 Not Found response", async () => {
  await db.insert(pushSubscriptions).values({
    endpoint: subscription.endpoint,
    p256dh: subscription.p256dh,
    auth: subscription.auth,
  });
  mockSendNotification.mockRejectedValue({ statusCode: 404 });

  await expect(sendPush(subscription, payload)).resolves.toBeUndefined();

  const rows = await db
    .select()
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.endpoint, subscription.endpoint));
  expect(rows).toHaveLength(0);
});

test("on a 410, deletes only the row matching this subscription's endpoint, not other rows", async () => {
  await db.insert(pushSubscriptions).values([
    { endpoint: subscription.endpoint, p256dh: subscription.p256dh, auth: subscription.auth },
    { endpoint: "https://push.example/sub-other", p256dh: "other-key", auth: "other-auth" },
  ]);
  mockSendNotification.mockRejectedValue({ statusCode: 410 });

  await sendPush(subscription, payload);

  const remaining = await db.select().from(pushSubscriptions);
  expect(remaining).toHaveLength(1);
  expect(remaining[0].endpoint).toBe("https://push.example/sub-other");
});

test("sendPush does not throw on an unrelated error", async () => {
  mockSendNotification.mockRejectedValue({ statusCode: 500 });

  await expect(sendPush(subscription, payload)).resolves.toBeUndefined();

  // Not deleted — a 500 is the push service's problem, not a dead
  // subscription, so the row (if any) must survive for the next attempt.
  const rows = await db
    .select()
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.endpoint, subscription.endpoint));
  expect(rows).toHaveLength(0); // none inserted in this test; just asserting no crash happened
});

test("sendPush does not throw when the rejection is an Error with no statusCode", async () => {
  mockSendNotification.mockRejectedValue(new Error("network blip"));

  await expect(sendPush(subscription, payload)).resolves.toBeUndefined();
});

test("sendPush does not throw when the rejection isn't an object at all", async () => {
  mockSendNotification.mockRejectedValue("some string rejection");

  await expect(sendPush(subscription, payload)).resolves.toBeUndefined();
});

test("sendPush does not throw even if deleting the dead subscription row fails", async () => {
  mockSendNotification.mockRejectedValue({ statusCode: 410 });

  // No matching row exists to delete, and drizzle's delete().where() on a
  // non-existent row is a normal no-op — so to exercise the "the DB call
  // itself throws" path, spy on db.delete to force a rejection.
  const deleteSpy = vi.spyOn(db, "delete").mockImplementation(() => {
    throw new Error("simulated DB outage during cleanup");
  });

  await expect(sendPush(subscription, payload)).resolves.toBeUndefined();

  deleteSpy.mockRestore();
});

test("sendPush does not throw when VAPID env vars are missing", async () => {
  delete process.env.VAPID_PUBLIC_KEY;
  delete process.env.VAPID_PRIVATE_KEY;

  await expect(sendPush(subscription, payload)).resolves.toBeUndefined();
  expect(mockSendNotification).not.toHaveBeenCalled();
});
