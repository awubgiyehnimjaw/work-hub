"use client";

import { useEffect, useState } from "react";

interface Suggestion {
  text: string;
  source: "seed" | "client-quiet";
  clientId?: string;
}

type LoadState = "loading" | "ready" | "error";

/**
 * Always mounted alongside the review queue and to-do list, regardless of
 * whether either has items — fetches and shows whatever
 * `GET /api/suggestions` picks the moment it's mounted.
 */
export default function SuggestionCard() {
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);
  const [state, setState] = useState<LoadState>("loading");

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const res = await fetch("/api/suggestions");
        if (!res.ok) {
          throw new Error("Failed to load suggestion");
        }
        const data: Suggestion = await res.json();
        if (!cancelled) {
          setSuggestion(data);
          setState("ready");
        }
      } catch {
        if (!cancelled) {
          setState("error");
        }
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  if (state === "loading") {
    return null;
  }

  return (
    <section
      style={{
        border: "1px solid var(--color-accent-border)",
        backgroundColor: "var(--color-accent-bg)",
        borderRadius: 10,
        padding: 16,
        boxShadow: "var(--shadow-card)",
      }}
    >
      <h2 style={{ fontSize: 14, fontWeight: 700, margin: "0 0 8px", color: "var(--color-accent-text)" }}>
        {state === "error" ? "Growth idea" : "Also worth doing"}
      </h2>
      {state === "error" ? (
        <p role="alert" style={{ margin: 0, color: "var(--color-danger)" }}>
          Couldn&apos;t load a suggestion right now.
        </p>
      ) : (
        <p style={{ margin: 0, fontSize: 15 }}>{suggestion?.text}</p>
      )}
    </section>
  );
}
