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
    <main>
      <h1>Work Hub</h1>
      <form onSubmit={handleSubmit}>
        <label htmlFor="passcode">Passcode</label>
        <input
          id="passcode"
          name="passcode"
          type="password"
          autoFocus
          autoComplete="off"
          value={passcode}
          onChange={(event) => setPasscode(event.target.value)}
        />
        <button type="submit" disabled={submitting}>
          {submitting ? "Checking..." : "Log in"}
        </button>
      </form>
      {error ? <p role="alert">{error}</p> : null}
    </main>
  );
}
