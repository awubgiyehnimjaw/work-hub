"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { formatInvoiceDateShort } from "@/lib/invoices/format";

interface Client {
  id: string;
  displayName: string;
  recognized: boolean;
  legalName: string | null;
  addressLine1: string | null;
}

interface Invoice {
  id: string;
  invoiceNumber: string;
  clientId: string;
  clientDisplayName: string | null;
  invoiceDate: string;
  dueDate: string;
  description: string | null;
  totalAmountCents: number;
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

/** Dollars-and-cents display for a totalAmountCents value, e.g. 160000 -> "$1600.00". */
function formatDollars(totalAmountCents: number): string {
  return `$${(totalAmountCents / 100).toFixed(2)}`;
}

export default function InvoicesPage() {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [state, setState] = useState<LoadState>("loading");

  const [newClientId, setNewClientId] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newAmount, setNewAmount] = useState("");
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setState("loading");
    try {
      const [clientsRes, invoicesRes] = await Promise.all([
        fetch("/api/clients/all"),
        fetch("/api/invoices/all"),
      ]);
      if (!clientsRes.ok || !invoicesRes.ok) {
        throw new Error("Failed to load invoices");
      }
      const clientsData: Client[] = await clientsRes.json();
      const invoicesData: Invoice[] = await invoicesRes.json();
      setClients(clientsData);
      setInvoices(invoicesData);
      setState("ready");
    } catch {
      setState("error");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const eligibleClients = clients.filter((c) => c.legalName && c.addressLine1);

  async function handleAdd(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const amount = parseFloat(newAmount);
    if (!newClientId || !newAmount || Number.isNaN(amount) || amount <= 0 || adding) {
      return;
    }
    setAdding(true);
    setAddError(null);
    try {
      const res = await fetch("/api/invoices/all", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: newClientId,
          description: newDescription.trim() || undefined,
          totalAmountCents: Math.round(amount * 100),
        }),
      });
      if (!res.ok) {
        throw new Error("Failed to create invoice");
      }
      const created: Invoice = await res.json();
      window.open(`/invoices/${created.id}`, "_blank");
      setNewClientId("");
      setNewDescription("");
      setNewAmount("");
      await load();
    } catch {
      setAddError("Couldn't generate that invoice — try again.");
    } finally {
      setAdding(false);
    }
  }

  return (
    <main style={{ maxWidth: 560, margin: "0 auto", padding: 20, fontFamily: "inherit" }}>
      <a href="/" className="interactive" style={{ fontSize: 14, color: "var(--color-text-muted)", textDecoration: "none" }}>
        ← Dashboard
      </a>
      <h1 style={{ fontSize: 23, fontWeight: 800, margin: "8px 0 28px", letterSpacing: -0.3 }}>Invoices</h1>

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
          {eligibleClients.map((client) => (
            <option key={client.id} value={client.id}>
              {client.displayName}
            </option>
          ))}
        </select>
        <textarea
          value={newDescription}
          onChange={(event) => setNewDescription(event.target.value)}
          placeholder="Description (optional)"
          disabled={adding}
          style={{ ...inputStyle, width: "100%", minHeight: 60, resize: "vertical" }}
        />
        <div style={{ display: "flex", gap: 8 }}>
          <input
            type="number"
            step="0.01"
            value={newAmount}
            onChange={(event) => setNewAmount(event.target.value)}
            placeholder="Total amount (SGD)"
            disabled={adding}
            style={{ ...inputStyle, flex: 1 }}
          />
          <button
            type="submit"
            disabled={adding || !newClientId || !newAmount}
            className="interactive"
            style={{
              backgroundColor: "var(--color-primary)",
              color: "var(--color-primary-text)",
              border: "none",
              borderRadius: 8,
              padding: "8px 14px",
              fontSize: 14,
              fontWeight: 600,
              opacity: adding || !newClientId || !newAmount ? 0.6 : 1,
            }}
          >
            Generate
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
          Couldn&apos;t load invoices.{" "}
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

      {state === "ready" && invoices.length === 0 ? (
        <p style={{ color: "var(--color-text-muted)" }}>No invoices yet — generate one above.</p>
      ) : null}

      {state === "ready" && invoices.length > 0 ? (
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
          {invoices.map((invoice) => (
            <li
              key={invoice.id}
              style={{
                border: "1px solid var(--color-border)",
                borderRadius: 10,
                padding: "10px 12px",
                backgroundColor: "var(--color-surface)",
                boxShadow: "var(--shadow-card)",
              }}
            >
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 600 }}>{invoice.invoiceNumber}</div>
                  <div style={{ fontSize: 13, color: "var(--color-text-muted)" }}>
                    {invoice.clientDisplayName ?? "Unknown client"} · {formatInvoiceDateShort(new Date(invoice.invoiceDate))} · {formatDollars(invoice.totalAmountCents)}
                  </div>
                </div>
                <a
                  href={`/invoices/${invoice.id}`}
                  className="interactive"
                  style={{
                    fontSize: 13,
                    color: "var(--color-text)",
                    background: "var(--color-surface-muted)",
                    border: "1px solid var(--color-border)",
                    borderRadius: 6,
                    padding: "4px 8px",
                    textDecoration: "none",
                    whiteSpace: "nowrap",
                  }}
                >
                  View
                </a>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </main>
  );
}
