"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";

type SuggestionCategory = "ulti" | "arc" | "general";

interface Suggestion {
  id: string;
  category: SuggestionCategory;
  text: string;
  active: boolean;
}

type LoadState = "loading" | "ready" | "error";

const CATEGORY_LABELS: Record<SuggestionCategory, string> = {
  ulti: "Ulti",
  arc: "Arc",
  general: "General",
};
const CATEGORY_ORDER: SuggestionCategory[] = ["ulti", "arc", "general"];

function groupByCategory(suggestions: Suggestion[]): Array<{ category: SuggestionCategory; items: Suggestion[] }> {
  return CATEGORY_ORDER.map((category) => ({
    category,
    items: suggestions.filter((suggestion) => suggestion.category === category),
  })).filter((group) => group.items.length > 0);
}

const inputStyle = {
  padding: "8px 10px",
  fontSize: 14,
  borderRadius: 8,
  border: "1px solid var(--color-border)",
  backgroundColor: "var(--color-surface)",
  color: "var(--color-text)",
};

export default function SuggestionsPage() {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [state, setState] = useState<LoadState>("loading");

  const [newText, setNewText] = useState("");
  const [newCategory, setNewCategory] = useState<SuggestionCategory>("general");
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [editCategory, setEditCategory] = useState<SuggestionCategory>("general");
  const [savingId, setSavingId] = useState<string | null>(null);
  const [rowErrorId, setRowErrorId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setState("loading");
    try {
      const res = await fetch("/api/suggestions/all");
      if (!res.ok) {
        throw new Error("Failed to load suggestions");
      }
      const data: Suggestion[] = await res.json();
      setSuggestions(data);
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
    const trimmed = newText.trim();
    if (!trimmed || adding) {
      return;
    }
    setAdding(true);
    setAddError(null);
    try {
      const res = await fetch("/api/suggestions/all", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category: newCategory, text: trimmed }),
      });
      if (res.status === 409) {
        setAddError("A suggestion with that exact text already exists.");
        return;
      }
      if (!res.ok) {
        throw new Error("Failed to add suggestion");
      }
      const created: Suggestion = await res.json();
      setSuggestions((prev) => [...prev, created]);
      setNewText("");
    } catch {
      setAddError("Couldn't add that — try again.");
    } finally {
      setAdding(false);
    }
  }

  function startEdit(suggestion: Suggestion) {
    setEditingId(suggestion.id);
    setEditText(suggestion.text);
    setEditCategory(suggestion.category);
    setRowErrorId(null);
  }

  function cancelEdit() {
    setEditingId(null);
  }

  async function saveEdit(id: string) {
    const trimmed = editText.trim();
    if (!trimmed) {
      return;
    }
    setSavingId(id);
    setRowErrorId(null);
    try {
      const res = await fetch(`/api/suggestions/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: trimmed, category: editCategory }),
      });
      if (!res.ok) {
        throw new Error("Failed to save suggestion");
      }
      const updated: Suggestion = await res.json();
      setSuggestions((prev) => prev.map((s) => (s.id === id ? updated : s)));
      setEditingId(null);
    } catch {
      setRowErrorId(id);
    } finally {
      setSavingId(null);
    }
  }

  async function toggleActive(suggestion: Suggestion) {
    setSavingId(suggestion.id);
    setRowErrorId(null);
    try {
      const res = await fetch(`/api/suggestions/${suggestion.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: !suggestion.active }),
      });
      if (!res.ok) {
        throw new Error("Failed to update suggestion");
      }
      const updated: Suggestion = await res.json();
      setSuggestions((prev) => prev.map((s) => (s.id === suggestion.id ? updated : s)));
    } catch {
      setRowErrorId(suggestion.id);
    } finally {
      setSavingId(null);
    }
  }

  async function handleDelete(id: string) {
    setSavingId(id);
    setRowErrorId(null);
    try {
      const res = await fetch(`/api/suggestions/${id}`, { method: "DELETE" });
      if (!res.ok) {
        throw new Error("Failed to delete suggestion");
      }
      setSuggestions((prev) => prev.filter((s) => s.id !== id));
      setConfirmDeleteId(null);
    } catch {
      setRowErrorId(id);
    } finally {
      setSavingId(null);
    }
  }

  const groups = groupByCategory(suggestions);

  return (
    <main style={{ maxWidth: 560, margin: "0 auto", padding: 20, fontFamily: "inherit" }}>
      <a href="/" className="interactive" style={{ fontSize: 14, color: "var(--color-text-muted)", textDecoration: "none" }}>
        ← Dashboard
      </a>
      <h1 style={{ fontSize: 23, fontWeight: 800, margin: "8px 0 28px", letterSpacing: -0.3 }}>Suggestions</h1>

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
        <input
          type="text"
          value={newText}
          onChange={(event) => setNewText(event.target.value)}
          placeholder="New growth idea…"
          disabled={adding}
          style={{ ...inputStyle, width: "100%" }}
        />
        <div style={{ display: "flex", gap: 8 }}>
          <select
            value={newCategory}
            onChange={(event) => setNewCategory(event.target.value as SuggestionCategory)}
            disabled={adding}
            style={{ ...inputStyle, flex: 1 }}
          >
            {CATEGORY_ORDER.map((category) => (
              <option key={category} value={category}>
                {CATEGORY_LABELS[category]}
              </option>
            ))}
          </select>
          <button
            type="submit"
            disabled={adding || newText.trim().length === 0}
            className="interactive"
            style={{
              backgroundColor: "var(--color-primary)",
              color: "var(--color-primary-text)",
              border: "none",
              borderRadius: 8,
              padding: "8px 14px",
              fontSize: 14,
              fontWeight: 600,
              opacity: adding || newText.trim().length === 0 ? 0.6 : 1,
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
          Couldn&apos;t load suggestions.{" "}
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
        <p style={{ color: "var(--color-text-muted)" }}>No suggestions yet — add one above.</p>
      ) : null}

      {state === "ready" && groups.length > 0 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          {groups.map((group) => (
            <section key={group.category}>
              <h2 style={{ fontSize: 14, fontWeight: 700, margin: "0 0 8px", color: "var(--color-text-muted)", textTransform: "uppercase", letterSpacing: 0.4 }}>
                {CATEGORY_LABELS[group.category]}
              </h2>
              <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
                {group.items.map((suggestion) => (
                  <li
                    key={suggestion.id}
                    style={{
                      border: "1px solid var(--color-border)",
                      borderRadius: 10,
                      padding: "10px 12px",
                      backgroundColor: suggestion.active ? "var(--color-surface)" : "var(--color-surface-muted)",
                      boxShadow: suggestion.active ? "var(--shadow-card)" : "none",
                      opacity: suggestion.active ? 1 : 0.65,
                    }}
                  >
                    {editingId === suggestion.id ? (
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
                            value={editCategory}
                            onChange={(event) => setEditCategory(event.target.value as SuggestionCategory)}
                            style={{ ...inputStyle, flex: 1 }}
                          >
                            {CATEGORY_ORDER.map((category) => (
                              <option key={category} value={category}>
                                {CATEGORY_LABELS[category]}
                              </option>
                            ))}
                          </select>
                          <button
                            type="button"
                            onClick={() => saveEdit(suggestion.id)}
                            disabled={savingId === suggestion.id || editText.trim().length === 0}
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
                            disabled={savingId === suggestion.id}
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
                        <span style={{ fontSize: 15 }}>{suggestion.text}</span>
                        <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                          <button
                            type="button"
                            onClick={() => toggleActive(suggestion)}
                            disabled={savingId === suggestion.id}
                            title={suggestion.active ? "Deactivate" : "Activate"}
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
                            {suggestion.active ? "On" : "Off"}
                          </button>
                          <button
                            type="button"
                            onClick={() => startEdit(suggestion)}
                            disabled={savingId === suggestion.id}
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
                          {confirmDeleteId === suggestion.id ? (
                            <button
                              type="button"
                              onClick={() => handleDelete(suggestion.id)}
                              disabled={savingId === suggestion.id}
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
                              onClick={() => setConfirmDeleteId(suggestion.id)}
                              disabled={savingId === suggestion.id}
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
                    {rowErrorId === suggestion.id ? (
                      <p role="alert" style={{ margin: "6px 0 0", fontSize: 13, color: "var(--color-danger)" }}>
                        Something went wrong — try again.
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
