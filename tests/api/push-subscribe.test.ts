import { eq } from "drizzle-orm";
import { beforeEach, expect, test } from "vitest";
import { POST } from "@/app/api/push/subscribe/route";
import { db } from "@/lib/db/client";
import { pushSubscriptions } from "@/lib/db/schema";

beforeEach(async () => {
  await db.delete(pushSubscriptions);
});

function subscribeRequest(body: unknown) {
  return new Request("http://localhost/api/push/subscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function subscriptionPayload(overrides: {
  endpoint?: string;
  p256dh?: string;
  auth?: string;
} = {}) {
  return {
    endpoint: overrides.endpoint ?? "https://push.example/sub-1",
    keys: {
      p256dh: overrides.p256dh ?? "p256dh-key",
      auth: overrides.auth ?? "auth-secret",
    },
  };
}

test("POST /api/push/subscribe stores a new subscription and returns 200", async () => {
  const res = await POST(subscribeRequest(subscriptionPayload()));

  expect(res.status).toBe(200);

  const rows = await db
    .select()
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.endpoint, "https://push.example/sub-1"));
  expect(rows).toHaveLength(1);
  expect(rows[0].p256dh).toBe("p256dh-key");
  expect(rows[0].auth).toBe("auth-secret");
});

test("POSTing the same subscription twice results in exactly one row", async () => {
  const payload = subscriptionPayload();

  const first = await POST(subscribeRequest(payload));
  expect(first.status).toBe(200);
  const second = await POST(subscribeRequest(payload));
  expect(second.status).toBe(200);

  const rows = await db
    .select()
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.endpoint, payload.endpoint));
  expect(rows).toHaveLength(1);
});

test("POSTing the same endpoint again with changed keys updates the existing row (real upsert, not onConflictDoNothing)", async () => {
  await POST(subscribeRequest(subscriptionPayload({ endpoint: "https://push.example/sub-2" })));

  const res = await POST(
    subscribeRequest(
      subscriptionPayload({
        endpoint: "https://push.example/sub-2",
        p256dh: "new-p256dh-key",
        auth: "new-auth-secret",
      }),
    ),
  );
  expect(res.status).toBe(200);

  const rows = await db
    .select()
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.endpoint, "https://push.example/sub-2"));
  expect(rows).toHaveLength(1);
  expect(rows[0].p256dh).toBe("new-p256dh-key");
  expect(rows[0].auth).toBe("new-auth-secret");
});

test("POST /api/push/subscribe returns 400 and stores nothing when endpoint is missing", async () => {
  const res = await POST(
    subscribeRequest({ keys: { p256dh: "p256dh-key", auth: "auth-secret" } }),
  );

  expect(res.status).toBe(400);
  const rows = await db.select().from(pushSubscriptions);
  expect(rows).toHaveLength(0);
});

test("POST /api/push/subscribe returns 400 and stores nothing when keys are missing", async () => {
  const res = await POST(subscribeRequest({ endpoint: "https://push.example/sub-3" }));

  expect(res.status).toBe(400);
  const rows = await db.select().from(pushSubscriptions);
  expect(rows).toHaveLength(0);
});

test("POST /api/push/subscribe returns 400 for a non-JSON body instead of throwing", async () => {
  const res = await POST(
    new Request("http://localhost/api/push/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not json",
    }),
  );

  expect(res.status).toBe(400);
});
