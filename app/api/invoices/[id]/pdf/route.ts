import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { invoices } from "@/lib/db/schema";
import { renderInvoicePdfBuffer } from "@/lib/invoices/pdf";

/**
 * Streams a single invoice back as a PDF, named after its invoice number.
 * Defaults to `Content-Disposition: attachment` (forces a save) — the
 * behavior every existing caller relies on. `?mode=inline` switches to
 * `Content-Disposition: inline`, which the Invoices detail page's
 * embedded `<iframe>` needs to actually render the PDF in place instead
 * of triggering a download inside the frame.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const [invoice] = await db.select().from(invoices).where(eq(invoices.id, id));
  if (!invoice) {
    return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
  }

  const pdf = await renderInvoicePdfBuffer(invoice);
  const inline = new URL(request.url).searchParams.get("mode") === "inline";

  return new Response(new Uint8Array(pdf), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${invoice.invoiceNumber}.pdf"`,
    },
  });
}
