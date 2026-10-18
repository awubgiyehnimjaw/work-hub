"use client";

import { useState } from "react";
import QuickAddButton from "./QuickAddButton";
import { classifyDueStatus, type DueStatus } from "@/lib/tasks/due-status";

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

function formatDue(dueAt: string): string {
  return dueDateFormatter.format(new Date(dueAt));
}

// Card border/background per DueStatus band — overdue is handled separately
// via the .todo-overdue class (rainbow gradient border), since a gradient
// can't be expressed as a plain inline border color.
function dueCardStyle(status: DueStatus): { border: string; backgroundColor: string } {
  switch (status) {
    case "red":
      return { border: "1px solid var(--color-danger-border)", backgroundColor: "var(--color-danger-bg)" };
    case "yellow":
      return { border: "1px solid var(--color-warning-border)", backgroundColor: "var(--color-warning-bg)" };
    case "green":
      return { border: "1px solid var(--color-success-border)", backgroundColor: "var(--color-success-bg)" };
    default:
      return { border: "1px solid var(--color-border)", backgroundColor: "var(--color-surface)" };
  }
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
            const dueLabel = task.dueAt ? formatDue(task.dueAt) : null;
            const dueStatus = task.dueAt ? classifyDueStatus(new Date(task.dueAt), new Date()) : null;
            const overdue = dueStatus === "overdue";
            const cardStyle = dueCardStyle(dueStatus);
            return (
              <li
                key={task.id}
                className={overdue ? "todo-overdue" : undefined}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 8,
                  border: overdue ? undefined : cardStyle.border,
                  backgroundColor: overdue ? undefined : cardStyle.backgroundColor,
                  borderRadius: 10,
                  padding: "10px 12px",
                  boxShadow: "var(--shadow-card)",
                }}
              >
                <div>
                  <span style={{ fontSize: 15 }}>{task.title}</span>
                  {dueLabel ? (
                    <div
                      style={{
                        fontSize: 12,
                        marginTop: 2,
                        color: overdue ? "var(--color-danger)" : "var(--color-text-muted)",
                        fontWeight: overdue ? 600 : 400,
                      }}
                    >
                      {overdue ? "Overdue — " : "Due "}
                      {dueLabel}
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
