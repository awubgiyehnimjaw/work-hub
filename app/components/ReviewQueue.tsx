"use client";

import { useState } from "react";

export interface ReviewTask {
  id: string;
  title: string;
  frameioUrl: string | null;
  isStale: boolean;
  clientRecognized: boolean | null;
}

interface ReviewQueueProps {
  tasks: ReviewTask[];
  onComplete: (id: string) => Promise<void>;
  onSnooze: (id: string, until: Date) => Promise<void>;
}

// "2 hours from now" and "tomorrow morning" per the task brief's two snooze
// options. "Tomorrow morning" is deliberately a fixed 8am local time on the
// next calendar day, not "8 hours from now" — it should land Callum back at
// the task first thing the next day regardless of what time he snoozes it.
function inTwoHours(): Date {
  return new Date(Date.now() + 2 * 60 * 60 * 1000);
}

function tomorrowMorning(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 8, 0, 0, 0);
}

export default function ReviewQueue({ tasks, onComplete, onSnooze }: ReviewQueueProps) {
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

  async function handleSnooze(id: string, until: Date) {
    setBusyId(id);
    setErrorId(null);
    try {
      await onSnooze(id, until);
    } catch {
      setErrorId(id);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section style={{ marginBottom: 32 }}>
      <h2 style={{ fontSize: 20, fontWeight: 700, margin: "0 0 12px" }}>Needs your review</h2>

      {tasks.length === 0 ? (
        <p style={{ color: "#6b7280", margin: 0 }}>You&apos;re caught up — no reviews waiting.</p>
      ) : (
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 12 }}>
          {tasks.map((task) => {
            const isBusy = busyId === task.id;
            return (
              <li
                key={task.id}
                style={{
                  border: task.isStale ? "1px solid #f3b4ab" : "1px solid #e5e7eb",
                  backgroundColor: task.isStale ? "#fef2f1" : "#ffffff",
                  borderRadius: 10,
                  padding: 14,
                }}
              >
                <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
                  <strong style={{ fontSize: 16 }}>{task.title}</strong>
                  <span style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
                    {task.clientRecognized === false ? (
                      <span
                        style={{
                          fontSize: 12,
                          fontWeight: 600,
                          color: "#92400e",
                          whiteSpace: "nowrap",
                        }}
                      >
                        ⚠ Unrecognized client
                      </span>
                    ) : null}
                    {task.isStale ? (
                      <span
                        style={{
                          fontSize: 12,
                          fontWeight: 600,
                          color: "#b42318",
                          whiteSpace: "nowrap",
                        }}
                      >
                        Waiting 2+ days
                      </span>
                    ) : null}
                  </span>
                </div>

                <div style={{ marginTop: 10 }}>
                  {task.frameioUrl ? (
                    <a
                      href={task.frameioUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        display: "inline-block",
                        color: "#ffffff",
                        backgroundColor: "#111827",
                        borderRadius: 8,
                        padding: "8px 12px",
                        fontSize: 14,
                        fontWeight: 600,
                        textDecoration: "none",
                      }}
                    >
                      Open in Frame.io
                    </a>
                  ) : (
                    <span style={{ fontSize: 14, color: "#6b7280" }}>No Frame.io link</span>
                  )}
                </div>

                <div style={{ marginTop: 10, display: "flex", flexWrap: "wrap", gap: 8 }}>
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() => handleComplete(task.id)}
                    style={{
                      backgroundColor: "#16a34a",
                      color: "#ffffff",
                      border: "none",
                      borderRadius: 8,
                      padding: "8px 12px",
                      fontSize: 14,
                      fontWeight: 600,
                      opacity: isBusy ? 0.6 : 1,
                    }}
                  >
                    Complete
                  </button>
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() => handleSnooze(task.id, inTwoHours())}
                    style={{
                      backgroundColor: "#f3f4f6",
                      color: "#111827",
                      border: "1px solid #d1d5db",
                      borderRadius: 8,
                      padding: "8px 12px",
                      fontSize: 14,
                      fontWeight: 600,
                      opacity: isBusy ? 0.6 : 1,
                    }}
                  >
                    Snooze 2h
                  </button>
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() => handleSnooze(task.id, tomorrowMorning())}
                    style={{
                      backgroundColor: "#f3f4f6",
                      color: "#111827",
                      border: "1px solid #d1d5db",
                      borderRadius: 8,
                      padding: "8px 12px",
                      fontSize: 14,
                      fontWeight: 600,
                      opacity: isBusy ? 0.6 : 1,
                    }}
                  >
                    Tomorrow morning
                  </button>
                </div>

                {errorId === task.id ? (
                  <p role="alert" style={{ color: "#b42318", fontSize: 13, margin: "8px 0 0" }}>
                    Something went wrong — try again.
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
