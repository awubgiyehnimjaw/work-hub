"use client";

import { useState } from "react";
import QuickAddButton from "./QuickAddButton";

export interface TodoTask {
  id: string;
  title: string;
  dueAt: string | null;
}

interface TodoListProps {
  tasks: TodoTask[];
  onAdd: (title: string, dueAt: Date | null) => Promise<void>;
  onComplete: (id: string) => Promise<void>;
}

const dueDateFormatter = new Intl.DateTimeFormat(undefined, {
  day: "numeric",
  month: "short",
  hour: "numeric",
  minute: "2-digit",
});

function formatDue(dueAt: string): { label: string; overdue: boolean } {
  const due = new Date(dueAt);
  return { label: dueDateFormatter.format(due), overdue: due.getTime() < Date.now() };
}

export default function TodoList({ tasks, onAdd, onComplete }: TodoListProps) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [errorId, setErrorId] = useState<string | null>(null);

  async function handleComplete(id: string) {
    setBusyId(id);
    setErrorId(null);
    try {
      await onComplete(id);
    } catch {
      setErrorId(id);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section style={{ marginBottom: 32 }}>
      <h2 style={{ fontSize: 18, fontWeight: 700, margin: "0 0 12px" }}>To-dos</h2>

      {tasks.length === 0 ? (
        <p style={{ color: "#6b7280", margin: "0 0 12px" }}>Nothing on your list.</p>
      ) : (
        <ul
          style={{
            listStyle: "none",
            margin: "0 0 12px",
            padding: 0,
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          {tasks.map((task) => {
            const isBusy = busyId === task.id;
            const due = task.dueAt ? formatDue(task.dueAt) : null;
            return (
              <li
                key={task.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 8,
                  border: due?.overdue ? "1px solid #f3b4ab" : "1px solid #e5e7eb",
                  backgroundColor: due?.overdue ? "#fef2f1" : "#ffffff",
                  borderRadius: 10,
                  padding: "10px 12px",
                }}
              >
                <div>
                  <span style={{ fontSize: 15 }}>{task.title}</span>
                  {due ? (
                    <div
                      style={{
                        fontSize: 12,
                        marginTop: 2,
                        color: due.overdue ? "#b42318" : "#6b7280",
                        fontWeight: due.overdue ? 600 : 400,
                      }}
                    >
                      {due.overdue ? "Overdue — " : "Due "}
                      {due.label}
                    </div>
                  ) : null}
                </div>
                <button
                  type="button"
                  disabled={isBusy}
                  onClick={() => handleComplete(task.id)}
                  aria-label={`Mark "${task.title}" done`}
                  style={{
                    backgroundColor: "#f3f4f6",
                    color: "#111827",
                    border: "1px solid #d1d5db",
                    borderRadius: 8,
                    padding: "6px 10px",
                    fontSize: 13,
                    fontWeight: 600,
                    opacity: isBusy ? 0.6 : 1,
                    whiteSpace: "nowrap",
                  }}
                >
                  Done
                </button>
                {errorId === task.id ? (
                  <span role="alert" style={{ color: "#b42318", fontSize: 12 }}>
                    Failed
                  </span>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      <QuickAddButton onAdd={onAdd} />
    </section>
  );
}
