import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { invoices } from "@/lib/db/schema";
import { renderInvoicePdfBuffer } from "@/lib/invoices/pdf";

/** Streams a single invoice back as a downloadable PDF, named after its invoice number. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const [invoice] = await db.select().from(invoices).where(eq(invoices.id, id));
  if (!invoice) {
    return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
  }

  const pdf = await renderInvoicePdfBuffer(invoice);

  return new Response(new Uint8Array(pdf), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${invoice.invoiceNumber}.pdf"`,
    },
  });
}
