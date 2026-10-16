"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

export default function LoginPage() {
  const router = useRouter();
  const [passcode, setPasscode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ passcode }),
      });

      if (!res.ok) {
        setError("Incorrect passcode");
        return;
      }

      router.push("/");
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 360,
          backgroundColor: "var(--color-surface)",
          border: "1px solid var(--color-border)",
          borderRadius: 14,
          padding: 28,
          boxShadow: "var(--shadow-card-hover)",
        }}
      >
        <h1 style={{ fontSize: 22, fontWeight: 800, margin: "0 0 4px", letterSpacing: -0.3, textAlign: "center" }}>
          ARC Hub
        </h1>
        <p style={{ fontSize: 14, color: "var(--color-text-muted)", margin: "0 0 24px", textAlign: "center" }}>
          Enter your passcode to continue
        </p>
        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div>
            <label htmlFor="passcode" style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
              Passcode
            </label>
            <input
              id="passcode"
              name="passcode"
              type="password"
              autoFocus
              autoComplete="off"
              value={passcode}
              onChange={(event) => setPasscode(event.target.value)}
              style={{
                width: "100%",
                padding: "10px 12px",
                fontSize: 15,
                borderRadius: 8,
                border: "1px solid var(--color-border)",
                backgroundColor: "var(--color-surface)",
                color: "var(--color-text)",
              }}
            />
          </div>
          <button
            type="submit"
            disabled={submitting || passcode.length === 0}
            className="interactive"
            style={{
              backgroundColor: "var(--color-primary)",
              color: "var(--color-primary-text)",
              border: "none",
              borderRadius: 8,
              padding: "10px 14px",
              fontSize: 15,
              fontWeight: 600,
              opacity: submitting || passcode.length === 0 ? 0.6 : 1,
            }}
          >
            {submitting ? "Checking…" : "Log in"}
          </button>
          {error ? (
            <p role="alert" style={{ color: "var(--color-danger)", fontSize: 13, margin: 0, textAlign: "center" }}>
              {error}
            </p>
          ) : null}
        </form>
      </div>
    </main>
  );
}
