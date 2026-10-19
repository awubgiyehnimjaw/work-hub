# Invoice Generator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an "Invoices" section to ARC Hub that generates a client-ready PDF invoice (styled identically to ARC Social's real template) from a short in-app form, auto-assigns the correct monthly invoice number, and keeps every generated invoice browsable and re-downloadable.

**Architecture:** Two new nullable billing columns on `clients` plus a new `invoices` table (which snapshots the client's billing details at generation time, so a later address edit never rewrites a past invoice). A pure formatting module computes the invoice number, due date, and display strings; a `createInvoice` helper does the DB work (shared by the real `POST` route and the one-time October backfill script, mirroring this codebase's existing `createTodo` extraction); `@react-pdf/renderer` renders the actual PDF, regenerated on demand from the stored row rather than stored as a file.

**Tech Stack:** Next.js App Router route handlers, Drizzle/Neon, `@react-pdf/renderer` (new dependency), the existing CRUD route-pair and page/nav conventions.

**Spec:** `docs/superpowers/specs/2026-10-19-invoice-generator-design.md`

## Global Constraints

- Deploys on Vercel serverless functions — no headless-browser PDF rendering; the PDF library must be pure JS (`@react-pdf/renderer`).
- Single-user app — no new auth/permissions model.
- SGD only, "No Tax" always, no GST handling.
- Invoices are immutable once created — no edit/delete route.
- Invoice number format: `ARC<YY><MM>-<NNN>`, 3-digit sequence, resets every month.
- Due date = invoice date + 7 days, always auto-computed.
- All date/month reasoning uses `Asia/Singapore`, matching the rest of the codebase (`sgtDateKey` in `lib/posting-schedule/sheet.ts`, `lib/reminders/check.ts`).
- Follows existing conventions: Drizzle migration workflow (`lib/db/migrations/000N_*.sql` + renamed tag in `meta/_journal.json`), CRUD route pairs (`app/api/<thing>/all` + `app/api/<thing>/[id]`), page/nav pattern in `app/page.tsx`.

## Review Focus

- A forged `POST /api/invoices/all` request for a client whose billing fields aren't set — must still be rejected server-side (400), not just hidden from the dropdown client-side.
- `totalAmountCents` of zero or negative — must be rejected (400), not silently accepted as a $0.00 invoice.
- Invoice numbering across a month boundary — the third invoice of October must get `-003` while the first invoice of November must reset to `-001`, not continue the October count.
- A unique-constraint collision on `invoiceNumber` (two rows computed the same sequence) — `createInvoice` must recover by retrying with the next sequence, not crash or produce a duplicate.
- PDF rendering with the optional/nullable fields actually absent (`addressLine2: null`, `description: null`) and with a long `description` — must render successfully, not throw.

---

### Task 1: Client billing fields

**Files:**
- Modify: `lib/db/schema.ts` (`clients` table)
- Create: `lib/db/migrations/0009_add_client_billing_fields.sql` (+ `lib/db/migrations/meta/0009_snapshot.json`, `meta/_journal.json` entry)
- Modify: `app/api/clients/[id]/route.ts`
- Modify: `app/clients/page.tsx`
- Test: `tests/api/clients-manage.test.ts`

**Interfaces:**
- Produces: `clients.legalName`, `clients.addressLine1`, `clients.addressLine2`, `clients.attention` — all nullable `text` columns. Consumed by Task 3's `createInvoice` (eligibility check + snapshot source) and Task 5's invoice-form client dropdown (eligibility filter).
- Produces: `PATCH /api/clients/[id]` accepts optional `legalName`, `addressLine1`, `addressLine2`, `attention` string fields in its body, alongside the existing `tag`/`displayName`/`recognized`.

- [ ] **Step 1: Write the failing test**

In `tests/api/clients-manage.test.ts`, add:

```typescript
test("PATCH /api/clients/[id] updates the billing fields", async () => {
  const [client] = await db.insert(clients).values({ tag: "billing-test", displayName: "Billing Test", recognized: true, lastActivityAt: null }).returning();

  const res = await PATCH(
    patchRequest({ legalName: "BILLING TEST PTE LTD", addressLine1: "1 Test Road", addressLine2: "#01-01, Singapore 000000", attention: "Finance" }),
    context(client.id),
  );

  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.legalName).toBe("BILLING TEST PTE LTD");
  expect(body.addressLine1).toBe("1 Test Road");
  expect(body.addressLine2).toBe("#01-01, Singapore 000000");
  expect(body.attention).toBe("Finance");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/api/clients-manage.test.ts`
Expected: FAIL — response fields are `undefined` (the route doesn't accept these fields yet).

- [ ] **Step 3: Add the columns to `lib/db/schema.ts`**

Add to the `clients` table definition: `legalName: text("legal_name")`, `addressLine1: text("address_line1")`, `addressLine2: text("address_line2")`, `attention: text("attention")`. All nullable (no `.notNull()`).

- [ ] **Step 4: Generate and rename the migration**

Run: `npx drizzle-kit generate`
Rename the generated file to `lib/db/migrations/0009_add_client_billing_fields.sql` and update its `tag` in `lib/db/migrations/meta/_journal.json` to match (same process as every prior migration in this repo — see `0008`'s entry for the exact shape).

- [ ] **Step 5: Extend `PatchPayload` and `parsePatchPayload` in `app/api/clients/[id]/route.ts`**

Add `legalName?: string`, `addressLine1?: string`, `addressLine2?: string`, `attention?: string` to the `PatchPayload` interface. Each, if present in the body, must be a string (empty string is fine — it's how a field gets cleared) and gets trimmed before being added to `update`. Follow the exact pattern already used for `tag`/`displayName` in that function.

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run tests/api/clients-manage.test.ts`
Expected: PASS.

- [ ] **Step 7: Add the billing fields to the Clients page edit form**

In `app/clients/page.tsx`, add four more inputs (legal name, address line 1, address line 2, attention) to the existing edit-mode block (the `editingId === client.id` branch), with their own `editLegalName`/`editAddressLine1`/`editAddressLine2`/`editAttention` state, initialized in `startEdit` from the client row, and included in the `saveEdit` → `patchClient` call. Reuse the existing `inputStyle` constant. No test — this project doesn't unit-test React components (see `TodoList`/`PostingSchedule` precedent); it's verified in Task 5's browser pass once the whole feature is wired together.

- [ ] **Step 8: Run the full suite**

Run: `npx vitest run`
Expected: all tests pass.

- [ ] **Step 9: Commit**

```bash
git add lib/db/schema.ts lib/db/migrations/0009_add_client_billing_fields.sql lib/db/migrations/meta app/api/clients/\[id\]/route.ts app/clients/page.tsx tests/api/clients-manage.test.ts
git commit -m "feat: add billing fields to clients for invoicing"
```

---

### Task 2: Invoice formatting helpers

**Files:**
- Create: `lib/invoices/format.ts`
- Test: `tests/invoices/format.test.ts`

**Interfaces:**
- Produces, all pure functions, all SGT-based (`Intl.DateTimeFormat` with `timeZone: "Asia/Singapore"`, matching `lib/posting-schedule/sheet.ts`'s `sgtDateKey` pattern):
  - `sgtYearMonthKey(date: Date): string` → `"YYYY-MM"`, e.g. `"2026-10"`.
  - `formatInvoiceNumber(invoiceDate: Date, sequence: number): string` → `"ARC" + 2-digit year + 2-digit month + "-" + 3-digit zero-padded sequence`, e.g. `"ARC2610-002"`.
  - `computeDueDate(invoiceDate: Date): Date` → `invoiceDate` + exactly 7 × 24 × 60 × 60 × 1000 ms.
  - `formatServiceMonthLabel(invoiceDate: Date): string` → full month name + 4-digit year, e.g. `"October 2026"`.
  - `formatInvoiceDateShort(date: Date): string` → `"D/M/YY"`, no leading zeros on day or month, e.g. `"4/10/26"`.
  - `formatDueDateLong(date: Date): string` → `"Weekday, D Month YYYY"`, e.g. `"Saturday, 10 October 2026"`.
  - `formatAmountSgd(amountCents: number): string` → comma-grouped, 2 decimals, no currency symbol, e.g. `160000` → `"1,600.00"`.
- Consumed by Task 3's `createInvoice` (`formatInvoiceNumber`, `computeDueDate`, `sgtYearMonthKey`) and Task 4's PDF document (`formatServiceMonthLabel`, `formatInvoiceDateShort`, `formatDueDateLong`, `formatAmountSgd`).

- [ ] **Step 1: Write the failing tests**

```typescript
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/invoices/format.test.ts`
Expected: FAIL with "Cannot find package '@/lib/invoices/format'".

- [ ] **Step 3: Implement `lib/invoices/format.ts`**

All seven functions above. `formatInvoiceDateShort`/`formatDueDateLong`/`formatServiceMonthLabel` read the date's SGT year/month/day/weekday via `Intl.DateTimeFormat` parts (do not use the local `Date` getters — they'd read the server's own timezone, not SGT). `formatAmountSgd` divides `amountCents` by 100 and formats with `Intl.NumberFormat("en-SG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/invoices/format.test.ts`
Expected: PASS, 9/9.

- [ ] **Step 5: Commit**

```bash
git add lib/invoices/format.ts tests/invoices/format.test.ts
git commit -m "feat: add invoice number/date/amount formatting helpers"
```

---

### Task 3: `invoices` table, `createInvoice`, and the create/list API

**Files:**
- Modify: `lib/db/schema.ts` (new `invoices` table)
- Create: `lib/db/migrations/0010_add_invoices.sql` (+ `meta/0010_snapshot.json`, `meta/_journal.json` entry)
- Create: `lib/invoices/create.ts`
- Create: `app/api/invoices/all/route.ts`
- Test: `tests/invoices/create.test.ts`
- Test: `tests/api/invoices-manage.test.ts`

**Interfaces:**
- Consumes: Task 1's `clients.legalName`/`addressLine1`/`addressLine2`/`attention`; Task 2's `computeDueDate`, `formatInvoiceNumber`, `sgtYearMonthKey`.
- Produces:
  - `invoices` table: `id` (uuid PK), `invoiceNumber` (text, unique, not null), `clientId` (uuid FK → `clients.id`, not null), `clientLegalName` (text, not null), `clientAddressLine1` (text, not null), `clientAddressLine2` (text, nullable), `clientAttention` (text, not null), `invoiceDate` (timestamp, not null), `dueDate` (timestamp, not null), `description` (text, nullable), `totalAmountCents` (integer, not null), `createdAt` (timestamp, not null, default now).
  - `CreateInvoiceInput { clientId: string; description: string | null; totalAmountCents: number; invoiceDate?: Date }` (`invoiceDate` defaults to `new Date()` when omitted).
  - `CreateInvoiceResult = { ok: true; invoice: typeof invoices.$inferSelect } | { ok: false; error: "client_not_found" | "client_not_eligible" }`.
  - `createInvoice(input: CreateInvoiceInput): Promise<CreateInvoiceResult>` in `lib/invoices/create.ts` — consumed by this task's own `POST` route and Task 6's backfill script.
  - `GET /api/invoices/all` → every invoice, newest `invoiceDate` first, each row augmented with `clientDisplayName` (left-joined from `clients.displayName` — the current display name, not the snapshotted legal name; this is just a UI label, not a legal document, so it's fine for it to reflect the client's current name).
  - `POST /api/invoices/all` → body `{ clientId: string; description?: string; totalAmountCents: number }`. Validates `totalAmountCents` is an integer > 0 (400 if not) before calling `createInvoice` with `invoiceDate` omitted (defaults to now). Maps `client_not_found` → 404, `client_not_eligible` → 400, success → 201 with the created row.

- [ ] **Step 1: Write the failing tests for `createInvoice`**

```typescript
// tests/invoices/create.test.ts
import { beforeEach, expect, test } from "vitest";
import { db } from "@/lib/db/client";
import { clients, invoices } from "@/lib/db/schema";
import { createInvoice } from "@/lib/invoices/create";

const ELIGIBLE = { legalName: "TEST CO PTE LTD", addressLine1: "1 Test Road", addressLine2: "#01-01, Singapore 000000", attention: "Account Department" };

beforeEach(async () => {
  await db.delete(invoices);
  await db.delete(clients);
});

test("creates the first invoice of a month as sequence 001", async () => {
  const [client] = await db.insert(clients).values({ tag: "t1", displayName: "T1", recognized: true, lastActivityAt: null, ...ELIGIBLE }).returning();

  const result = await createInvoice({ clientId: client.id, description: "*4 Content Posts", totalAmountCents: 100000, invoiceDate: new Date("2026-11-01T01:00:00Z") });

  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.invoice.invoiceNumber).toBe("ARC2611-001");
    expect(result.invoice.clientLegalName).toBe("TEST CO PTE LTD");
    expect(result.invoice.clientAddressLine2).toBe("#01-01, Singapore 000000");
    expect(result.invoice.dueDate).toEqual(new Date("2026-11-08T01:00:00Z"));
  }
});

test("increments the sequence for a second invoice in the same month", async () => {
  const [client] = await db.insert(clients).values({ tag: "t1", displayName: "T1", recognized: true, lastActivityAt: null, ...ELIGIBLE }).returning();
  await createInvoice({ clientId: client.id, description: null, totalAmountCents: 1, invoiceDate: new Date("2026-11-01T01:00:00Z") });

  const result = await createInvoice({ clientId: client.id, description: null, totalAmountCents: 1, invoiceDate: new Date("2026-11-20T01:00:00Z") });

  expect(result.ok && result.invoice.invoiceNumber).toBe("ARC2611-002");
});

test("resets the sequence to 001 in a new month", async () => {
  const [client] = await db.insert(clients).values({ tag: "t1", displayName: "T1", recognized: true, lastActivityAt: null, ...ELIGIBLE }).returning();
  await createInvoice({ clientId: client.id, description: null, totalAmountCents: 1, invoiceDate: new Date("2026-10-31T01:00:00Z") });

  const result = await createInvoice({ clientId: client.id, description: null, totalAmountCents: 1, invoiceDate: new Date("2026-11-01T01:00:00Z") });

  expect(result.ok && result.invoice.invoiceNumber).toBe("ARC2611-001");
});

test("returns client_not_found for a nonexistent client", async () => {
  const result = await createInvoice({ clientId: "00000000-0000-0000-0000-000000000000", description: null, totalAmountCents: 1 });
  expect(result).toEqual({ ok: false, error: "client_not_found" });
});

test("returns client_not_eligible when the client has no legalName/addressLine1", async () => {
  const [client] = await db.insert(clients).values({ tag: "t1", displayName: "T1", recognized: true, lastActivityAt: null }).returning();
  const result = await createInvoice({ clientId: client.id, description: null, totalAmountCents: 1 });
  expect(result).toEqual({ ok: false, error: "client_not_eligible" });
});

test("defaults clientAttention to 'Account Department' when the client has no attention set", async () => {
  const [client] = await db.insert(clients).values({
    tag: "t1", displayName: "T1", recognized: true, lastActivityAt: null,
    legalName: "TEST CO PTE LTD", addressLine1: "1 Test Road", addressLine2: null, attention: null,
  }).returning();

  const result = await createInvoice({ clientId: client.id, description: null, totalAmountCents: 1 });

  expect(result.ok && result.invoice.clientAttention).toBe("Account Department");
});

test("recovers from an invoiceNumber collision by retrying with the next sequence", async () => {
  const [client] = await db.insert(clients).values({ tag: "t1", displayName: "T1", recognized: true, lastActivityAt: null, ...ELIGIBLE }).returning();
  // Simulates a pre-existing row with the number createInvoice would otherwise compute first.
  await db.insert(invoices).values({
    invoiceNumber: "ARC2611-001", clientId: client.id, clientLegalName: "X", clientAddressLine1: "X", clientAddressLine2: null, clientAttention: "X",
    invoiceDate: new Date("2026-11-01T00:00:00Z"), dueDate: new Date("2026-11-08T00:00:00Z"), description: null, totalAmountCents: 1,
  });

  const result = await createInvoice({ clientId: client.id, description: null, totalAmountCents: 1, invoiceDate: new Date("2026-11-01T01:00:00Z") });

  expect(result.ok && result.invoice.invoiceNumber).toBe("ARC2611-002");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/invoices/create.test.ts`
Expected: FAIL — `lib/invoices/create.ts` and the `invoices` table don't exist yet.

- [ ] **Step 3: Add the `invoices` table to `lib/db/schema.ts` and generate the migration**

Add the table exactly as specified in Produces above. Run `npx drizzle-kit generate`, rename to `lib/db/migrations/0010_add_invoices.sql`, update the journal tag — same process as Task 1 Step 4.

- [ ] **Step 4: Implement `createInvoice` in `lib/invoices/create.ts`**

1. Look up the client by `input.clientId`. Not found → `{ ok: false, error: "client_not_found" }`.
2. `legalName`/`addressLine1` both null/missing → `{ ok: false, error: "client_not_eligible" }`.
3. `invoiceDate = input.invoiceDate ?? new Date()`.
4. Fetch all rows from `invoices` (table is small — single-user, low volume; no need for a SQL date-range query), filter to those whose `sgtYearMonthKey(row.invoiceDate) === sgtYearMonthKey(invoiceDate)`, `sequence = filtered.length + 1`.
5. `invoiceNumber = formatInvoiceNumber(invoiceDate, sequence)`, `dueDate = computeDueDate(invoiceDate)`.
6. Insert, snapshotting `clientLegalName`/`clientAddressLine1`/`clientAddressLine2` verbatim from the client row fetched in step 1, and `clientAttention: client.attention ?? "Account Department"` — `attention` is optional on `clients` (Task 1), so a client set up without it still gets the sample's default rather than a blank line on the PDF. On an `isUniqueConstraintViolation(error, "invoices_invoice_number_unique")` (reuse `lib/db/pg-errors.ts`, same helper `lib/telegram/webhook/route.ts` and others already use), increment `sequence` by 1 and retry the insert — up to 3 total attempts before rethrowing.
7. Return `{ ok: true, invoice }`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/invoices/create.test.ts`
Expected: PASS, 7/7.

- [ ] **Step 6: Write the failing tests for the API routes**

```typescript
// tests/api/invoices-manage.test.ts
import { beforeEach, expect, test } from "vitest";
import { GET, POST } from "@/app/api/invoices/all/route";
import { db } from "@/lib/db/client";
import { clients, invoices } from "@/lib/db/schema";

function postRequest(body: unknown) {
  return new Request("http://localhost/api/invoices/all", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

beforeEach(async () => {
  await db.delete(invoices);
  await db.delete(clients);
});

test("POST /api/invoices/all creates an invoice and returns 201", async () => {
  const [client] = await db.insert(clients).values({
    tag: "t1", displayName: "T1", recognized: true, lastActivityAt: null,
    legalName: "TEST CO PTE LTD", addressLine1: "1 Test Road", addressLine2: null, attention: "Account Department",
  }).returning();

  const res = await POST(postRequest({ clientId: client.id, description: "*4 Content Posts", totalAmountCents: 100000 }));

  expect(res.status).toBe(201);
  const body = await res.json();
  expect(body.invoiceNumber).toMatch(/^ARC\d{4}-\d{3}$/);
});

test("POST /api/invoices/all rejects a non-positive totalAmountCents", async () => {
  const [client] = await db.insert(clients).values({
    tag: "t1", displayName: "T1", recognized: true, lastActivityAt: null,
    legalName: "TEST CO PTE LTD", addressLine1: "1 Test Road", addressLine2: null, attention: "Account Department",
  }).returning();

  const res = await POST(postRequest({ clientId: client.id, totalAmountCents: 0 }));
  expect(res.status).toBe(400);
});

test("POST /api/invoices/all returns 404 for a nonexistent client", async () => {
  const res = await POST(postRequest({ clientId: "00000000-0000-0000-0000-000000000000", totalAmountCents: 100 }));
  expect(res.status).toBe(404);
});

test("POST /api/invoices/all returns 400 for a client with no billing profile", async () => {
  const [client] = await db.insert(clients).values({ tag: "t1", displayName: "T1", recognized: true, lastActivityAt: null }).returning();
  const res = await POST(postRequest({ clientId: client.id, totalAmountCents: 100 }));
  expect(res.status).toBe(400);
});

test("GET /api/invoices/all returns invoices newest invoiceDate first, with clientDisplayName", async () => {
  const [client] = await db.insert(clients).values({ tag: "t1", displayName: "Display Name", recognized: true, lastActivityAt: null }).returning();
  await db.insert(invoices).values([
    { invoiceNumber: "ARC2610-001", clientId: client.id, clientLegalName: "X", clientAddressLine1: "X", clientAddressLine2: null, clientAttention: "X", invoiceDate: new Date("2026-10-01"), dueDate: new Date("2026-10-08"), description: null, totalAmountCents: 100 },
    { invoiceNumber: "ARC2610-002", clientId: client.id, clientLegalName: "X", clientAddressLine1: "X", clientAddressLine2: null, clientAttention: "X", invoiceDate: new Date("2026-10-15"), dueDate: new Date("2026-10-22"), description: null, totalAmountCents: 200 },
  ]);

  const res = await GET();
  const body = await res.json();
  expect(body.map((row: { invoiceNumber: string }) => row.invoiceNumber)).toEqual(["ARC2610-002", "ARC2610-001"]);
  expect(body[0].clientDisplayName).toBe("Display Name");
});
```

- [ ] **Step 7: Run tests to verify they fail**

Run: `npx vitest run tests/api/invoices-manage.test.ts`
Expected: FAIL — `app/api/invoices/all/route.ts` doesn't exist.

- [ ] **Step 8: Implement `app/api/invoices/all/route.ts`**

`GET`: left-join `invoices` to `clients` on `clientId`, select all invoice columns plus `clients.displayName as clientDisplayName`, order by `invoiceDate` descending.
`POST`: parse body, reject (400) if `totalAmountCents` isn't a positive integer or `clientId` isn't a non-empty string; call `createInvoice({ clientId, description: description ?? null, totalAmountCents })`; map the result as specified in Produces above.

- [ ] **Step 9: Run tests to verify they pass, then the full suite**

Run: `npx vitest run tests/api/invoices-manage.test.ts` then `npx vitest run`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add lib/db/schema.ts lib/db/migrations/0010_add_invoices.sql lib/db/migrations/meta lib/invoices/create.ts app/api/invoices/all/route.ts tests/invoices/create.test.ts tests/api/invoices-manage.test.ts
git commit -m "feat: add invoices table, createInvoice, and the create/list API"
```

---

### Task 4: PDF rendering

**Files:**
- Create: `public/invoice/logo.png`
- Create: `public/invoice/paynow-qr.png`
- Modify: `next.config.ts`
- Modify: `package.json` (new dependency)
- Create: `lib/invoices/pdf.tsx`
- Test: `tests/invoices/pdf.test.ts`

**Interfaces:**
- Consumes: Task 2's `formatInvoiceDateShort`, `formatDueDateLong`, `formatServiceMonthLabel`, `formatAmountSgd`; Task 3's `invoices` row shape.
- Produces: `renderInvoicePdfBuffer(invoice: typeof invoices.$inferSelect): Promise<Buffer>` in `lib/invoices/pdf.tsx` — consumed by Task 5's download route.

- [ ] **Step 1: Crop the reference assets**

From `/Users/callum/Downloads/LOVELOTS OCTOBER INV copy.pdf`, crop out the small black "arc." logo square and the PayNow QR code image, save as `public/invoice/logo.png` and `public/invoice/paynow-qr.png` respectively. Exact crop margins are a judgment call — match the sample visually. These are committed, static, reused unchanged on every invoice (never regenerated).

- [ ] **Step 2: Install the PDF library**

Run: `npm install @react-pdf/renderer`

- [ ] **Step 3: Exclude it from server bundling in `next.config.ts`**

Add `"@react-pdf/renderer"` to the existing `serverExternalPackages` array, alongside `@electric-sql/pglite`, with a one-line comment explaining why (same category of issue as the existing `@electric-sql/pglite` comment: a pure-JS library with its own internal asset/font loading that bundling can break — confirm this is actually necessary once Step 6 renders successfully; if it works fine without this entry, leave the config unchanged and say so in the commit).

- [ ] **Step 4: Write the failing test**

```typescript
// tests/invoices/pdf.test.ts
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
```

- [ ] **Step 5: Run tests to verify they fail**

Run: `npx vitest run tests/invoices/pdf.test.ts`
Expected: FAIL — `lib/invoices/pdf.tsx` doesn't exist.

- [ ] **Step 6: Implement `lib/invoices/pdf.tsx`**

An `InvoiceDocument` component (`Document`/`Page`/`View`/`Text`/`Image` from `@react-pdf/renderer`) and `renderInvoicePdfBuffer(invoice): Promise<Buffer>` wrapping `renderToBuffer(<InvoiceDocument invoice={invoice} />)`. Layout, top to bottom, reproducing the sample exactly:

- Top-left: the `public/invoice/logo.png` image, with "INVOICE" beneath it in bold.
- Top-right block: "ARCSOCIAL PTE LTD" (bold), then exactly:
  ```
  Co. Reg No: 202605753K
  E-mail: business@arcsocialsg.com
  Contact No: 8883 7487 (Kash)
              8261 0777 (Callum)
  ```
  then, as a labeled two-column block: "Invoice Date" → `formatInvoiceDateShort(invoice.invoiceDate)`; "Invoice No" → `invoice.invoiceNumber`; "Attention" → `invoice.clientAttention`.
- Below the logo/letterhead: the address block — `invoice.clientLegalName`, `invoice.clientAddressLine1`, and `invoice.clientAddressLine2` (only rendered when not null).
- A table with header "Description | Tax | Amount (SGD)" and one row: description `Service Fees - ${formatServiceMonthLabel(invoice.invoiceDate)}`, with `invoice.description` rendered **verbatim, with no prepended asterisk**, on the line beneath it (only rendered when `invoice.description` is not null/empty). Callum types the whole sub-line himself (including any leading "*" he wants, matching the sample's "*8 Content Posts" style) — the stored value is shown exactly as typed, never templated. Tax column "No Tax", amount column `$ ${formatAmountSgd(invoice.totalAmountCents)}`. Then a "Total (SGD)" row with the same amount.
- "Due Date: " + `formatDueDateLong(invoice.dueDate)`, then "Payment to be remitted to:" and exactly:
  ```
  Bank Name: OCBC BANK LTD
  Beneficiary's Name: ARC SOCIAL PTE LTD
  Account No: 701635377001
  Paynow UEN: 202605753K
  ```
  with the `public/invoice/paynow-qr.png` image beside this block.
- "Late Payment Policy:" followed by exactly:
  ```
  ~ For payments received 1–7 days past the due date, a 1% late fee will be applied to the outstanding amount.
  ~ For payments received more than 7 days past the due date, a 5% late fee will be applied to the outstanding amount.
  ~ Applicable late fees will be reflected in the subsequent invoice, where relevant.
  ```
- Centered footer: "This is a computer generated invoice, no signature is required."

Exact pixel positions/font sizes are implementer judgment — match the sample's structure and ordering; this gets a visual sanity check in Task 5 Step 8.

- [ ] **Step 7: Run tests to verify they pass**

Run: `npx vitest run tests/invoices/pdf.test.ts`
Expected: PASS, 3/3.

- [ ] **Step 8: Run the full suite**

Run: `npx vitest run`
Expected: all tests pass.

- [ ] **Step 9: Commit**

```bash
git add public/invoice next.config.ts package.json package-lock.json lib/invoices/pdf.tsx tests/invoices/pdf.test.ts
git commit -m "feat: render invoice PDFs matching the ARC Social template"
```

---

### Task 5: Download route, Invoices page, nav link

**Files:**
- Create: `app/api/invoices/[id]/pdf/route.ts`
- Create: `app/invoices/page.tsx`
- Modify: `app/page.tsx`
- Test: `tests/api/invoice-pdf-download.test.ts`

**Interfaces:**
- Consumes: Task 3's `GET`/`POST /api/invoices/all`, Task 4's `renderInvoicePdfBuffer`.
- Produces: `GET /api/invoices/[id]/pdf` → the rendered PDF, `Content-Type: application/pdf`, `Content-Disposition: attachment; filename="<invoiceNumber>.pdf"`; 404 for an unknown id.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/api/invoice-pdf-download.test.ts
import { beforeEach, expect, test } from "vitest";
import { GET } from "@/app/api/invoices/[id]/pdf/route";
import { db } from "@/lib/db/client";
import { clients, invoices } from "@/lib/db/schema";

function context(id: string) {
  return { params: Promise.resolve({ id }) };
}

beforeEach(async () => {
  await db.delete(invoices);
  await db.delete(clients);
});

test("GET /api/invoices/[id]/pdf returns a PDF with the invoice number as the filename", async () => {
  const [client] = await db.insert(clients).values({ tag: "t1", displayName: "T1", recognized: true, lastActivityAt: null }).returning();
  const [invoice] = await db.insert(invoices).values({
    invoiceNumber: "ARC2610-099", clientId: client.id, clientLegalName: "X", clientAddressLine1: "X", clientAddressLine2: null, clientAttention: "X",
    invoiceDate: new Date("2026-10-01"), dueDate: new Date("2026-10-08"), description: null, totalAmountCents: 100,
  }).returning();

  const res = await GET(new Request("http://localhost/api/invoices/x/pdf"), context(invoice.id));

  expect(res.status).toBe(200);
  expect(res.headers.get("Content-Type")).toBe("application/pdf");
  expect(res.headers.get("Content-Disposition")).toContain("ARC2610-099.pdf");
});

test("GET /api/invoices/[id]/pdf returns 404 for a nonexistent invoice", async () => {
  const res = await GET(new Request("http://localhost/api/invoices/x/pdf"), context("00000000-0000-0000-0000-000000000000"));
  expect(res.status).toBe(404);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/api/invoice-pdf-download.test.ts`
Expected: FAIL — route doesn't exist.

- [ ] **Step 3: Implement `app/api/invoices/[id]/pdf/route.ts`**

Loads the invoice by `id`; 404 (JSON `{ error: ... }`) if missing; otherwise calls `renderInvoicePdfBuffer(invoice)` and returns a `Response` with that buffer as the body and the two headers specified above.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/api/invoice-pdf-download.test.ts`
Expected: PASS, 2/2.

- [ ] **Step 5: Build `app/invoices/page.tsx`**

Follow `app/content-ideas/page.tsx`'s structure (client dropdown + form + list, same `inputStyle` constant, same loading/error states):
- Fetch `GET /api/clients/all` and `GET /api/invoices/all` on mount (`Promise.all`, same pattern as `app/clients/page.tsx`'s `load`).
- Eligible clients for the dropdown = those with both `legalName` and `addressLine1` truthy.
- Form: client `<select>` (reuse the exact `<option value="">Select a client…</option>` + mapped options pattern from `app/content-ideas/page.tsx:211-223`), a description `<textarea>`, and a total-amount `<input type="number" step="0.01">` (dollars — convert to cents via `Math.round(parseFloat(value) * 100)` right before the `POST`, so the API boundary stays integer cents as Task 3 specifies). A "Generate" submit button, disabled while a request is in flight (same `adding` boolean pattern as the other pages).
- On successful `POST`, open `/api/invoices/${created.id}/pdf` in a new tab/window (triggers the download) and re-fetch the invoice list.
- List: every invoice (`invoiceNumber`, `clientDisplayName`, `formatInvoiceDateShort`-style short date, `$` + dollars from `totalAmountCents / 100` formatted to 2 decimals), each row with a "Download" link pointing at `/api/invoices/${id}/pdf`.

No test — React components aren't unit-tested in this project; verified in Step 8's browser pass.

- [ ] **Step 6: Add the nav link**

In `app/page.tsx`, add `<a href="/invoices">Invoices →</a>` alongside the existing `Clients →`/`Ideas →`/`Suggestions →`/`History →` links, same styling.

- [ ] **Step 7: Run the full suite, typecheck, and build**

Run: `npx vitest run`, `npx tsc --noEmit`, `npx next build`
Expected: all green.

- [ ] **Step 8: Browser verification**

Start the dev server, log in, navigate to `/invoices`. Confirm: the dropdown only lists clients with billing profiles; generating an invoice downloads a PDF that visually matches the sample (letterhead, logo, QR, bank details, late payment policy, correct invoice number/dates/amount); the new invoice appears in the list; generating a second invoice for the same month increments the sequence correctly; re-downloading an already-listed invoice from the list works.

- [ ] **Step 9: Commit**

```bash
git add app/api/invoices/\[id\]/pdf/route.ts app/invoices/page.tsx app/page.tsx tests/api/invoice-pdf-download.test.ts
git commit -m "feat: add the Invoices page, PDF download route, and nav link"
```

---

### Task 6: Client billing profiles + October 2026 invoice backfill

**Files:**
- Modify: `lib/db/seed.ts`
- Modify: `lib/db/seed-cli.ts`
- Create: `lib/db/backfill-invoices.ts`
- Create: `lib/db/backfill-invoices-cli.ts`
- Modify: `package.json` (new `db:backfill-invoices` script)
- Modify: `docs/superpowers/deploy-notes.md`
- Test: `tests/db/seed.test.ts`
- Test: `tests/db/backfill-invoices.test.ts`

**Interfaces:**
- Consumes: Task 3's `createInvoice`.
- Produces: nothing consumed elsewhere — this is the final, leaf task.

- [ ] **Step 1: Write the failing test for billing-profile seeding**

In `tests/db/seed.test.ts` (read the file first for its existing `beforeEach`/import pattern and follow it), add:

```typescript
test("seedClientBillingProfiles fills in legalName/address for Lovelots, That Place, and HappyFish", async () => {
  await seedClients(); // these three tags must exist first, same as production
  await seedClientBillingProfiles();

  const rows = await db.select().from(clients).where(inArray(clients.tag, ["Lovelots", "That Place", "HappyFish"]));
  const lovelots = rows.find((r) => r.tag === "Lovelots")!;
  expect(lovelots.legalName).toBe("LOVELOTS DIAMOND PTE LTD");
  expect(lovelots.addressLine1).toBe("181 Orchard Road");
  expect(lovelots.addressLine2).toBe("#04-02, Singapore 238896");
  expect(lovelots.attention).toBe("Account Department");
});

test("seedClientBillingProfiles never overwrites a profile Callum already edited", async () => {
  await seedClients();
  await db.update(clients).set({ legalName: "MANUALLY EDITED" }).where(eq(clients.tag, "Lovelots"));

  await seedClientBillingProfiles();

  const [lovelots] = await db.select().from(clients).where(eq(clients.tag, "Lovelots"));
  expect(lovelots.legalName).toBe("MANUALLY EDITED");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/db/seed.test.ts`
Expected: FAIL — `seedClientBillingProfiles` doesn't exist.

- [ ] **Step 3: Implement `seedClientBillingProfiles` in `lib/db/seed.ts`**

A hardcoded array of the three known profiles:

```typescript
const CLIENT_BILLING_PROFILES: Array<{ tag: string; legalName: string; addressLine1: string; addressLine2: string; attention: string }> = [
  { tag: "Lovelots", legalName: "LOVELOTS DIAMOND PTE LTD", addressLine1: "181 Orchard Road", addressLine2: "#04-02, Singapore 238896", attention: "Account Department" },
  { tag: "That Place", legalName: "TIC TOC KOPI PTE LTD", addressLine1: "207 Henderson Road", addressLine2: "#01-01, Singapore 159550", attention: "Account Department" },
  { tag: "HappyFish", legalName: "HAPPY FISH SWIM SCHOOL PTE LTD", addressLine1: "102F Pasir Panjang Road", addressLine2: "#05-03, Singapore 118530", attention: "Account Department" },
];
```

`export async function seedClientBillingProfiles(): Promise<void>` — for each profile, `UPDATE clients SET legalName = ..., addressLine1 = ..., addressLine2 = ..., attention = ... WHERE tag = <tag> AND legalName IS NULL` (the `legalName IS NULL` guard is what makes it idempotent and non-destructive — reuse Drizzle's `and(eq(clients.tag, tag), isNull(clients.legalName))` in the `.where()`).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/db/seed.test.ts`
Expected: PASS.

- [ ] **Step 5: Call it from `seed-cli.ts`**

Add `await seedClientBillingProfiles();` to `main()` in `lib/db/seed-cli.ts`, after `seedClients()`, before the console.log — so a future `npm run db:seed` keeps these three profiles filled in.

- [ ] **Step 6: Write the failing test for the invoice backfill**

```typescript
// tests/db/backfill-invoices.test.ts
import { beforeEach, expect, test } from "vitest";
import { db } from "@/lib/db/client";
import { clients, invoices } from "@/lib/db/schema";
import { seedClients, seedClientBillingProfiles } from "@/lib/db/seed";
import { backfillOctoberInvoices } from "@/lib/db/backfill-invoices";

beforeEach(async () => {
  await db.delete(invoices);
  await db.delete(clients);
  await seedClients();
  await seedClientBillingProfiles();
});

test("creates ARC2610-001 for That Place and ARC2610-002 for Lovelots with the real figures", async () => {
  await backfillOctoberInvoices();

  const rows = await db.select().from(invoices);
  const thatPlace = rows.find((r) => r.invoiceNumber === "ARC2610-001")!;
  const lovelots = rows.find((r) => r.invoiceNumber === "ARC2610-002")!;

  expect(thatPlace.totalAmountCents).toBe(100000);
  expect(thatPlace.description).toBe("Remaining amount");
  expect(lovelots.totalAmountCents).toBe(160000);
  expect(lovelots.description).toBe("*8 Content Posts");
});

test("is idempotent — running it twice doesn't create duplicates", async () => {
  await backfillOctoberInvoices();
  await backfillOctoberInvoices();

  const rows = await db.select().from(invoices);
  expect(rows).toHaveLength(2);
});
```

- [ ] **Step 7: Run test to verify it fails**

Run: `npx vitest run tests/db/backfill-invoices.test.ts`
Expected: FAIL — `lib/db/backfill-invoices.ts` doesn't exist.

- [ ] **Step 8: Implement `backfillOctoberInvoices` in `lib/db/backfill-invoices.ts`**

`export async function backfillOctoberInvoices(): Promise<void>`. Skip entirely (return early) if an invoice with `invoiceNumber = "ARC2610-001"` already exists (the idempotency guard). Otherwise:
1. Look up the client with `tag = "That Place"`; call `createInvoice({ clientId: client.id, description: "Remaining amount", totalAmountCents: 100000, invoiceDate: new Date("2026-10-01T01:00:00Z") })`. Throw (with a clear message naming the missing tag) if the client isn't found or `createInvoice` returns `ok: false` — this script only ever runs once, deliberately, against real data; failing loudly is correct.
2. Look up the client with `tag = "Lovelots"`; call `createInvoice({ clientId: client.id, description: "*8 Content Posts", totalAmountCents: 160000, invoiceDate: new Date("2026-10-04T01:00:00Z") })`. Same error handling.

Calling them in this order relies on Task 3's real sequence-counting logic (not hardcoded numbers) to naturally produce `-001` then `-002`.

- [ ] **Step 9: Run test to verify it passes**

Run: `npx vitest run tests/db/backfill-invoices.test.ts`
Expected: PASS, 2/2.

- [ ] **Step 10: Create the CLI entrypoint**

`lib/db/backfill-invoices-cli.ts` — mirror `lib/db/seed-cli.ts` exactly (relative imports, no `@/` alias, `main().then(() => process.exit(0)).catch(...)`), calling `seedClientBillingProfiles()` then `backfillOctoberInvoices()`.

Add to `package.json`: `"db:backfill-invoices": "tsx lib/db/backfill-invoices-cli.ts"`.

- [ ] **Step 11: Document the one-time production run**

In `docs/superpowers/deploy-notes.md`, add a short new section (following the existing numbered-section style) noting that after this feature is deployed and its migrations are applied to production, `DATABASE_URL="<prod connection string>" npx tsx lib/db/backfill-invoices-cli.ts` must be run once to backfill the two October invoices and the three client billing profiles — mirroring how `db:seed` is already documented there.

- [ ] **Step 12: Run the full suite, typecheck, and build**

Run: `npx vitest run`, `npx tsc --noEmit`, `npx next build`
Expected: all green.

- [ ] **Step 13: Commit**

```bash
git add lib/db/seed.ts lib/db/seed-cli.ts lib/db/backfill-invoices.ts lib/db/backfill-invoices-cli.ts package.json docs/superpowers/deploy-notes.md tests/db/seed.test.ts tests/db/backfill-invoices.test.ts
git commit -m "feat: seed known client billing profiles and backfill October invoices"
```
