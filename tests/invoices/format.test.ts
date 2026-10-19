import { expect, test } from "vitest";
import {
  computeDueDate, formatAmountSgd, formatDueDateLong, formatInvoiceDateShort,
  formatInvoiceNumber, formatServiceMonthLabel, sgtYearMonthKey,
} from "@/lib/invoices/format";

test("sgtYearMonthKey formats a date as YYYY-MM in Singapore time", () => {
  expect(sgtYearMonthKey(new Date("2026-10-04T01:00:00Z"))).toBe("2026-10"); // 09:00 SGT
});

test("formatInvoiceNumber matches the real ARC2610-002 sample", () => {
  expect(formatInvoiceNumber(new Date("2026-10-04T01:00:00Z"), 2)).toBe("ARC2610-002");
});

test("formatInvoiceNumber zero-pads the sequence to 3 digits", () => {
  expect(formatInvoiceNumber(new Date("2026-01-01T01:00:00Z"), 1)).toBe("ARC2601-001");
});

test("computeDueDate adds exactly 7 days", () => {
  const due = computeDueDate(new Date("2026-10-04T01:00:00Z"));
  expect(due).toEqual(new Date("2026-10-11T01:00:00Z"));
});

test("formatServiceMonthLabel matches the sample's 'October 2026'", () => {
  expect(formatServiceMonthLabel(new Date("2026-10-04T01:00:00Z"))).toBe("October 2026");
});

test("formatInvoiceDateShort matches the sample's '4/10/26'", () => {
  expect(formatInvoiceDateShort(new Date("2026-10-04T01:00:00Z"))).toBe("4/10/26");
});

test("formatDueDateLong matches the sample's 'Saturday, 10 October 2026'", () => {
  expect(formatDueDateLong(new Date("2026-10-10T01:00:00Z"))).toBe("Saturday, 10 October 2026");
});

test("formatAmountSgd matches the sample's '1,600.00'", () => {
  expect(formatAmountSgd(160000)).toBe("1,600.00");
});

test("formatAmountSgd formats a smaller amount without a thousands separator", () => {
  expect(formatAmountSgd(100000)).toBe("1,000.00");
});
