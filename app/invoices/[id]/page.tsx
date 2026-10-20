"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";

interface Invoice {
  id: string;
  invoiceNumber: string;
}

type LoadState = "loading" | "ready" | "error";

/**
 * Shows one invoice's PDF embedded in the app, with an explicit "← Invoices"
 * way back out and a "Download" button — the plain `/api/invoices/[id]/pdf`
 * link this page replaced had neither: navigating straight to a raw PDF
 * response leaves no in-app back affordance, and relies on the browser's
 * own (inconsistent, especially on mobile) handling of `Content-Disposition`
 * to offer any way to save it.
 */
export default function InvoiceViewerPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;

  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [state, setState] = useState<LoadState>("loading");
  const [downloadError, setDownloadError] = useState(false);

  /**
   * iOS Safari (including installed PWAs, this app's primary target)
   * doesn't honor `Content-Disposition: attachment` the way desktop
   * browsers do — it just previews the PDF in its own built-in viewer
   * regardless, so a plain `<a download>` link never actually offers a
   * save action there (confirmed live: the previous `target="_blank"`
   * fix stopped the user from getting stuck on the PDF with no way back,
   * but the PDF it opened still had no way to save it). The Web Share
   * API sidesteps this entirely — it invokes the OS's own native share
   * sheet (iOS's real "Save to Files"/AirDrop/Messages sheet) directly
   * from a button tap, with no navigation and no dependence on how a
   * given browser chooses to render a `Content-Disposition` response.
   * Falls back to the plain anchor-link behavior (confirmed working on
   * desktop) when the Share API or file sharing isn't available.
   */
  async function handleShare() {
    if (!invoice) return;
    setDownloadError(false);
    try {
      const res = await fetch(`/api/invoices/${id}/pdf`);
      if (!res.ok) throw new Error("Failed to fetch PDF");
      const blob = await res.blob();
      const file = new File([blob], `${invoice.invoiceNumber}.pdf`, { type: "application/pdf" });

      if (typeof navigator.share === "function" && navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file] });
        return;
      }

      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${invoice.invoiceNumber}.pdf`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      // AbortError is the user dismissing the native share sheet — not a failure.
      if (error instanceof Error && error.name === "AbortError") return;
      setDownloadError(true);
    }
  }

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const res = await fetch("/api/invoices/all");
        if (!res.ok) {
          throw new Error("Failed to load invoice");
        }
        const invoices: Invoice[] = await res.json();
        const found = invoices.find((inv) => inv.id === id) ?? null;
        if (!cancelled) {
          setInvoice(found);
          setState(found ? "ready" : "error");
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
  }, [id]);

  return (
    <main style={{ maxWidth: 900, margin: "0 auto", padding: 20, fontFamily: "inherit" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 16 }}>
        <a href="/invoices" className="interactive" style={{ fontSize: 14, color: "var(--color-text-muted)", textDecoration: "none" }}>
          ← Invoices
        </a>
        {invoice ? (
          <button
            type="button"
            onClick={handleShare}
            className="interactive"
            style={{
              fontSize: 14,
              fontWeight: 600,
              color: "var(--color-primary-text)",
              background: "var(--color-primary)",
              border: "none",
              borderRadius: 8,
              padding: "8px 14px",
            }}
          >
            Download
          </button>
        ) : null}
      </div>

      {downloadError ? (
        <p role="alert" style={{ color: "var(--color-danger)", fontSize: 13, margin: "0 0 12px" }}>
          Couldn&apos;t save that — try again.
        </p>
      ) : null}

      {state === "loading" ? <p style={{ color: "var(--color-text-muted)" }}>Loading…</p> : null}
      {state === "error" ? (
        <p role="alert" style={{ color: "var(--color-danger)" }}>
          Couldn&apos;t find that invoice.
        </p>
      ) : null}

      {state === "ready" && invoice ? (
        <>
          <h1 style={{ fontSize: 20, fontWeight: 800, margin: "0 0 12px", letterSpacing: -0.3 }}>{invoice.invoiceNumber}</h1>
          <iframe
            src={`/api/invoices/${id}/pdf?mode=inline`}
            title={`Invoice ${invoice.invoiceNumber}`}
            style={{ width: "100%", height: "80vh", border: "1px solid var(--color-border)", borderRadius: 10 }}
          />
        </>
      ) : null}
    </main>
  );
}
