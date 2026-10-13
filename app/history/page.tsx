"use client";

import { useCallback, useEffect, useState } from "react";

interface ApiTask {
  id: string;
  type: "review" | "todo";
  title: string;
  clientId: string | null;
  clientName: string | null;
  completedAt: string | null;
}

interface ClientGroup {
  clientId: string | null;
  clientName: string;
  tasks: ApiTask[];
}

type LoadState = "loading" | "ready" | "error";

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  day: "numeric",
  month: "short",
  year: "numeric",
});

function formatCompletedAt(completedAt: string | null): string {
  if (!completedAt) {
    return "Unknown date";
  }
  return dateFormatter.format(new Date(completedAt));
}

/**
 * Groups completed review tasks by client, newest-completion-first within
 * each group, groups themselves alphabetical by client name. Only
 * `type: 'review'` tasks carry a client — completed to-dos (which never
 * do, per `POST /api/tasks`) are filtered out by the caller before this
 * runs, since this page is about per-client review volume, not Callum's
 * own to-dos.
 */
function groupByClient(reviewTasks: ApiTask[]): ClientGroup[] {
  const groups = new Map<string, ClientGroup>();

  for (const task of reviewTasks) {
    const key = task.clientId ?? "unrecognized";
    const existing = groups.get(key);
    if (existing) {
      existing.tasks.push(task);
    } else {
      groups.set(key, {
        clientId: task.clientId,
        clientName: task.clientName ?? "Unrecognized client",
        tasks: [task],
      });
    }
  }

  const result = Array.from(groups.values());
  for (const group of result) {
    group.tasks.sort((a, b) => {
      const aTime = a.completedAt ? new Date(a.completedAt).getTime() : 0;
      const bTime = b.completedAt ? new Date(b.completedAt).getTime() : 0;
      return bTime - aTime;
    });
  }
  result.sort((a, b) => a.clientName.localeCompare(b.clientName));
  return result;
}

export default function HistoryPage() {
  const [groups, setGroups] = useState<ClientGroup[]>([]);
  const [state, setState] = useState<LoadState>("loading");

  const loadHistory = useCallback(async () => {
    setState("loading");
    try {
      const res = await fetch("/api/tasks?status=completed");
      if (!res.ok) {
        throw new Error("Failed to load history");
      }
      const data: ApiTask[] = await res.json();
      const reviewTasks = data.filter((task) => task.type === "review");
      setGroups(groupByClient(reviewTasks));
      setState("ready");
    } catch {
      setState("error");
    }
  }, []);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  return (
    <main style={{ maxWidth: 480, margin: "0 auto", padding: 16, fontFamily: "system-ui, sans-serif" }}>
      <a href="/" style={{ fontSize: 14, color: "#6b7280", textDecoration: "none" }}>
        ← Dashboard
      </a>
      <h1 style={{ fontSize: 22, fontWeight: 800, margin: "8px 0 24px" }}>History</h1>

      {state === "loading" ? <p style={{ color: "#6b7280" }}>Loading…</p> : null}
      {state === "error" ? (
        <p role="alert" style={{ color: "#b42318" }}>
          Couldn&apos;t load history.{" "}
          <button
            type="button"
            onClick={loadHistory}
            style={{ color: "#b42318", textDecoration: "underline", background: "none", border: "none", padding: 0, font: "inherit", cursor: "pointer" }}
          >
            Try again
          </button>
        </p>
      ) : null}

      {state === "ready" && groups.length === 0 ? (
        <p style={{ color: "#6b7280" }}>No completed reviews yet.</p>
      ) : null}

      {state === "ready" && groups.length > 0 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          {groups.map((group) => (
            <section key={group.clientId ?? "unrecognized"}>
              <h2 style={{ fontSize: 18, fontWeight: 700, margin: "0 0 12px" }}>
                {group.clientName}{" "}
                <span style={{ fontSize: 13, fontWeight: 500, color: "#6b7280" }}>
                  ({group.tasks.length} completed)
                </span>
              </h2>
              <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
                {group.tasks.map((task) => (
                  <li
                    key={task.id}
                    style={{
                      display: "flex",
                      alignItems: "baseline",
                      justifyContent: "space-between",
                      gap: 8,
                      border: "1px solid #e5e7eb",
                      borderRadius: 10,
                      padding: "10px 12px",
                      backgroundColor: "#ffffff",
                    }}
                  >
                    <span style={{ fontSize: 15 }}>{task.title}</span>
                    <span style={{ fontSize: 13, color: "#6b7280", whiteSpace: "nowrap" }}>
                      {formatCompletedAt(task.completedAt)}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      ) : null}
    </main>
  );
}
