"use client";

import { useEffect, useState } from "react";
import PostingScheduleTab, { type PostingScheduleEntry } from "../components/team/PostingScheduleTab";

type Tab = "tasks" | "reviews" | "posting-schedule" | "content-ideas";

const TABS: { id: Tab; label: string }[] = [
  { id: "tasks", label: "Tasks" },
  { id: "reviews", label: "Reviews" },
  { id: "posting-schedule", label: "Posting Schedule" },
  { id: "content-ideas", label: "Content Ideas" },
];

export default function TeamDashboardPage() {
  const [activeTab, setActiveTab] = useState<Tab>("tasks");
  const [postingSchedule, setPostingSchedule] = useState<PostingScheduleEntry[]>([]);

  useEffect(() => {
    fetch("/api/posting-schedule/all")
      .then((res) => (res.ok ? res.json() : []))
      .then(setPostingSchedule)
      .catch(() => setPostingSchedule([]));
  }, []);

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
          {activeTab === "posting-schedule" ? (
            <PostingScheduleTab entries={postingSchedule} />
          ) : (
            <p style={{ color: "#595959" }}>Coming soon</p>
          )}
        </div>
      </div>
    </main>
  );
}
