import { eq } from "drizzle-orm";
import { beforeEach, expect, test } from "vitest";
import { PATCH } from "@/app/api/tasks/[id]/route";
import { GET, POST } from "@/app/api/tasks/route";
import { db } from "@/lib/db/client";
import { clients, tasks } from "@/lib/db/schema";

const DAY_MS = 24 * 60 * 60 * 1000;
const NONEXISTENT_ID = "00000000-0000-0000-0000-000000000000";

beforeEach(async () => {
  // Tasks before clients — `tasks.clientId` is a (non-cascading) FK, so
  // clearing clients first while tasks referencing them still exist would
  // violate it.
  await db.delete(tasks);
  await db.delete(clients);
});

function getRequest(query = "") {
  return new Request(`http://localhost/api/tasks${query}`);
}

function postRequest(body: unknown) {
  return new Request("http://localhost/api/tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function patchRequest(body: unknown) {
  return new Request("http://localhost/api/tasks/placeholder", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function patchContext(id: string) {
  return { params: Promise.resolve({ id }) };
}

test("GET /api/tasks excludes completed tasks and tasks still snoozed in the future", async () => {
  const now = Date.now();
  await db.insert(tasks).values([
    {
      type: "todo",
      title: "active, unsnoozed",
      status: "active",
      createdAt: new Date(now - 3 * DAY_MS),
    },
    {
      type: "todo",
      title: "completed",
      status: "completed",
      createdAt: new Date(now - 3 * DAY_MS),
      completedAt: new Date(now),
    },
    {
      type: "todo",
      title: "snoozed into the future",
      status: "active",
      createdAt: new Date(now - 3 * DAY_MS),
      snoozedUntil: new Date(now + DAY_MS),
    },
  ]);

  const res = await GET(getRequest());
  expect(res.status).toBe(200);
  const body = await res.json();

  expect(body).toHaveLength(1);
  expect(body[0].title).toBe("active, unsnoozed");
});

test("GET /api/tasks includes a task whose snoozedUntil has already passed", async () => {
  const now = Date.now();
  await db.insert(tasks).values({
    type: "todo",
    title: "snooze elapsed",
    status: "active",
    createdAt: new Date(now - 3 * DAY_MS),
    snoozedUntil: new Date(now - 1000),
  });

  const res = await GET(getRequest());
  const body = await res.json();

  expect(res.status).toBe(200);
  expect(body).toHaveLength(1);
  expect(body[0].title).toBe("snooze elapsed");
});

test("GET /api/tasks sorts oldest-first and annotates isStale per task", async () => {
  const now = Date.now();
  await db.insert(tasks).values([
    {
      type: "todo",
      title: "newer, not stale",
      status: "active",
      createdAt: new Date(now - 1 * DAY_MS),
    },
    {
      type: "todo",
      title: "older, stale",
      status: "active",
      createdAt: new Date(now - 5 * DAY_MS),
    },
  ]);

  const res = await GET(getRequest());
  const body = await res.json();

  expect(body.map((t: { title: string }) => t.title)).toEqual([
    "older, stale",
    "newer, not stale",
  ]);
  expect(body[0].isStale).toBe(true);
  expect(body[1].isStale).toBe(false);
});

test("POST /api/tasks creates an active todo task and returns 201", async () => {
  const res = await POST(postRequest({ title: "Pick up hard drive" }));
  expect(res.status).toBe(201);
  const body = await res.json();

  expect(body.type).toBe("todo");
  expect(body.title).toBe("Pick up hard drive");
  expect(body.status).toBe("active");

  const rows = await db.select().from(tasks);
  expect(rows).toHaveLength(1);
  expect(rows[0].type).toBe("todo");
  expect(rows[0].status).toBe("active");
});

test("POST /api/tasks returns 400 and creates nothing when title is missing", async () => {
  const res = await POST(postRequest({}));
  expect(res.status).toBe(400);

  const rows = await db.select().from(tasks);
  expect(rows).toHaveLength(0);
});

test("POST /api/tasks accepts an optional dueAt and stores it", async () => {
  const dueAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
  const res = await POST(postRequest({ title: "Invoice client", dueAt }));
  expect(res.status).toBe(201);
  const body = await res.json();
  expect(new Date(body.dueAt).toISOString()).toBe(dueAt);

  const [row] = await db.select().from(tasks);
  expect(row.dueAt?.toISOString()).toBe(dueAt);
});

test("POST /api/tasks without a dueAt stores null, not a missing-field error", async () => {
  const res = await POST(postRequest({ title: "No deadline" }));
  expect(res.status).toBe(201);
  const body = await res.json();
  expect(body.dueAt).toBeNull();
});

test("POST /api/tasks returns 400 for a dueAt that isn't a valid date", async () => {
  const res = await POST(postRequest({ title: "Bad date", dueAt: "not-a-date" }));
  expect(res.status).toBe(400);

  const rows = await db.select().from(tasks);
  expect(rows).toHaveLength(0);
});

test("PATCH /api/tasks/:id with action 'complete' sets status and completedAt", async () => {
  const [task] = await db
    .insert(tasks)
    .values({ type: "todo", title: "finish edit", status: "active" })
    .returning();

  const res = await PATCH(patchRequest({ action: "complete" }), patchContext(task.id));
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.status).toBe("completed");
  expect(body.completedAt).not.toBeNull();

  const [updated] = await db.select().from(tasks).where(eq(tasks.id, task.id));
  expect(updated.status).toBe("completed");
  expect(updated.completedAt).not.toBeNull();
});

test("PATCH /api/tasks/:id with action 'reopen' undoes an accidental complete", async () => {
  const [task] = await db
    .insert(tasks)
    .values({
      type: "review",
      title: "Review — Lovelots",
      status: "completed",
      completedAt: new Date(),
    })
    .returning();

  const res = await PATCH(patchRequest({ action: "reopen" }), patchContext(task.id));
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.status).toBe("active");
  expect(body.completedAt).toBeNull();

  const [updated] = await db.select().from(tasks).where(eq(tasks.id, task.id));
  expect(updated.status).toBe("active");
  expect(updated.completedAt).toBeNull();

  // The reopened task must be visible again via the normal active-task list.
  const listRes = await GET(new Request("http://localhost/api/tasks"));
  const listBody = await listRes.json();
  expect(listBody.some((t: { id: string }) => t.id === task.id)).toBe(true);
});

test("PATCH /api/tasks/:id with action 'reopen' returns 404 for a nonexistent id", async () => {
  const res = await PATCH(patchRequest({ action: "reopen" }), patchContext(NONEXISTENT_ID));
  expect(res.status).toBe(404);
});

test("PATCH /api/tasks/:id with action 'snooze' sets snoozedUntil to the given ISO timestamp", async () => {
  const [task] = await db
    .insert(tasks)
    .values({ type: "todo", title: "later", status: "active" })
    .returning();

  const until = new Date(Date.now() + DAY_MS).toISOString();
  const res = await PATCH(patchRequest({ action: "snooze", until }), patchContext(task.id));
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(new Date(body.snoozedUntil).toISOString()).toBe(until);

  const [updated] = await db.select().from(tasks).where(eq(tasks.id, task.id));
  expect(updated.snoozedUntil?.toISOString()).toBe(until);
});

test("snoozing a task with a PAST timestamp makes it reappear in the very next GET /api/tasks call", async () => {
  const [task] = await db
    .insert(tasks)
    .values({
      type: "todo",
      title: "snoozed then unsnoozed",
      status: "active",
      createdAt: new Date(Date.now() - 3 * DAY_MS),
    })
    .returning();

  // Snooze into the future first — confirm it's excluded from the list.
  const future = new Date(Date.now() + DAY_MS).toISOString();
  const futureRes = await PATCH(
    patchRequest({ action: "snooze", until: future }),
    patchContext(task.id),
  );
  expect(futureRes.status).toBe(200);

  const excludedRes = await GET(getRequest());
  const excludedBody = await excludedRes.json();
  expect(excludedBody).toHaveLength(0);

  // Now re-snooze with a PAST timestamp — the very next list call must
  // include it again.
  const past = new Date(Date.now() - 1000).toISOString();
  const pastRes = await PATCH(
    patchRequest({ action: "snooze", until: past }),
    patchContext(task.id),
  );
  expect(pastRes.status).toBe(200);

  const res = await GET(getRequest());
  const body = await res.json();
  expect(body).toHaveLength(1);
  expect(body[0].id).toBe(task.id);
});

// I6 regression coverage: the spec requires clients.lastActivityAt to
// update "whenever a review task is created OR completed" — createReviewTask
// (lib/frameio/poll.ts) already covers "created"; these cover "completed".

test("PATCH /api/tasks/:id completing a review task updates that client's lastActivityAt", async () => {
  const [client] = await db
    .insert(clients)
    .values({
      tag: "Lovelots",
      displayName: "Lovelots",
      recognized: true,
      lastActivityAt: new Date(Date.now() - 30 * DAY_MS),
    })
    .returning();
  const [task] = await db
    .insert(tasks)
    .values({
      type: "review",
      title: "Review — Lovelots",
      status: "active",
      clientId: client.id,
    })
    .returning();

  const before = Date.now();
  const res = await PATCH(patchRequest({ action: "complete" }), patchContext(task.id));
  const after = Date.now();
  expect(res.status).toBe(200);

  const [updatedClient] = await db.select().from(clients).where(eq(clients.id, client.id));
  expect(updatedClient.lastActivityAt).not.toBeNull();
  const activityMs = updatedClient.lastActivityAt!.getTime();
  expect(activityMs).toBeGreaterThanOrEqual(before);
  expect(activityMs).toBeLessThanOrEqual(after);
});

test("PATCH /api/tasks/:id completing a to-do does NOT touch any client's lastActivityAt", async () => {
  const [client] = await db
    .insert(clients)
    .values({ tag: "Lovelots", displayName: "Lovelots", recognized: true, lastActivityAt: null })
    .returning();
  const [task] = await db
    .insert(tasks)
    .values({ type: "todo", title: "Pick up hard drive", status: "active" })
    .returning();

  const res = await PATCH(patchRequest({ action: "complete" }), patchContext(task.id));
  expect(res.status).toBe(200);

  const [unchangedClient] = await db.select().from(clients).where(eq(clients.id, client.id));
  expect(unchangedClient.lastActivityAt).toBeNull();
});

test("PATCH /api/tasks/:id completing a review task with no client does not throw", async () => {
  const [task] = await db
    .insert(tasks)
    .values({ type: "review", title: "Review — Unrecognized", status: "active", clientId: null })
    .returning();

  const res = await PATCH(patchRequest({ action: "complete" }), patchContext(task.id));
  expect(res.status).toBe(200);
});

test("PATCH /api/tasks/:id snoozing a review task does NOT update the client's lastActivityAt", async () => {
  const [client] = await db
    .insert(clients)
    .values({ tag: "Lovelots", displayName: "Lovelots", recognized: true, lastActivityAt: null })
    .returning();
  const [task] = await db
    .insert(tasks)
    .values({ type: "review", title: "Review — Lovelots", status: "active", clientId: client.id })
    .returning();

  const until = new Date(Date.now() + DAY_MS).toISOString();
  const res = await PATCH(patchRequest({ action: "snooze", until }), patchContext(task.id));
  expect(res.status).toBe(200);

  const [unchangedClient] = await db.select().from(clients).where(eq(clients.id, client.id));
  expect(unchangedClient.lastActivityAt).toBeNull();
});

test("PATCH /api/tasks/:id returns 404 for a nonexistent id and changes nothing", async () => {
  const res = await PATCH(
    patchRequest({ action: "complete" }),
    patchContext(NONEXISTENT_ID),
  );
  expect(res.status).toBe(404);

  const rows = await db.select().from(tasks);
  expect(rows).toHaveLength(0);
});

test("PATCH /api/tasks/:id returns 400 for an unrecognized action", async () => {
  const [task] = await db
    .insert(tasks)
    .values({ type: "todo", title: "x", status: "active" })
    .returning();

  const res = await PATCH(patchRequest({ action: "bogus" }), patchContext(task.id));
  expect(res.status).toBe(400);

  const [unchanged] = await db.select().from(tasks).where(eq(tasks.id, task.id));
  expect(unchanged.status).toBe("active");
});

test("PATCH /api/tasks/:id returns 400 for a snooze action with a missing until", async () => {
  const [task] = await db
    .insert(tasks)
    .values({ type: "todo", title: "x", status: "active" })
    .returning();

  const res = await PATCH(patchRequest({ action: "snooze" }), patchContext(task.id));
  expect(res.status).toBe(400);
});

test("GET /api/tasks?status=completed returns only completed tasks, ignoring any snoozedUntil", async () => {
  const now = Date.now();
  await db.insert(tasks).values([
    {
      type: "todo",
      title: "still active",
      status: "active",
      createdAt: new Date(now - 3 * DAY_MS),
    },
    {
      type: "review",
      title: "done, never snoozed",
      status: "completed",
      createdAt: new Date(now - 3 * DAY_MS),
      completedAt: new Date(now),
    },
    {
      type: "review",
      title: "done, with a leftover future snoozedUntil",
      status: "completed",
      createdAt: new Date(now - 3 * DAY_MS),
      completedAt: new Date(now),
      snoozedUntil: new Date(now + DAY_MS),
    },
  ]);

  const res = await GET(getRequest("?status=completed"));
  expect(res.status).toBe(200);
  const body = await res.json();

  expect(body.map((t: { title: string }) => t.title).sort()).toEqual([
    "done, never snoozed",
    "done, with a leftover future snoozedUntil",
  ]);
});

test("GET /api/tasks with no status param (and ?status=active) behaves exactly like Task 11's default", async () => {
  const now = Date.now();
  await db.insert(tasks).values([
    {
      type: "todo",
      title: "active, unsnoozed",
      status: "active",
      createdAt: new Date(now - 3 * DAY_MS),
    },
    {
      type: "todo",
      title: "completed",
      status: "completed",
      createdAt: new Date(now - 3 * DAY_MS),
      completedAt: new Date(now),
    },
    {
      type: "todo",
      title: "snoozed into the future",
      status: "active",
      createdAt: new Date(now - 3 * DAY_MS),
      snoozedUntil: new Date(now + DAY_MS),
    },
  ]);

  const defaultRes = await GET(getRequest());
  const explicitActiveRes = await GET(getRequest("?status=active"));

  const defaultBody = await defaultRes.json();
  const explicitActiveBody = await explicitActiveRes.json();

  expect(defaultBody).toHaveLength(1);
  expect(defaultBody[0].title).toBe("active, unsnoozed");
  expect(explicitActiveBody).toEqual(defaultBody);
});

test("GET /api/tasks?clientId=<uuid> restricts results to that client's tasks", async () => {
  const [clientA] = await db
    .insert(clients)
    .values({ tag: "ClientA", displayName: "Client A", recognized: true })
    .returning();
  const [clientB] = await db
    .insert(clients)
    .values({ tag: "ClientB", displayName: "Client B", recognized: true })
    .returning();

  await db.insert(tasks).values([
    { type: "review", title: "A's task", status: "active", clientId: clientA.id },
    { type: "review", title: "B's task", status: "active", clientId: clientB.id },
  ]);

  const res = await GET(getRequest(`?clientId=${clientA.id}`));
  expect(res.status).toBe(200);
  const body = await res.json();

  expect(body).toHaveLength(1);
  expect(body[0].title).toBe("A's task");
});

test("GET /api/tasks annotates each task with clientName from the clients join, null when there is no client", async () => {
  const [client] = await db
    .insert(clients)
    .values({ tag: "Lovelots", displayName: "Lovelots", recognized: true })
    .returning();

  await db.insert(tasks).values([
    { type: "review", title: "Review — Lovelots", status: "active", clientId: client.id },
    { type: "todo", title: "no client", status: "active" },
  ]);

  const res = await GET(getRequest());
  const body = await res.json();

  const review = body.find((t: { title: string }) => t.title === "Review — Lovelots");
  const todo = body.find((t: { title: string }) => t.title === "no client");

  expect(review.clientName).toBe("Lovelots");
  expect(todo.clientName).toBeNull();
});

// I8 regression coverage: the spec requires an unrecognized filename tag
// to "still create a review task, just flagged as unrecognized" so nothing
// falls through silently — but GET /api/tasks previously didn't return that
// flag at all, so the UI couldn't show it even though lib/frameio/poll.ts
// wrote it to clients.recognized.

test("GET /api/tasks annotates a task with clientRecognized: false for an unrecognized client tag", async () => {
  const [unrecognizedClient] = await db
    .insert(clients)
    .values({ tag: "RandomCo", displayName: "RandomCo", recognized: false })
    .returning();

  await db.insert(tasks).values({
    type: "review",
    title: "Review — RandomCo",
    status: "active",
    clientId: unrecognizedClient.id,
  });

  const res = await GET(getRequest());
  const body = await res.json();

  expect(body).toHaveLength(1);
  expect(body[0].clientRecognized).toBe(false);
});

test("GET /api/tasks annotates a task with clientRecognized: true for a recognized client tag", async () => {
  const [recognizedClient] = await db
    .insert(clients)
    .values({ tag: "Lovelots", displayName: "Lovelots", recognized: true })
    .returning();

  await db.insert(tasks).values({
    type: "review",
    title: "Review — Lovelots",
    status: "active",
    clientId: recognizedClient.id,
  });

  const res = await GET(getRequest());
  const body = await res.json();

  expect(body).toHaveLength(1);
  expect(body[0].clientRecognized).toBe(true);
});

test("GET /api/tasks annotates a task with clientRecognized: null when there is no client (e.g. a to-do)", async () => {
  await db.insert(tasks).values({ type: "todo", title: "no client", status: "active" });

  const res = await GET(getRequest());
  const body = await res.json();

  expect(body).toHaveLength(1);
  expect(body[0].clientRecognized).toBeNull();
});

test("GET /api/tasks returns 400 for an unrecognized status value", async () => {
  const res = await GET(getRequest("?status=bogus"));
  expect(res.status).toBe(400);
});

test("GET /api/tasks returns 400 for a malformed clientId", async () => {
  const res = await GET(getRequest("?clientId=not-a-uuid"));
  expect(res.status).toBe(400);
});
