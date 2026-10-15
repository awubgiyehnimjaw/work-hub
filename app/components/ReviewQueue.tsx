"use client";

import { useState } from "react";

export interface ReviewTask {
  id: string;
  title: string;
  frameioUrl: string | null;
  sourceFileName: string | null;
  isStale: boolean;
  clientName: string | null;
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
  const [customSnoozeId, setCustomSnoozeId] = useState<string | null>(null);
  const [customSnoozeValue, setCustomSnoozeValue] = useState("");

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

  function openCustomSnooze(id: string) {
    setCustomSnoozeId(id);
    setCustomSnoozeValue("");
    setErrorId(null);
  }

  async function handleCustomSnooze(id: string) {
    const until = customSnoozeValue ? new Date(customSnoozeValue) : null;
    if (!until || Number.isNaN(until.getTime())) {
      return;
    }
    await handleSnooze(id, until);
    setCustomSnoozeId(null);
  }

  return (
    <section style={{ marginBottom: 32 }}>
      <h2 style={{ fontSize: 20, fontWeight: 700, margin: "0 0 12px" }}>Needs your review</h2>

      {tasks.length === 0 ? (
        <p style={{ color: "var(--color-text-muted)", margin: 0 }}>You&apos;re caught up — no reviews waiting.</p>
      ) : (
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 12 }}>
          {tasks.map((task) => {
            const isBusy = busyId === task.id;
            return (
              <li
                key={task.id}
                style={{
                  border: task.isStale ? "1px solid var(--color-danger-border)" : "1px solid var(--color-border)",
                  backgroundColor: task.isStale ? "var(--color-danger-bg)" : "var(--color-surface)",
                  borderRadius: 10,
                  padding: 14,
                  boxShadow: "var(--shadow-card)",
                }}
              >
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
                  {task.sourceFileName ? (
                    <div>
                      <div style={{ fontSize: 16, fontWeight: 700 }}>
                        Review — &quot;{task.sourceFileName}&quot;
                      </div>
                      <div style={{ fontSize: 14, color: "var(--color-text-muted)", marginTop: 2 }}>
                        Client — {task.clientName ?? "Unrecognized"}
                      </div>
                    </div>
                  ) : (
                    <strong style={{ fontSize: 16 }}>{task.title}</strong>
                  )}
                  <span style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
                    {task.clientRecognized === false ? (
                      <span
                        style={{
                          fontSize: 12,
                          fontWeight: 600,
                          color: "var(--color-warning)",
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
                          color: "var(--color-danger)",
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
                      className="interactive"
                      style={{
                        display: "inline-block",
                        color: "var(--color-primary-text)",
                        backgroundColor: "var(--color-primary)",
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
                    <span style={{ fontSize: 14, color: "var(--color-text-muted)" }}>No Frame.io link</span>
                  )}
                </div>

                <div style={{ marginTop: 10, display: "flex", flexWrap: "wrap", gap: 8 }}>
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() => handleComplete(task.id)}
                    className="interactive"
                    style={{
                      backgroundColor: "var(--color-success)",
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
                    className="interactive"
                    style={{
                      backgroundColor: "var(--color-surface-muted)",
                      color: "var(--color-text)",
                      border: "1px solid var(--color-border)",
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
                    className="interactive"
                    style={{
                      backgroundColor: "var(--color-surface-muted)",
                      color: "var(--color-text)",
                      border: "1px solid var(--color-border)",
                      borderRadius: 8,
                      padding: "8px 12px",
                      fontSize: 14,
                      fontWeight: 600,
                      opacity: isBusy ? 0.6 : 1,
                    }}
                  >
                    Tomorrow morning
                  </button>
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() => openCustomSnooze(task.id)}
                    className="interactive"
                    style={{
                      backgroundColor: "var(--color-surface-muted)",
                      color: "var(--color-text)",
                      border: "1px solid var(--color-border)",
                      borderRadius: 8,
                      padding: "8px 12px",
                      fontSize: 14,
                      fontWeight: 600,
                      opacity: isBusy ? 0.6 : 1,
                    }}
                  >
                    Snooze until…
                  </button>
                </div>

                {customSnoozeId === task.id ? (
                  <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
                    <input
                      type="datetime-local"
                      value={customSnoozeValue}
                      onChange={(event) => setCustomSnoozeValue(event.target.value)}
                      aria-label="Snooze until"
                      autoFocus
                      style={{
                        flex: 1,
                        padding: "8px 10px",
                        fontSize: 13,
                        borderRadius: 8,
                        border: "1px solid var(--color-border)",
                        backgroundColor: "var(--color-surface)",
                        color: "var(--color-text)",
                      }}
                    />
                    <button
                      type="button"
                      disabled={isBusy || customSnoozeValue.length === 0}
                      onClick={() => handleCustomSnooze(task.id)}
                      className="interactive"
                      style={{
                        backgroundColor: "var(--color-primary)",
                        color: "var(--color-primary-text)",
                        border: "none",
                        borderRadius: 8,
                        padding: "8px 12px",
                        fontSize: 13,
                        fontWeight: 600,
                        opacity: isBusy || customSnoozeValue.length === 0 ? 0.6 : 1,
                      }}
                    >
                      Set
                    </button>
                    <button
                      type="button"
                      onClick={() => setCustomSnoozeId(null)}
                      className="interactive"
                      style={{
                        backgroundColor: "var(--color-surface-muted)",
                        color: "var(--color-text)",
                        border: "1px solid var(--color-border)",
                        borderRadius: 8,
                        padding: "8px 12px",
                        fontSize: 13,
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                ) : null}

                {errorId === task.id ? (
                  <p role="alert" style={{ color: "var(--color-danger)", fontSize: 13, margin: "8px 0 0" }}>
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
