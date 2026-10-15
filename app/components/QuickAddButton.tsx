"use client";

import { useRef, useState, type FormEvent } from "react";

interface QuickAddButtonProps {
  onAdd: (title: string, dueAt: Date | null) => Promise<void>;
}

/**
 * Fast-path for adding a loose to-do: a single tap opens an auto-focused
 * text input (per the design doc's "minimal taps" goal), submitting posts
 * the to-do and immediately clears + refocuses the input so another one can
 * be added right away without re-tapping. Closing (the X) is the only way
 * back to the plain button state.
 */
export default function QuickAddButton({ onAdd }: QuickAddButtonProps) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  // Optional — left blank for the common case (per the "minimal taps"
  // goal), only sent if the user actually picks a date/time.
  const [dueAt, setDueAt] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  function openInput() {
    setOpen(true);
    setError(null);
  }

  function closeInput() {
    setOpen(false);
    setTitle("");
    setDueAt("");
    setError(null);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = title.trim();
    if (!trimmed || submitting) {
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const parsedDueAt = dueAt ? new Date(dueAt) : null;
      await onAdd(trimmed, parsedDueAt && !Number.isNaN(parsedDueAt.getTime()) ? parsedDueAt : null);
      setTitle("");
      setDueAt("");
      inputRef.current?.focus();
    } catch {
      setError("Couldn't add that — try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={openInput}
        className="interactive"
        style={{
          backgroundColor: "var(--color-primary)",
          color: "var(--color-primary-text)",
          border: "none",
          borderRadius: 8,
          padding: "10px 14px",
          fontSize: 14,
          fontWeight: 600,
          width: "100%",
        }}
      >
        + Add to-do
      </button>
    );
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", gap: 8 }}>
        <input
          ref={inputRef}
          autoFocus
          type="text"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="What needs doing?"
          disabled={submitting}
          style={{
            flex: 1,
            padding: "10px 12px",
            fontSize: 14,
            borderRadius: 8,
            border: "1px solid var(--color-border)",
            backgroundColor: "var(--color-surface)",
            color: "var(--color-text)",
          }}
        />
        <button
          type="submit"
          disabled={submitting || title.trim().length === 0}
          className="interactive"
          style={{
            backgroundColor: "var(--color-primary)",
            color: "var(--color-primary-text)",
            border: "none",
            borderRadius: 8,
            padding: "10px 14px",
            fontSize: 14,
            fontWeight: 600,
            opacity: submitting || title.trim().length === 0 ? 0.6 : 1,
          }}
        >
          Add
        </button>
        <button
          type="button"
          onClick={closeInput}
          aria-label="Cancel"
          className="interactive"
          style={{
            backgroundColor: "var(--color-surface-muted)",
            color: "var(--color-text)",
            border: "1px solid var(--color-border)",
            borderRadius: 8,
            padding: "10px 12px",
            fontSize: 14,
          }}
        >
          Done
        </button>
      </div>
      <input
        type="datetime-local"
        value={dueAt}
        onChange={(event) => setDueAt(event.target.value)}
        disabled={submitting}
        aria-label="Due date (optional)"
        style={{
          padding: "8px 10px",
          fontSize: 13,
          borderRadius: 8,
          border: "1px solid var(--color-border)",
          backgroundColor: "var(--color-surface)",
          color: dueAt ? "var(--color-text)" : "var(--color-text-subtle)",
          width: "100%",
        }}
      />
      {error ? (
        <p role="alert" style={{ color: "var(--color-danger)", fontSize: 13, margin: 0 }}>
          {error}
        </p>
      ) : null}
    </form>
  );
}
