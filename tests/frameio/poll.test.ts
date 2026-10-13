import { eq } from "drizzle-orm";
import { beforeEach, expect, test, vi } from "vitest";
import { db } from "@/lib/db/client";
import { seedClients } from "@/lib/db/seed";
import { clients, pushSubscriptions, syncState, tasks } from "@/lib/db/schema";
import { listNewFiles } from "@/lib/frameio/client";
import { runFrameioPoll } from "@/lib/frameio/poll";
import { sendPush } from "@/lib/push/send";

// Vitest hoists vi.mock calls above these imports, so listNewFiles/sendPush
// are already the mocked versions by the time runFrameioPoll (which
// imports them itself) runs.
vi.mock("@/lib/frameio/client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/frameio/client")>(
    "@/lib/frameio/client",
  );
  return {
    ...actual,
    listNewFiles: vi.fn(),
  };
});

vi.mock("@/lib/push/send", () => ({
  sendPush: vi.fn().mockResolvedValue(undefined),
}));

const mockListNewFiles = listNewFiles as unknown as ReturnType<typeof vi.fn>;
const mockSendPush = sendPush as unknown as ReturnType<typeof vi.fn>;

type FileOverrides = Partial<{
  id: string;
  name: string;
  createdAt: string;
  viewUrl: string | null;
}>;

function file(overrides: FileOverrides = {}) {
  return {
    id: "file-default",
    name: "Cut (Lovelots).mp4",
    createdAt: new Date().toISOString(),
    viewUrl: "https://frame.io/view/file-default",
    ...overrides,
  };
}

beforeEach(async () => {
  mockListNewFiles.mockReset();
  mockSendPush.mockReset().mockResolvedValue(undefined);

  // Fresh slate per test — tasks before clients (FK), then the rest.
  await db.delete(tasks);
  await db.delete(clients);
  await db.delete(syncState);
  await db.delete(pushSubscriptions);

  // Mirrors production: clients are already seeded (Task 2's seedClients())
  // by the time polling ever runs.
  await seedClients();
});

test("creates a task for a recognized client tag", async () => {
  mockListNewFiles.mockResolvedValue([
    file({ id: "f-recognized", name: "Cut (Lovelots).mp4" }),
  ]);

  const result = await runFrameioPoll();

  expect(result).toEqual({ created: 1, unrecognized: 0 });

  const taskRows = await db
    .select()
    .from(tasks)
    .where(eq(tasks.frameioFileId, "f-recognized"));
  expect(taskRows).toHaveLength(1);
  expect(taskRows[0].title).toBe("Review — Lovelots");
  expect(taskRows[0].type).toBe("review");
  expect(taskRows[0].status).toBe("active");

  const [client] = await db.select().from(clients).where(eq(clients.tag, "Lovelots"));
  expect(client.recognized).toBe(true);
  expect(client.lastActivityAt).not.toBeNull();
});

test("creates a flagged task for an unrecognized tag, never drops it", async () => {
  mockListNewFiles.mockResolvedValue([
    file({ id: "f-unrecognized", name: "Cut (RandomCo).mp4" }),
  ]);

  const result = await runFrameioPoll();

  expect(result).toEqual({ created: 1, unrecognized: 1 });

  const taskRows = await db
    .select()
    .from(tasks)
    .where(eq(tasks.frameioFileId, "f-unrecognized"));
  expect(taskRows).toHaveLength(1);

  const [client] = await db.select().from(clients).where(eq(clients.tag, "RandomCo"));
  expect(client).toBeDefined();
  expect(client.recognized).toBe(false);
  expect(client.lastActivityAt).not.toBeNull();
});

test("creates a flagged task when there is no bracket tag at all", async () => {
  mockListNewFiles.mockResolvedValue([file({ id: "f-no-tag", name: "final.mp4" })]);

  const result = await runFrameioPoll();

  expect(result).toEqual({ created: 1, unrecognized: 1 });

  const taskRows = await db
    .select()
    .from(tasks)
    .where(eq(tasks.frameioFileId, "f-no-tag"));
  expect(taskRows).toHaveLength(1);
});

test("does not create a duplicate task for a file already recorded across two poll runs", async () => {
  mockListNewFiles.mockResolvedValue([
    file({ id: "f-duplicate", name: "Cut (Lovelots).mp4" }),
  ]);

  const first = await runFrameioPoll();
  expect(first.created).toBe(1);

  // Simulate the same file reappearing in the next poll window
  // (pagination overlap / clock skew around the cursor).
  const second = await runFrameioPoll();
  expect(second.created).toBe(0);

  const taskRows = await db
    .select()
    .from(tasks)
    .where(eq(tasks.frameioFileId, "f-duplicate"));
  expect(taskRows).toHaveLength(1);
});

test("does not create two tasks when the same file appears twice within a single poll batch", async () => {
  // A naive implementation that only checked-then-inserted without an
  // onConflictDoNothing/catch would throw on the DB's unique constraint
  // for the second occurrence and abort the whole run.
  mockListNewFiles.mockResolvedValue([
    file({ id: "f-batch-duplicate", name: "Cut (Lovelots).mp4" }),
    file({ id: "f-batch-duplicate", name: "Cut (Lovelots).mp4" }),
  ]);

  const result = await runFrameioPoll();

  expect(result.created).toBe(1);
  const taskRows = await db
    .select()
    .from(tasks)
    .where(eq(tasks.frameioFileId, "f-batch-duplicate"));
  expect(taskRows).toHaveLength(1);
});

test("does not throw and only records one task when two poll runs race on the same new file", async () => {
  // Two overlapping cron invocations (or a manual trigger during a
  // scheduled run) could both pass the app-level "already recorded?"
  // pre-check before either has inserted, since that check and the insert
  // are two separate awaited DB calls. This exercises the DB-level
  // onConflictDoNothing backstop on tasks.frameioFileId directly, proving
  // a thrown unique-constraint violation doesn't bubble up and fail the
  // whole run.
  mockListNewFiles.mockResolvedValue([
    file({ id: "f-race", name: "Cut (Lovelots).mp4" }),
  ]);

  const [first, second] = await Promise.all([runFrameioPoll(), runFrameioPoll()]);

  expect(first.created + second.created).toBe(1);
  const taskRows = await db
    .select()
    .from(tasks)
    .where(eq(tasks.frameioFileId, "f-race"));
  expect(taskRows).toHaveLength(1);
});

test("calls sendPush for every stored push subscription with the task's review URL", async () => {
  await db.insert(pushSubscriptions).values([
    { endpoint: "https://push.example/a", p256dh: "key-a", auth: "auth-a" },
    { endpoint: "https://push.example/b", p256dh: "key-b", auth: "auth-b" },
  ]);
  mockListNewFiles.mockResolvedValue([
    file({
      id: "f-push",
      name: "Cut (Lovelots).mp4",
      viewUrl: "https://frame.io/view/f-push",
    }),
  ]);

  await runFrameioPoll();

  expect(mockSendPush).toHaveBeenCalledTimes(2);
  expect(mockSendPush).toHaveBeenCalledWith(
    { endpoint: "https://push.example/a", p256dh: "key-a", auth: "auth-a" },
    expect.objectContaining({ url: "https://frame.io/view/f-push" }),
  );
  expect(mockSendPush).toHaveBeenCalledWith(
    { endpoint: "https://push.example/b", p256dh: "key-b", auth: "auth-b" },
    expect.objectContaining({ url: "https://frame.io/view/f-push" }),
  );
});

test("falls back to the Frame.io player URL when the API's view_url is null", async () => {
  mockListNewFiles.mockResolvedValue([
    file({ id: "f-no-view-url", name: "Cut (Lovelots).mp4", viewUrl: null }),
  ]);

  await runFrameioPoll();

  const [task] = await db
    .select()
    .from(tasks)
    .where(eq(tasks.frameioFileId, "f-no-view-url"));
  expect(task.frameioUrl).toBe("https://app.frame.io/player/f-no-view-url");
});

test("passes 24 hours ago as the cursor when syncState has never been polled", async () => {
  mockListNewFiles.mockResolvedValue([]);

  const before = Date.now();
  await runFrameioPoll();

  expect(mockListNewFiles).toHaveBeenCalledTimes(1);
  const [sinceISO] = mockListNewFiles.mock.calls[0] as [string];
  const sinceMs = new Date(sinceISO).getTime();
  expect(sinceMs).toBeGreaterThanOrEqual(before - 24 * 60 * 60 * 1000 - 5000);
  expect(sinceMs).toBeLessThanOrEqual(before - 24 * 60 * 60 * 1000 + 5000);
});

test("updates syncState.frameioLastPolledAt on success, and uses it as the next cursor", async () => {
  mockListNewFiles.mockResolvedValue([]);

  const before = Date.now();
  await runFrameioPoll();
  const after = Date.now();

  const [state] = await db.select().from(syncState);
  expect(state.frameioLastPolledAt).not.toBeNull();
  const polledMs = state.frameioLastPolledAt!.getTime();
  expect(polledMs).toBeGreaterThanOrEqual(before);
  expect(polledMs).toBeLessThanOrEqual(after);

  // Second run should pass that same timestamp back in as the new cursor.
  mockListNewFiles.mockResolvedValue([]);
  await runFrameioPoll();
  const [sinceISO] = mockListNewFiles.mock.calls[1] as [string];
  expect(new Date(sinceISO).getTime()).toBe(polledMs);
});
