import { expect, test } from "vitest";
import { computeClientStats, type ClientRow, type ReviewTaskRow } from "@/lib/clients/stats";

function client(overrides: Partial<ClientRow> & { id: string }): ClientRow {
  return {
    tag: overrides.id,
    displayName: overrides.id,
    recognized: true,
    lastActivityAt: null,
    ...overrides,
  };
}

test("a client with no review tasks gets a zeroed-out row, not omitted", () => {
  const stats = computeClientStats([client({ id: "c1" })], []);
  expect(stats).toEqual([
    {
      id: "c1",
      tag: "c1",
      displayName: "c1",
      recognized: true,
      lastActivityAt: null,
      completedCount: 0,
      activeCount: 0,
      avgTurnaroundHours: null,
    },
  ]);
});

test("counts completed and active review tasks separately", () => {
  const tasks: ReviewTaskRow[] = [
    { clientId: "c1", status: "completed", createdAt: new Date(), completedAt: new Date() },
    { clientId: "c1", status: "completed", createdAt: new Date(), completedAt: new Date() },
    { clientId: "c1", status: "active", createdAt: new Date(), completedAt: null },
  ];
  const [stats] = computeClientStats([client({ id: "c1" })], tasks);
  expect(stats.completedCount).toBe(2);
  expect(stats.activeCount).toBe(1);
});

test("averages turnaround in hours across completed tasks with a completedAt", () => {
  const tasks: ReviewTaskRow[] = [
    {
      clientId: "c1",
      status: "completed",
      createdAt: new Date("2026-01-01T00:00:00Z"),
      completedAt: new Date("2026-01-01T02:00:00Z"), // 2h
    },
    {
      clientId: "c1",
      status: "completed",
      createdAt: new Date("2026-01-02T00:00:00Z"),
      completedAt: new Date("2026-01-02T06:00:00Z"), // 6h
    },
  ];
  const [stats] = computeClientStats([client({ id: "c1" })], tasks);
  expect(stats.avgTurnaroundHours).toBe(4);
});

test("a completed task missing completedAt doesn't count toward the average", () => {
  const tasks: ReviewTaskRow[] = [
    { clientId: "c1", status: "completed", createdAt: new Date(), completedAt: null },
  ];
  const [stats] = computeClientStats([client({ id: "c1" })], tasks);
  expect(stats.completedCount).toBe(1);
  expect(stats.avgTurnaroundHours).toBeNull();
});

test("a task with no clientId is ignored rather than crashing", () => {
  const tasks: ReviewTaskRow[] = [
    { clientId: null, status: "completed", createdAt: new Date(), completedAt: new Date() },
  ];
  const stats = computeClientStats([client({ id: "c1" })], tasks);
  expect(stats[0].completedCount).toBe(0);
});

test("keeps each client's tasks separate", () => {
  const tasks: ReviewTaskRow[] = [
    { clientId: "c1", status: "completed", createdAt: new Date(), completedAt: new Date() },
    { clientId: "c2", status: "active", createdAt: new Date(), completedAt: null },
  ];
  const stats = computeClientStats([client({ id: "c1" }), client({ id: "c2" })], tasks);
  const c1 = stats.find((s) => s.id === "c1")!;
  const c2 = stats.find((s) => s.id === "c2")!;
  expect(c1.completedCount).toBe(1);
  expect(c1.activeCount).toBe(0);
  expect(c2.completedCount).toBe(0);
  expect(c2.activeCount).toBe(1);
});
