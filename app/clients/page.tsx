"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";

interface Client {
  id: string;
  tag: string;
  displayName: string;
  recognized: boolean;
  lastActivityAt: string | null;
  legalName: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  attention: string | null;
}

interface ClientStats {
  id: string;
  tag: string;
  displayName: string;
  recognized: boolean;
  lastActivityAt: string | null;
  completedCount: number;
  activeCount: number;
  avgTurnaroundHours: number | null;
}

type LoadState = "loading" | "ready" | "error";

const inputStyle = {
  padding: "8px 10px",
  fontSize: 14,
  borderRadius: 8,
  border: "1px solid var(--color-border)",
  backgroundColor: "var(--color-surface)",
  color: "var(--color-text)",
};

const dateFormatter = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" });

function formatLastActivity(lastActivityAt: string | null): string {
  if (!lastActivityAt) {
    return "No activity yet";
  }
  return dateFormatter.format(new Date(lastActivityAt));
}

function formatTurnaround(hours: number | null): string {
  if (hours === null) {
    return "—";
  }
  if (hours < 24) {
    return `${hours.toFixed(1)}h`;
  }
  return `${(hours / 24).toFixed(1)}d`;
}

export default function ClientsPage() {
  const [clients, setClients] = useState<Client[]>([]);
  const [stats, setStats] = useState<ClientStats[]>([]);
  const [state, setState] = useState<LoadState>("loading");

  const [newTag, setNewTag] = useState("");
  const [newDisplayName, setNewDisplayName] = useState("");
  const [displayNameTouched, setDisplayNameTouched] = useState(false);
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTag, setEditTag] = useState("");
  const [editDisplayName, setEditDisplayName] = useState("");
  const [editLegalName, setEditLegalName] = useState("");
  const [editAddressLine1, setEditAddressLine1] = useState("");
  const [editAddressLine2, setEditAddressLine2] = useState("");
  const [editAttention, setEditAttention] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<{ id: string; message: string } | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setState("loading");
    try {
      const [clientsRes, statsRes] = await Promise.all([
        fetch("/api/clients/all"),
        fetch("/api/clients/stats"),
      ]);
      if (!clientsRes.ok || !statsRes.ok) {
        throw new Error("Failed to load clients");
      }
      setClients(await clientsRes.json());
      setStats(await statsRes.json());
      setState("ready");
    } catch {
      setState("error");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleAdd(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const tag = newTag.trim();
    const displayName = newDisplayName.trim() || tag;
    if (!tag || adding) {
      return;
    }
    setAdding(true);
    setAddError(null);
    try {
      const res = await fetch("/api/clients/all", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tag, displayName }),
      });
      if (res.status === 409) {
        setAddError("A client with that tag already exists.");
        return;
      }
      if (!res.ok) {
        throw new Error("Failed to add client");
      }
      setNewTag("");
      setNewDisplayName("");
      setDisplayNameTouched(false);
      await load();
    } catch {
      setAddError("Couldn't add that — try again.");
    } finally {
      setAdding(false);
    }
  }

  function startEdit(client: Client) {
    setEditingId(client.id);
    setEditTag(client.tag);
    setEditDisplayName(client.displayName);
    setEditLegalName(client.legalName ?? "");
    setEditAddressLine1(client.addressLine1 ?? "");
    setEditAddressLine2(client.addressLine2 ?? "");
    setEditAttention(client.attention ?? "");
    setRowError(null);
  }

  function cancelEdit() {
    setEditingId(null);
  }

  async function patchClient(id: string, payload: Record<string, unknown>): Promise<boolean> {
    setSavingId(id);
    setRowError(null);
    try {
      const res = await fetch(`/api/clients/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.status === 409) {
        setRowError({ id, message: "A client with that tag already exists." });
        return false;
      }
      if (!res.ok) {
        throw new Error("Failed to update client");
      }
      await load();
      return true;
    } catch {
      setRowError({ id, message: "Something went wrong — try again." });
      return false;
    } finally {
      setSavingId(null);
    }
  }

  async function saveEdit(id: string) {
    const tag = editTag.trim();
    const displayName = editDisplayName.trim();
    if (!tag || !displayName) {
      return;
    }
    const ok = await patchClient(id, {
      tag,
      displayName,
      legalName: editLegalName.trim(),
      addressLine1: editAddressLine1.trim(),
      addressLine2: editAddressLine2.trim(),
      attention: editAttention.trim(),
    });
    if (ok) {
      setEditingId(null);
    }
  }

  async function markRecognized(client: Client) {
    await patchClient(client.id, { recognized: true });
  }

  async function handleDelete(id: string) {
    setSavingId(id);
    setRowError(null);
    try {
      const res = await fetch(`/api/clients/${id}`, { method: "DELETE" });
      if (res.status === 409) {
        setRowError({ id, message: "Can't delete — this client has existing review tasks." });
        return;
      }
      if (!res.ok) {
        throw new Error("Failed to delete client");
      }
      setConfirmDeleteId(null);
      await load();
    } catch {
      setRowError({ id, message: "Something went wrong — try again." });
    } finally {
      setSavingId(null);
    }
  }

  const unrecognized = clients.filter((c) => !c.recognized);
  const recognized = clients.filter((c) => c.recognized);

  return (
    <main style={{ maxWidth: 560, margin: "0 auto", padding: 20, fontFamily: "inherit" }}>
      <a href="/" className="interactive" style={{ fontSize: 14, color: "var(--color-text-muted)", textDecoration: "none" }}>
        ← Dashboard
      </a>
      <h1 style={{ fontSize: 23, fontWeight: 800, margin: "8px 0 28px", letterSpacing: -0.3 }}>Clients</h1>

      {state === "loading" ? <p style={{ color: "var(--color-text-muted)" }}>Loading…</p> : null}
      {state === "error" ? (
        <p role="alert" style={{ color: "var(--color-danger)" }}>
          Couldn&apos;t load clients.{" "}
          <button
            type="button"
            onClick={load}
            className="interactive"
            style={{ color: "var(--color-danger)", textDecoration: "underline", background: "none", border: "none", padding: 0, font: "inherit" }}
          >
            Try again
          </button>
        </p>
      ) : null}

      {state === "ready" ? (
        <>
          {unrecognized.length > 0 ? (
            <section style={{ marginBottom: 28 }}>
              <h2 style={{ fontSize: 14, fontWeight: 700, margin: "0 0 8px", color: "var(--color-warning)", textTransform: "uppercase", letterSpacing: 0.4 }}>
                Needs attention
              </h2>
              <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
                {unrecognized.map((client) => (
                  <li
                    key={client.id}
                    style={{
                      border: "1px solid var(--color-danger-border)",
                      backgroundColor: "var(--color-danger-bg)",
                      borderRadius: 10,
                      padding: "10px 12px",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                      <div>
                        <div style={{ fontSize: 15, fontWeight: 600 }}>{client.displayName}</div>
                        <div style={{ fontSize: 13, color: "var(--color-text-muted)" }}>tag: {client.tag}</div>
                      </div>
                      <button
                        type="button"
                        onClick={() => markRecognized(client)}
                        disabled={savingId === client.id}
                        className="interactive"
                        style={{
                          backgroundColor: "var(--color-primary)",
                          color: "var(--color-primary-text)",
                          border: "none",
                          borderRadius: 8,
                          padding: "6px 10px",
                          fontSize: 13,
                          fontWeight: 600,
                          whiteSpace: "nowrap",
                        }}
                      >
                        Mark recognized
                      </button>
                    </div>
                    {rowError?.id === client.id ? (
                      <p role="alert" style={{ margin: "6px 0 0", fontSize: 13, color: "var(--color-danger)" }}>
                        {rowError.message}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <section style={{ marginBottom: 28 }}>
            <h2 style={{ fontSize: 18, fontWeight: 700, margin: "0 0 12px" }}>Overview</h2>
            {stats.length === 0 ? (
              <p style={{ color: "var(--color-text-muted)", margin: 0 }}>No clients yet.</p>
            ) : (
              <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
                {stats
                  .filter((s) => s.recognized)
                  .map((s) => (
                    <li
                      key={s.id}
                      style={{
                        border: "1px solid var(--color-border)",
                        borderRadius: 10,
                        padding: "10px 12px",
                        backgroundColor: "var(--color-surface)",
                        boxShadow: "var(--shadow-card)",
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
                        <span style={{ fontSize: 15, fontWeight: 600 }}>{s.displayName}</span>
                        <span style={{ fontSize: 12, color: "var(--color-text-muted)" }}>
                          {formatLastActivity(s.lastActivityAt)}
                        </span>
                      </div>
                      <div style={{ display: "flex", gap: 14, marginTop: 6, fontSize: 13, color: "var(--color-text-muted)" }}>
                        <span>{s.completedCount} completed</span>
                        <span>{s.activeCount} active</span>
                        <span>avg {formatTurnaround(s.avgTurnaroundHours)}</span>
                      </div>
                    </li>
                  ))}
              </ul>
            )}
          </section>

          <section>
            <h2 style={{ fontSize: 18, fontWeight: 700, margin: "0 0 12px" }}>Manage</h2>

            <form
              onSubmit={handleAdd}
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 8,
                border: "1px solid var(--color-border)",
                borderRadius: 10,
                padding: 12,
                marginBottom: 16,
                backgroundColor: "var(--color-surface)",
                boxShadow: "var(--shadow-card)",
              }}
            >
              <input
                type="text"
                value={newTag}
                onChange={(event) => {
                  setNewTag(event.target.value);
                  if (!displayNameTouched) {
                    setNewDisplayName(event.target.value);
                  }
                }}
                placeholder="Tag (matches the filename bracket, e.g. ARC)"
                disabled={adding}
                style={{ ...inputStyle, width: "100%" }}
              />
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  type="text"
                  value={newDisplayName}
                  onChange={(event) => {
                    setNewDisplayName(event.target.value);
                    setDisplayNameTouched(true);
                  }}
                  placeholder="Display name"
                  disabled={adding}
                  style={{ ...inputStyle, flex: 1 }}
                />
                <button
                  type="submit"
                  disabled={adding || newTag.trim().length === 0}
                  className="interactive"
                  style={{
                    backgroundColor: "var(--color-primary)",
                    color: "var(--color-primary-text)",
                    border: "none",
                    borderRadius: 8,
                    padding: "8px 14px",
                    fontSize: 14,
                    fontWeight: 600,
                    opacity: adding || newTag.trim().length === 0 ? 0.6 : 1,
                  }}
                >
                  Add
                </button>
              </div>
              {addError ? (
                <p role="alert" style={{ color: "var(--color-danger)", fontSize: 13, margin: 0 }}>
                  {addError}
                </p>
              ) : null}
            </form>

            {recognized.length === 0 ? (
              <p style={{ color: "var(--color-text-muted)" }}>No clients yet — add one above.</p>
            ) : (
              <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
                {recognized.map((client) => (
                  <li
                    key={client.id}
                    style={{
                      border: "1px solid var(--color-border)",
                      borderRadius: 10,
                      padding: "10px 12px",
                      backgroundColor: "var(--color-surface)",
                      boxShadow: "var(--shadow-card)",
                    }}
                  >
                    {editingId === client.id ? (
                      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        <input
                          type="text"
                          value={editTag}
                          onChange={(event) => setEditTag(event.target.value)}
                          autoFocus
                          style={{ ...inputStyle, width: "100%" }}
                        />
                        <input
                          type="text"
                          value={editDisplayName}
                          onChange={(event) => setEditDisplayName(event.target.value)}
                          style={{ ...inputStyle, width: "100%" }}
                        />
                        <input
                          type="text"
                          value={editLegalName}
                          onChange={(event) => setEditLegalName(event.target.value)}
                          placeholder="Legal company name (for invoices)"
                          style={{ ...inputStyle, width: "100%" }}
                        />
                        <input
                          type="text"
                          value={editAddressLine1}
                          onChange={(event) => setEditAddressLine1(event.target.value)}
                          placeholder="Address line 1"
                          style={{ ...inputStyle, width: "100%" }}
                        />
                        <input
                          type="text"
                          value={editAddressLine2}
                          onChange={(event) => setEditAddressLine2(event.target.value)}
                          placeholder="Address line 2"
                          style={{ ...inputStyle, width: "100%" }}
                        />
                        <input
                          type="text"
                          value={editAttention}
                          onChange={(event) => setEditAttention(event.target.value)}
                          placeholder="Attention (optional)"
                          style={{ ...inputStyle, width: "100%" }}
                        />
                        <div style={{ display: "flex", gap: 8 }}>
                          <button
                            type="button"
                            onClick={() => saveEdit(client.id)}
                            disabled={savingId === client.id || editTag.trim().length === 0 || editDisplayName.trim().length === 0}
                            className="interactive"
                            style={{
                              backgroundColor: "var(--color-primary)",
                              color: "var(--color-primary-text)",
                              border: "none",
                              borderRadius: 8,
                              padding: "8px 12px",
                              fontSize: 13,
                              fontWeight: 600,
                            }}
                          >
                            Save
                          </button>
                          <button
                            type="button"
                            onClick={cancelEdit}
                            disabled={savingId === client.id}
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
                      </div>
                    ) : (
                      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
                        <div>
                          <div style={{ fontSize: 15 }}>{client.displayName}</div>
                          <div style={{ fontSize: 13, color: "var(--color-text-muted)" }}>tag: {client.tag}</div>
                        </div>
                        <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                          <button
                            type="button"
                            onClick={() => startEdit(client)}
                            disabled={savingId === client.id}
                            className="interactive"
                            style={{
                              fontSize: 13,
                              color: "var(--color-text)",
                              background: "var(--color-surface-muted)",
                              border: "1px solid var(--color-border)",
                              borderRadius: 6,
                              padding: "4px 8px",
                            }}
                          >
                            Edit
                          </button>
                          {confirmDeleteId === client.id ? (
                            <button
                              type="button"
                              onClick={() => handleDelete(client.id)}
                              disabled={savingId === client.id}
                              className="interactive"
                              style={{
                                fontSize: 13,
                                color: "#ffffff",
                                background: "var(--color-danger)",
                                border: "1px solid var(--color-danger)",
                                borderRadius: 6,
                                padding: "4px 8px",
                              }}
                            >
                              Confirm?
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteId(client.id)}
                              disabled={savingId === client.id}
                              className="interactive"
                              style={{
                                fontSize: 13,
                                color: "var(--color-danger)",
                                background: "var(--color-surface-muted)",
                                border: "1px solid var(--color-border)",
                                borderRadius: 6,
                                padding: "4px 8px",
                              }}
                            >
                              Delete
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                    {rowError?.id === client.id ? (
                      <p role="alert" style={{ margin: "6px 0 0", fontSize: 13, color: "var(--color-danger)" }}>
                        {rowError.message}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      ) : null}
    </main>
  );
}
