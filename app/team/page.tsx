"use client";

import { useEffect, useState } from "react";
import PostingScheduleTab, { type PostingScheduleEntry } from "../components/team/PostingScheduleTab";
import ContentIdeasTab, { type ContentIdea } from "../components/team/ContentIdeasTab";
import ReviewsTab, { type ReviewTask } from "../components/team/ReviewsTab";
import TasksTab, { type TaskTodo } from "../components/team/TasksTab";

interface ApiTask {
  id: string;
  type: "review" | "todo";
  title: string;
  clientName: string | null;
  isStale: boolean;
  dueAt: string | null;
}

type Tab = "tasks" | "reviews" | "posting-schedule" | "content-ideas";

const TABS: { id: Tab; label: string }[] = [
  { id: "tasks", label: "Tasks" },
  { id: "reviews", label: "Reviews" },
  { id: "posting-schedule", label: "Posting Schedule" },
  { id: "content-ideas", label: "Content Ideas" },
];

type LoadState = "loading" | "ready" | "error";

/**
 * A failed or still-in-flight fetch must never look like "nothing to do" —
 * a confident zero-count dashboard is worse than a visible loading/error
 * state (same `"loading" | "ready" | "error"` pattern the existing
 * `PostingSchedule` dashboard card already uses). Tracked per source so
 * one source failing doesn't block the tabs that loaded fine.
 */
export default function TeamDashboardPage() {
  const [activeTab, setActiveTab] = useState<Tab>("tasks");
  const [postingSchedule, setPostingSchedule] = useState<PostingScheduleEntry[]>([]);
  const [tasks, setTasks] = useState<ApiTask[]>([]);
  const [contentIdeas, setContentIdeas] = useState<ContentIdea[]>([]);
  const [postingScheduleState, setPostingScheduleState] = useState<LoadState>("loading");
  const [tasksState, setTasksState] = useState<LoadState>("loading");
  const [contentIdeasState, setContentIdeasState] = useState<LoadState>("loading");

  useEffect(() => {
    fetch("/api/posting-schedule/all")
      .then((res) => {
        if (!res.ok) throw new Error("Failed to load the posting schedule");
        return res.json();
      })
      .then((data) => {
        setPostingSchedule(data);
        setPostingScheduleState("ready");
      })
      .catch(() => setPostingScheduleState("error"));

    fetch("/api/tasks")
      .then((res) => {
        if (!res.ok) throw new Error("Failed to load tasks");
        return res.json();
      })
      .then((data) => {
        setTasks(data);
        setTasksState("ready");
      })
      .catch(() => setTasksState("error"));

    fetch("/api/content-ideas/all")
      .then((res) => {
        if (!res.ok) throw new Error("Failed to load content ideas");
        return res.json();
      })
      .then((data) => {
        setContentIdeas(data);
        setContentIdeasState("ready");
      })
      .catch(() => setContentIdeasState("error"));
  }, []);

  const todos: TaskTodo[] = tasks
    .filter((task) => task.type === "todo")
    .map((task) => ({ id: task.id, title: task.title, dueAt: task.dueAt }));
  const reviews: ReviewTask[] = tasks
    .filter((task) => task.type === "review")
    .map((task) => ({ id: task.id, title: task.title, clientName: task.clientName, isStale: task.isStale }));

  return (
    <main style={{ maxWidth: 1100, margin: "0 auto", padding: 20, fontFamily: "inherit" }}>
      <a href="/" style={{ fontSize: 14, color: "#595959", textDecoration: "none" }}>
        ← Dashboard
      </a>

      <div
        style={{
          background: "#fff",
          color: "#111",
          border: "1px solid #e2e2e2",
          borderRadius: 12,
          overflow: "hidden",
          marginTop: 12,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "20px 24px",
            borderBottom: "1px solid #e2e2e2",
            flexWrap: "wrap",
            gap: 12,
          }}
        >
          <div>
            <div style={{ fontSize: 20, fontWeight: 800, letterSpacing: -0.3 }}>Team Dashboard</div>
            <div style={{ fontSize: 13, color: "#595959", marginTop: 2 }}>Shared view — same login as the app</div>
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            {TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                style={{
                  padding: "8px 14px",
                  borderRadius: 8,
                  fontSize: 13,
                  fontWeight: 600,
                  border: "1px solid #e2e2e2",
                  background: activeTab === tab.id ? "#111" : "#fff",
                  color: activeTab === tab.id ? "#fff" : "#111",
                  cursor: "pointer",
                }}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        <div style={{ padding: 24 }}>
          {activeTab === "tasks" ? (
            tasksState === "loading" ? (
              <p style={{ color: "#595959" }}>Loading…</p>
            ) : tasksState === "error" ? (
              <p style={{ color: "#595959" }} role="alert">Couldn&apos;t load tasks — try reloading the page.</p>
            ) : (
              <TasksTab todos={todos} />
            )
          ) : activeTab === "reviews" ? (
            tasksState === "loading" ? (
              <p style={{ color: "#595959" }}>Loading…</p>
            ) : tasksState === "error" ? (
              <p style={{ color: "#595959" }} role="alert">Couldn&apos;t load reviews — try reloading the page.</p>
            ) : (
              <ReviewsTab reviews={reviews} />
            )
          ) : activeTab === "posting-schedule" ? (
            postingScheduleState === "loading" ? (
              <p style={{ color: "#595959" }}>Loading…</p>
            ) : postingScheduleState === "error" ? (
              <p style={{ color: "#595959" }} role="alert">Couldn&apos;t load the posting schedule — try reloading the page.</p>
            ) : (
              <PostingScheduleTab entries={postingSchedule} />
            )
          ) : contentIdeasState === "loading" ? (
            <p style={{ color: "#595959" }}>Loading…</p>
          ) : contentIdeasState === "error" ? (
            <p style={{ color: "#595959" }} role="alert">Couldn&apos;t load content ideas — try reloading the page.</p>
          ) : (
            <ContentIdeasTab ideas={contentIdeas} />
          )}
        </div>
      </div>
    </main>
  );
}
