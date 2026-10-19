import { expect, test } from "vitest";
import { renderInvoicePdfBuffer } from "@/lib/invoices/pdf";

const SAMPLE_INVOICE = {
  invoiceNumber: "ARC2610-002",
  clientLegalName: "LOVELOTS DIAMOND PTE LTD",
  clientAddressLine1: "181 Orchard Road",
  clientAddressLine2: "#04-02, Singapore 238896",
  clientAttention: "Account Department",
  invoiceDate: new Date("2026-10-04T01:00:00Z"),
  dueDate: new Date("2026-10-10T01:00:00Z"),
  description: "*8 Content Posts",
  totalAmountCents: 160000,
} as const;

test("renders a PDF buffer starting with the PDF magic bytes", async () => {
  const buffer = await renderInvoicePdfBuffer(SAMPLE_INVOICE as never);
  expect(buffer.subarray(0, 4).toString("latin1")).toBe("%PDF");
});

test("renders without throwing when addressLine2 and description are null", async () => {
  const buffer = await renderInvoicePdfBuffer({ ...SAMPLE_INVOICE, clientAddressLine2: null, description: null } as never);
  expect(buffer.length).toBeGreaterThan(0);
});

test("renders without throwing with a long multi-line description", async () => {
  const longDescription = "A very long description line that wraps across more than one line of the PDF, ".repeat(5);
  const buffer = await renderInvoicePdfBuffer({ ...SAMPLE_INVOICE, description: longDescription } as never);
  expect(buffer.length).toBeGreaterThan(0);
});
