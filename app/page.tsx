"use client";

import { useCallback, useEffect, useState } from "react";
import CalendarAgenda from "./components/CalendarAgenda";
import ReviewQueue from "./components/ReviewQueue";
import SuggestionCard from "./components/SuggestionCard";
import TodoList from "./components/TodoList";

interface ApiTask {
  id: string;
  type: "review" | "todo";
  title: string;
  frameioUrl: string | null;
  isStale: boolean;
}

type LoadState = "loading" | "ready" | "error";

export default function HomePage() {
  const [tasks, setTasks] = useState<ApiTask[]>([]);
  const [state, setState] = useState<LoadState>("loading");

  const loadTasks = useCallback(async () => {
    try {
      const res = await fetch("/api/tasks");
      if (!res.ok) {
        throw new Error("Failed to load tasks");
      }
      const data: ApiTask[] = await res.json();
      setTasks(data);
      setState("ready");
    } catch {
      setState("error");
    }
  }, []);

  useEffect(() => {
    loadTasks();
  }, [loadTasks]);

  // Complete/snooze/add all go through the real API first and only update
  // local state once the server confirms the change — so a reload always
  // shows the same thing the dashboard just showed, never a UI-only change
  // that silently reverts. Removing a completed/snoozed task from state
  // here mirrors exactly what `GET /api/tasks` itself would now return.
  async function completeTask(id: string) {
    const res = await fetch(`/api/tasks/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "complete" }),
    });
    if (!res.ok) {
      throw new Error("Failed to complete task");
    }
    setTasks((prev) => prev.filter((task) => task.id !== id));
  }

  async function snoozeTask(id: string, until: Date) {
    const res = await fetch(`/api/tasks/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "snooze", until: until.toISOString() }),
    });
    if (!res.ok) {
      throw new Error("Failed to snooze task");
    }
    setTasks((prev) => prev.filter((task) => task.id !== id));
  }

  async function addTodo(title: string) {
    const res = await fetch("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    });
    if (!res.ok) {
      throw new Error("Failed to add to-do");
    }
    const created: ApiTask = await res.json();
    setTasks((prev) => [...prev, created]);
  }

  const reviewTasks = tasks.filter((task) => task.type === "review");
  const todoTasks = tasks.filter((task) => task.type === "todo");
  const showSuggestion = state === "ready" && reviewTasks.length === 0 && todoTasks.length === 0;

  return (
    <main style={{ maxWidth: 480, margin: "0 auto", padding: 16, fontFamily: "system-ui, sans-serif" }}>
      <h1 style={{ fontSize: 22, fontWeight: 800, margin: "8px 0 24px" }}>Work Hub</h1>

      {state === "loading" ? <p style={{ color: "#6b7280" }}>Loading…</p> : null}
      {state === "error" ? (
        <p role="alert" style={{ color: "#b42318" }}>
          Couldn&apos;t load your dashboard.{" "}
          <button
            type="button"
            onClick={loadTasks}
            style={{ color: "#b42318", textDecoration: "underline", background: "none", border: "none", padding: 0, font: "inherit", cursor: "pointer" }}
          >
            Try again
          </button>
        </p>
      ) : null}

      {state === "ready" ? (
        <>
          <ReviewQueue tasks={reviewTasks} onComplete={completeTask} onSnooze={snoozeTask} />
          <TodoList tasks={todoTasks} onAdd={addTodo} onComplete={completeTask} />
          <CalendarAgenda />
          {showSuggestion ? <SuggestionCard /> : null}
        </>
      ) : null}
    </main>
  );
}
