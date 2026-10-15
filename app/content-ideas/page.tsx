"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";

interface Idea {
  id: string;
  clientId: string;
  text: string;
  createdAt: string;
  clientName: string | null;
}

interface Client {
  id: string;
  displayName: string;
  recognized: boolean;
}

interface IdeaGroup {
  clientId: string;
  clientName: string;
  ideas: Idea[];
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

/**
 * Groups ideas by client, newest-first within each group, groups
 * themselves alphabetical by client name — same shape as
 * app/history/page.tsx's groupByClient, simplified since every idea
 * always has a client (unlike a review task, which can be unrecognized).
 */
function groupByClient(ideas: Idea[]): IdeaGroup[] {
  const groups = new Map<string, IdeaGroup>();

  for (const idea of ideas) {
    const existing = groups.get(idea.clientId);
    if (existing) {
      existing.ideas.push(idea);
    } else {
      groups.set(idea.clientId, {
        clientId: idea.clientId,
        clientName: idea.clientName ?? "Unknown client",
        ideas: [idea],
      });
    }
  }

  const result = Array.from(groups.values());
  for (const group of result) {
    group.ideas.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }
  result.sort((a, b) => a.clientName.localeCompare(b.clientName));
  return result;
}

export default function ContentIdeasPage() {
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [state, setState] = useState<LoadState>("loading");

  const [newClientId, setNewClientId] = useState("");
  const [newText, setNewText] = useState("");
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editClientId, setEditClientId] = useState("");
  const [editText, setEditText] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<{ id: string; message: string } | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setState("loading");
    try {
      const [ideasRes, clientsRes] = await Promise.all([
        fetch("/api/content-ideas/all"),
        fetch("/api/clients/all"),
      ]);
      if (!ideasRes.ok || !clientsRes.ok) {
        throw new Error("Failed to load content ideas");
      }
      const ideasData: Idea[] = await ideasRes.json();
      const clientsData: Client[] = await clientsRes.json();
      setIdeas(ideasData);
      setClients(clientsData);
      setState("ready");
    } catch {
      setState("error");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const recognizedClients = clients.filter((c) => c.recognized);

  async function handleAdd(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = newText.trim();
    if (!newClientId || !text || adding) {
      return;
    }
    setAdding(true);
    setAddError(null);
    try {
      const res = await fetch("/api/content-ideas/all", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId: newClientId, text }),
      });
      if (!res.ok) {
        throw new Error("Failed to add content idea");
      }
      setNewText("");
      await load();
    } catch {
      setAddError("Couldn't add that — try again.");
    } finally {
      setAdding(false);
    }
  }

  function startEdit(idea: Idea) {
    setEditingId(idea.id);
    setEditClientId(idea.clientId);
    setEditText(idea.text);
    setRowError(null);
  }

  function cancelEdit() {
    setEditingId(null);
  }

  async function saveEdit(id: string) {
    const text = editText.trim();
    if (!text || !editClientId) {
      return;
    }
    setSavingId(id);
    setRowError(null);
    try {
      const res = await fetch(`/api/content-ideas/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, clientId: editClientId }),
      });
      if (!res.ok) {
        throw new Error("Failed to save content idea");
      }
      setEditingId(null);
      await load();
    } catch {
      setRowError({ id, message: "Something went wrong — try again." });
    } finally {
      setSavingId(null);
    }
  }

  async function handleDelete(id: string) {
    setSavingId(id);
    setRowError(null);
    try {
      const res = await fetch(`/api/content-ideas/${id}`, { method: "DELETE" });
      if (!res.ok) {
        throw new Error("Failed to delete content idea");
      }
      setConfirmDeleteId(null);
      await load();
    } catch {
      setRowError({ id, message: "Something went wrong — try again." });
    } finally {
      setSavingId(null);
    }
  }

  const groups = groupByClient(ideas);

  return (
    <main style={{ maxWidth: 560, margin: "0 auto", padding: 20, fontFamily: "inherit" }}>
      <a href="/" className="interactive" style={{ fontSize: 14, color: "var(--color-text-muted)", textDecoration: "none" }}>
        ← Dashboard
      </a>
      <h1 style={{ fontSize: 23, fontWeight: 800, margin: "8px 0 28px", letterSpacing: -0.3 }}>Content Ideas</h1>

      <form
        onSubmit={handleAdd}
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 8,
          border: "1px solid var(--color-border)",
          borderRadius: 10,
          padding: 12,
          marginBottom: 24,
          backgroundColor: "var(--color-surface)",
          boxShadow: "var(--shadow-card)",
        }}
      >
        <select
          value={newClientId}
          onChange={(event) => setNewClientId(event.target.value)}
          disabled={adding}
          style={{ ...inputStyle, width: "100%" }}
        >
          <option value="">Select a client…</option>
          {recognizedClients.map((client) => (
            <option key={client.id} value={client.id}>
              {client.displayName}
            </option>
          ))}
        </select>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            type="text"
            value={newText}
            onChange={(event) => setNewText(event.target.value)}
            placeholder="New content idea…"
            disabled={adding}
            style={{ ...inputStyle, flex: 1 }}
          />
          <button
            type="submit"
            disabled={adding || !newClientId || newText.trim().length === 0}
            className="interactive"
            style={{
              backgroundColor: "var(--color-primary)",
              color: "var(--color-primary-text)",
              border: "none",
              borderRadius: 8,
              padding: "8px 14px",
              fontSize: 14,
              fontWeight: 600,
              opacity: adding || !newClientId || newText.trim().length === 0 ? 0.6 : 1,
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

      {state === "loading" ? <p style={{ color: "var(--color-text-muted)" }}>Loading…</p> : null}
      {state === "error" ? (
        <p role="alert" style={{ color: "var(--color-danger)" }}>
          Couldn&apos;t load content ideas.{" "}
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

      {state === "ready" && groups.length === 0 ? (
        <p style={{ color: "var(--color-text-muted)" }}>No content ideas yet — add one above.</p>
      ) : null}

      {state === "ready" && groups.length > 0 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          {groups.map((group) => (
            <section key={group.clientId}>
              <h2 style={{ fontSize: 18, fontWeight: 700, margin: "0 0 12px" }}>
                {group.clientName}{" "}
                <span style={{ fontSize: 13, fontWeight: 500, color: "var(--color-text-muted)" }}>
                  ({group.ideas.length})
                </span>
              </h2>
              <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
                {group.ideas.map((idea) => (
                  <li
                    key={idea.id}
                    style={{
                      border: "1px solid var(--color-border)",
                      borderRadius: 10,
                      padding: "10px 12px",
                      backgroundColor: "var(--color-surface)",
                      boxShadow: "var(--shadow-card)",
                    }}
                  >
                    {editingId === idea.id ? (
                      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        <input
                          type="text"
                          value={editText}
                          onChange={(event) => setEditText(event.target.value)}
                          autoFocus
                          style={{ ...inputStyle, width: "100%" }}
                        />
                        <div style={{ display: "flex", gap: 8 }}>
                          <select
                            value={editClientId}
                            onChange={(event) => setEditClientId(event.target.value)}
                            style={{ ...inputStyle, flex: 1 }}
                          >
                            {recognizedClients.map((client) => (
                              <option key={client.id} value={client.id}>
                                {client.displayName}
                              </option>
                            ))}
                          </select>
                          <button
                            type="button"
                            onClick={() => saveEdit(idea.id)}
                            disabled={savingId === idea.id || editText.trim().length === 0}
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
                            disabled={savingId === idea.id}
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
                        <span style={{ fontSize: 15 }}>{idea.text}</span>
                        <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                          <button
                            type="button"
                            onClick={() => startEdit(idea)}
                            disabled={savingId === idea.id}
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
                          {confirmDeleteId === idea.id ? (
                            <button
                              type="button"
                              onClick={() => handleDelete(idea.id)}
                              disabled={savingId === idea.id}
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
                              onClick={() => setConfirmDeleteId(idea.id)}
                              disabled={savingId === idea.id}
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
                    {rowError?.id === idea.id ? (
                      <p role="alert" style={{ margin: "6px 0 0", fontSize: 13, color: "var(--color-danger)" }}>
                        {rowError.message}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      ) : null}
    </main>
  );
}
