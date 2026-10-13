"use client";

import { useRef, useState, type FormEvent } from "react";

interface QuickAddButtonProps {
  onAdd: (title: string) => Promise<void>;
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
      await onAdd(trimmed);
      setTitle("");
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
        style={{
          backgroundColor: "#111827",
          color: "#ffffff",
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
            border: "1px solid #d1d5db",
          }}
        />
        <button
          type="submit"
          disabled={submitting || title.trim().length === 0}
          style={{
            backgroundColor: "#111827",
            color: "#ffffff",
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
          style={{
            backgroundColor: "#f3f4f6",
            color: "#111827",
            border: "1px solid #d1d5db",
            borderRadius: 8,
            padding: "10px 12px",
            fontSize: 14,
          }}
        >
          Done
        </button>
      </div>
      {error ? (
        <p role="alert" style={{ color: "#b42318", fontSize: 13, margin: 0 }}>
          {error}
        </p>
      ) : null}
    </form>
  );
}
