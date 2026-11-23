"use client";

import { useMemo, useState } from "react";
import { classifyDueStatus } from "@/lib/tasks/due-status";
import TeamDot, { type TeamDotVariant } from "./TeamDot";
import TeamStatCard from "./TeamStatCard";

export interface TaskTodo {
  id: string;
  title: string;
  dueAt: string | null;
}

type TodoStatus = "overdue" | "due-soon" | "no-due-date-soon";

const STATUS_LABELS: Record<TodoStatus, string> = {
  overdue: "Overdue",
  "due-soon": "Due soon",
  "no-due-date-soon": "No due date soon",
};

const STATUS_DOT: Record<TodoStatus, TeamDotVariant> = {
  overdue: "filled",
  "due-soon": "outline",
  "no-due-date-soon": "none",
};

function statusOf(dueAt: string | null, now: Date): TodoStatus {
  if (!dueAt) return "no-due-date-soon";
  const band = classifyDueStatus(new Date(dueAt), now);
  if (band === "overdue") return "overdue";
  if (band === "red" || band === "yellow") return "due-soon";
  return "no-due-date-soon";
}

const pillStyle = (on: boolean) => ({
  padding: "7px 12px",
  borderRadius: 999,
  fontSize: 12,
  fontWeight: 600 as const,
  border: "1px solid #e2e2e2",
  background: on ? "#111" : "#fff",
  color: on ? "#fff" : "#111",
  cursor: "pointer",
  whiteSpace: "nowrap" as const,
});

export default function TasksTab({ todos }: { todos: TaskTodo[] }) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<TodoStatus | "all">("all");
  const now = useMemo(() => new Date(), []);

  const withStatus = useMemo(
    () => todos.map((todo) => ({ ...todo, status: statusOf(todo.dueAt, now) })),
    [todos, now],
  );

  const countByStatus = (s: TodoStatus) => withStatus.filter((t) => t.status === s).length;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return withStatus.filter((todo) => {
      if (status !== "all" && todo.status !== status) return false;
      if (q && !todo.title.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [withStatus, search, status]);

  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 16 }}>
        <TeamStatCard label="Total active" value={todos.length} />
        <TeamStatCard label="Overdue" value={countByStatus("overdue")} />
        <TeamStatCard label="Due soon" value={countByStatus("due-soon")} />
        <TeamStatCard label="No due date soon" value={countByStatus("no-due-date-soon")} />
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 16 }}>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search title…"
          style={{ flex: 1, minWidth: 200, border: "1px solid #e2e2e2", borderRadius: 8, padding: "9px 12px", fontSize: 13 }}
        />
        <button type="button" style={pillStyle(status === "all")} onClick={() => setStatus("all")}>
          All ({todos.length})
        </button>
        {(Object.keys(STATUS_LABELS) as TodoStatus[]).map((s) => (
          <button key={s} type="button" style={pillStyle(status === s)} onClick={() => setStatus(s)}>
            {STATUS_LABELS[s]} ({countByStatus(s)})
          </button>
        ))}
      </div>

      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr>
            {["Title", "Due date", "Status"].map((h) => (
              <th
                key={h}
                style={{
                  textAlign: "left",
                  fontSize: 11,
                  fontWeight: 700,
                  letterSpacing: 0.4,
                  textTransform: "uppercase",
                  color: "#595959",
                  padding: "10px 16px",
                  borderTop: "1px solid #e2e2e2",
                  borderBottom: "1px solid #e2e2e2",
                  background: "#f6f6f6",
                }}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {filtered.length === 0 ? (
            <tr>
              <td colSpan={3} style={{ padding: "16px", textAlign: "center", color: "#595959" }}>
                No matching entries
              </td>
            </tr>
          ) : (
            filtered.map((todo) => (
              <tr key={todo.id}>
                <td style={{ padding: "12px 16px", borderBottom: "1px solid #e2e2e2" }}>{todo.title}</td>
                <td style={{ padding: "12px 16px", borderBottom: "1px solid #e2e2e2" }}>
                  {todo.dueAt ? new Date(todo.dueAt).toLocaleDateString() : "—"}
                </td>
                <td style={{ padding: "12px 16px", borderBottom: "1px solid #e2e2e2" }}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontWeight: 600 }}>
                    <TeamDot variant={STATUS_DOT[todo.status]} />
                    {STATUS_LABELS[todo.status]}
                  </span>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
