const SGT_TIME_ZONE = "Asia/Singapore";

const sgtFieldsFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: SGT_TIME_ZONE,
  year: "numeric",
  month: "numeric",
  day: "numeric",
  weekday: "long",
});

interface SgtFields {
  year: string;
  month: number;
  day: number;
  weekday: string;
}

/** The calendar fields `date` falls on in Singapore time (not the server's local timezone). */
function sgtFields(date: Date): SgtFields {
  const parts = sgtFieldsFormatter.formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? "";
  return {
    year: get("year"),
    month: Number(get("month")),
    day: Number(get("day")),
    weekday: get("weekday"),
  };
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** The "YYYY-MM" calendar month `date` falls on in Singapore time. */
export function sgtYearMonthKey(date: Date): string {
  const { year, month } = sgtFields(date);
  return `${year}-${String(month).padStart(2, "0")}`;
}

/** "ARC" + 2-digit year + 2-digit month + "-" + 3-digit sequence, e.g. "ARC2610-002". */
export function formatInvoiceNumber(invoiceDate: Date, sequence: number): string {
  const [year, month] = sgtYearMonthKey(invoiceDate).split("-");
  return `ARC${year.slice(2)}${month}-${String(sequence).padStart(3, "0")}`;
}

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

/** Exactly 7 days after the invoice date. */
export function computeDueDate(invoiceDate: Date): Date {
  return new Date(invoiceDate.getTime() + SEVEN_DAYS_MS);
}

/** Full month name and 4-digit year, e.g. "October 2026". */
export function formatServiceMonthLabel(invoiceDate: Date): string {
  const { year, month } = sgtFields(invoiceDate);
  return `${MONTH_NAMES[month - 1]} ${year}`;
}

/** "D/M/YY" with no leading zeros on day or month, e.g. "4/10/26". */
export function formatInvoiceDateShort(date: Date): string {
  const { year, month, day } = sgtFields(date);
  return `${day}/${month}/${year.slice(-2)}`;
}

/** "Weekday, D Month YYYY", e.g. "Saturday, 10 October 2026". */
export function formatDueDateLong(date: Date): string {
  const { year, month, day, weekday } = sgtFields(date);
  return `${weekday}, ${day} ${MONTH_NAMES[month - 1]} ${year}`;
}

const sgdFormatter = new Intl.NumberFormat("en-SG", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Comma-grouped with 2 decimals and no currency symbol, e.g. 160000 -> "1,600.00". */
export function formatAmountSgd(amountCents: number): string {
  return sgdFormatter.format(amountCents / 100);
}
