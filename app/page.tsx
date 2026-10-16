"use client";

import { useCallback, useEffect, useState } from "react";
import CalendarAgenda from "./components/CalendarAgenda";
import EnableNotificationsButton from "./components/EnableNotificationsButton";
import ReviewQueue from "./components/ReviewQueue";
import SuggestionCard from "./components/SuggestionCard";
import TodoList from "./components/TodoList";
import {
  AUTO_REFRESH_INTERVAL_MS,
  createAutoRefresh,
  createBrowserAutoRefreshDeps,
} from "@/lib/dashboard/auto-refresh";

interface ApiTask {
  id: string;
  type: "review" | "todo";
  title: string;
  frameioUrl: string | null;
  sourceFileName: string | null;
  isStale: boolean;
  clientName: string | null;
  clientRecognized: boolean | null;
  dueAt: string | null;
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

    // Important 5: refetch when the installed PWA regains focus/visibility
    // (e.g. resumed from background after hours) rather than only ever
    // fetching once on mount, plus a light 60s polling backstop for any
    // other staleness (e.g. the Frame.io poll creating a task while the
    // dashboard just sits open and visible).
    return createAutoRefresh(loadTasks, AUTO_REFRESH_INTERVAL_MS, createBrowserAutoRefreshDeps());
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

  async function addTodo(title: string, dueAt: Date | null) {
    const res = await fetch("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, dueAt: dueAt ? dueAt.toISOString() : undefined }),
    });
    if (!res.ok) {
      throw new Error("Failed to add to-do");
    }
    const created: ApiTask = await res.json();
    setTasks((prev) => [...prev, created]);
  }

  const reviewTasks = tasks.filter((task) => task.type === "review");
  const todoTasks = tasks.filter((task) => task.type === "todo");
  // Always shown when loaded, not just when the queue is empty — a growth
  // idea is worth surfacing alongside active work too, not only as an
  // idle-time filler.
  const showSuggestion = state === "ready";

  return (
    <main style={{ maxWidth: 560, margin: "0 auto", padding: 20, fontFamily: "inherit" }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", flexWrap: "wrap", gap: 8, margin: "8px 0 28px" }}>
        <h1 style={{ fontSize: 23, fontWeight: 800, margin: 0, letterSpacing: -0.3 }}>ARC Hub</h1>
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
          <a href="/clients" className="interactive" style={{ fontSize: 14, color: "var(--color-text-muted)", textDecoration: "none" }}>
            Clients →
          </a>
          <a href="/content-ideas" className="interactive" style={{ fontSize: 14, color: "var(--color-text-muted)", textDecoration: "none" }}>
            Ideas →
          </a>
          <a href="/suggestions" className="interactive" style={{ fontSize: 14, color: "var(--color-text-muted)", textDecoration: "none" }}>
            Suggestions →
          </a>
          <a href="/history" className="interactive" style={{ fontSize: 14, color: "var(--color-text-muted)", textDecoration: "none" }}>
            History →
          </a>
        </div>
      </div>

      <div style={{ marginBottom: 28 }}>
        <EnableNotificationsButton />
      </div>

      {state === "loading" ? <p style={{ color: "var(--color-text-muted)" }}>Loading…</p> : null}
      {state === "error" ? (
        <p role="alert" style={{ color: "var(--color-danger)" }}>
          Couldn&apos;t load your dashboard.{" "}
          <button
            type="button"
            onClick={loadTasks}
            className="interactive"
            style={{ color: "var(--color-danger)", textDecoration: "underline", background: "none", border: "none", padding: 0, font: "inherit" }}
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
