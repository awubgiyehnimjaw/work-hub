export interface ClientRow {
  id: string;
  tag: string;
  displayName: string;
  recognized: boolean;
  lastActivityAt: Date | null;
}

export interface ReviewTaskRow {
  clientId: string | null;
  status: "active" | "completed";
  createdAt: Date;
  completedAt: Date | null;
}

export interface ClientStats {
  id: string;
  tag: string;
  displayName: string;
  recognized: boolean;
  lastActivityAt: Date | null;
  completedCount: number;
  activeCount: number;
  // Null when there's no completed review with a `completedAt` to measure
  // yet — not 0, which would misleadingly read as "same-day turnaround".
  avgTurnaroundHours: number | null;
}

/**
 * Pure aggregation so it's unit-testable without a database: every client
 * gets a row (even one with zero review tasks), turnaround is only
 * averaged over completed tasks that actually have a `completedAt`.
 */
export function computeClientStats(
  clientRows: ClientRow[],
  reviewTasks: ReviewTaskRow[],
): ClientStats[] {
  const byClient = new Map<
    string,
    { completedCount: number; activeCount: number; turnaroundHoursSum: number; turnaroundCount: number }
  >();

  for (const task of reviewTasks) {
    if (!task.clientId) {
      continue;
    }
    const bucket = byClient.get(task.clientId) ?? {
      completedCount: 0,
      activeCount: 0,
      turnaroundHoursSum: 0,
      turnaroundCount: 0,
    };

    if (task.status === "completed") {
      bucket.completedCount++;
      if (task.completedAt) {
        const hours = (task.completedAt.getTime() - task.createdAt.getTime()) / (1000 * 60 * 60);
        bucket.turnaroundHoursSum += hours;
        bucket.turnaroundCount++;
      }
    } else {
      bucket.activeCount++;
    }

    byClient.set(task.clientId, bucket);
  }

  return clientRows.map((client) => {
    const bucket = byClient.get(client.id);
    return {
      id: client.id,
      tag: client.tag,
      displayName: client.displayName,
      recognized: client.recognized,
      lastActivityAt: client.lastActivityAt,
      completedCount: bucket?.completedCount ?? 0,
      activeCount: bucket?.activeCount ?? 0,
      avgTurnaroundHours:
        bucket && bucket.turnaroundCount > 0 ? bucket.turnaroundHoursSum / bucket.turnaroundCount : null,
    };
  });
}
