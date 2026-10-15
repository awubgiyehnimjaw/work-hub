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
        <p style={{ color: "var(--color-text-muted)", margin: "0 0 12px" }}>Nothing on your list.</p>
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
                  border: due?.overdue ? "1px solid var(--color-danger-border)" : "1px solid var(--color-border)",
                  backgroundColor: due?.overdue ? "var(--color-danger-bg)" : "var(--color-surface)",
                  borderRadius: 10,
                  padding: "10px 12px",
                  boxShadow: "var(--shadow-card)",
                }}
              >
                <div>
                  <span style={{ fontSize: 15 }}>{task.title}</span>
                  {due ? (
                    <div
                      style={{
                        fontSize: 12,
                        marginTop: 2,
                        color: due.overdue ? "var(--color-danger)" : "var(--color-text-muted)",
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
                  className="interactive"
                  style={{
                    backgroundColor: "var(--color-surface-muted)",
                    color: "var(--color-text)",
                    border: "1px solid var(--color-border)",
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
                  <span role="alert" style={{ color: "var(--color-danger)", fontSize: 12 }}>
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
