# Invoice Generator — Design

## Intent and why

Callum (ARC Social) currently creates client invoices by hand from a template, keeping track of the monthly sequence number himself. That's error-prone (easy to reuse or skip a number) and leaves no record he can browse later. This feature adds an "Invoices" section to ARC Hub that generates a PDF invoice — visually identical to the agency's real template — from a short in-app form, auto-assigns the correct invoice number, and keeps every generated invoice browsable and re-downloadable.

Reference sample: `LOVELOTS OCTOBER INV copy.pdf` (provided by Callum) — ARCSOCIAL PTE LTD letterhead, bank/PayNow details, late payment policy, and layout to match exactly.

## Goals

- Generate a PDF that looks like the sample: same letterhead, company details, bank/PayNow info, late payment policy text, and layout.
- Auto-assign invoice numbers in the form `ARC<YY><MM>-<NNN>` (e.g. `ARC2610-003`) — a 3-digit sequence that resets every month, continuing correctly from whatever's already been issued that month (including invoices issued outside the app, before this feature existed).
- A client dropdown, populated from clients that have a billing profile set up.
- A free-text field for the line under "Service Fees – [Month Year]" (e.g. "*8 Content Posts") — fully custom text, not a constrained list.
- A plain numeric total-amount field (SGD).
- Due date auto-computed as invoice date + 7 days.
- Every generated invoice is saved and can be browsed and re-downloaded later from inside the app.
- October 2026 is seeded with the two invoices already issued outside the app (That Place = `ARC2610-001`, Lovelots = `ARC2610-002`), so the next invoice the app generates this month is `ARC2610-003`, not a collision.

## Non-goals

- Editing or deleting an invoice once it's generated. Invoices are immutable — a mistake means issuing a new one, which is standard invoicing practice and keeps the numbering sequence meaningful.
- GST/tax handling. Every sample invoice says "No Tax" — the generated PDF always does too.
- Emailing the invoice to the client. The app generates and stores the PDF; Callum sends it himself.
- Generating a dynamic, amount-specific PayNow QR code. The QR on the sample is ARC Social's one static, official PayNow QR (confirmed correct by Callum) — it's cropped from the sample PDF once and reused unchanged on every invoice.
- Billing profiles for Ultimate Intern, LeSaMai, NLD, or ARC itself. Only HappyFish, That Place, and Lovelots are set up now; more can be added later the same way, through the Clients page.
- Multi-currency. SGD only, matching every sample invoice.

## Anti-goals

Would make this a failure even if it "technically works":

- Two invoices ever sharing the same invoice number, or a number colliding with one already issued outside the app.
- A PDF that doesn't match the real letterhead closely enough to actually send to a client.
- A past invoice's stored figures (amount, description, date) becoming unrecoverable or silently wrong.

## Constraints

- Deploys on Vercel serverless functions — no headless-browser PDF rendering (Puppeteer/Chromium et al.) without extra infrastructure; the PDF library must be pure JS.
- Single-user app (no auth/permissions model needed beyond the existing passcode session).
- Follows existing codebase conventions: Drizzle/Neon migrations, the established CRUD route-pair pattern (`app/api/<thing>/all` + `app/api/<thing>/[id]`), and the existing page/nav pattern (`Clients →`, `Ideas →`, etc. in `app/page.tsx`).

## Decided (from the conversation with Callum)

- **PDF output**: the app generates an actual downloadable PDF styled like the sample — not just an in-app record.
- **Content-posts line**: a free-text field Callum fills in himself (not a dropdown of counts).
- **Total amount**: a plain number field, varies per invoice.
- **Due date**: always invoice date + 7 days, computed automatically.
- **Invoice number format**: `ARC` + 2-digit year + 2-digit month + `-` + 3-digit sequence, e.g. `ARC2610-003`. Resets every month.
- **PayNow QR**: the real one, cropped directly from the provided sample PDF and reused unchanged on every invoice — never regenerated or amount-specific.
- **Bank details, late payment policy, company letterhead**: fixed text/layout, taken verbatim from the sample, identical on every invoice.
- **History**: generated invoices are saved; Callum can come back later to see and re-download them.
- **Client billing profiles needed now** (Callum provided these):
  - HappyFish → `HAPPY FISH SWIM SCHOOL PTE LTD`, 102F Pasir Panjang Road, #05-03, Singapore 118530
  - That Place → `TIC TOC KOPI PTE LTD`, 207 Henderson Road, #01-01, Singapore 159550
  - Lovelots → `LOVELOTS DIAMOND PTE LTD`, 181 Orchard Road, #04-02, Singapore 238896
  - Ultimate Intern, LeSaMai, NLD: explicitly skipped for now.
- **October 2026 backfill**: That Place = `ARC2610-001`, Lovelots = `ARC2610-002` (the Lovelots sample itself — full details known: invoice date 4 Oct 2026, due 10 Oct 2026, $1,600.00, "*8 Content Posts"). These reserve the numbers so counting continues correctly.

## Left to the builder (my calls — flag if any of these are wrong)

- **PDF library**: `@react-pdf/renderer` — pure JS, renders PDFs from React components, no headless browser, works fine in a Vercel serverless function.
- **Data model — client billing fields**: extend the existing `clients` table with nullable `legalName`, `addressLine1`, `addressLine2` (unit + postal code), and `attention` columns, rather than a separate table — it's a 1:1 relationship and keeps things consistent with the schema's existing lean style. `attention` defaults to `"Account Department"` for every client (matches the sample; can be overridden per client later if ever needed).
- **Dropdown eligibility**: a client is selectable in the invoice form once it has both `legalName` and `addressLine1` filled in (the two fields that actually appear on the printed invoice address block). `addressLine2` and `attention` are optional — `attention` already has a sensible default, and not every address needs a second line.
- **Billing details are snapshotted onto the invoice, not live-joined**: at generation time, the client's current `legalName`/`addressLine1`/`addressLine2`/`attention` are copied onto the invoice row itself, not read fresh from `clients` on every re-download. If Callum later corrects a client's address, past invoices must keep showing what was actually printed and sent — re-deriving it from the (mutable) `clients` table would silently rewrite history, which is exactly the anti-goal above about a past invoice's figures becoming "silently wrong." `clientId` is still stored (for display/filtering by client in the list view), but the PDF itself is built only from the invoice row's own snapshotted fields.
- **New `invoices` table**: `id`, `invoiceNumber` (text, unique), `clientId` (FK, for filtering/display only), `clientLegalName`, `clientAddressLine1`, `clientAddressLine2`, `clientAttention` (the snapshot — same shapes as the `clients` columns they're copied from), `invoiceDate`, `dueDate`, `description` (text, nullable — the free-text content-posts line), `totalAmount` (numeric, nullable — see the backfill note below), `createdAt`.
- **Numbering logic**: on creation, count existing `invoices` rows whose `invoiceDate` falls in the same year+month, add 1, zero-pad to 3 digits. A unique constraint on `invoiceNumber` is the safety net against any race (this is a single-user app, so the risk is minimal, but the constraint makes a collision impossible rather than just unlikely).
- **Reference assets**: the sample PDF lives in Callum's Downloads, not the repo. Both the PayNow QR and the small "arc." letterhead logo are raster graphics inside it — I'll crop both out as PNGs and commit them to the repo as static assets (`public/invoice/` or similar) that every generated invoice embeds unchanged, the same technique already used for the QR.
- **Invoice date**: defaults to "today" at creation time, not manually editable — keeps the numbering and due-date math unambiguous.
- **Due date**: auto-computed, not manually editable.
- **Re-download**: the PDF is regenerated on demand from the stored invoice record each time "Download" is pressed, rather than storing a rendered PDF file in blob storage. Simpler, no extra infrastructure, and since invoice records are immutable the regenerated PDF is always identical to the original.
- **UI**:
  - New `Invoices →` link in the dashboard nav, alongside the existing ones.
  - An invoice list page: every past invoice (number, client, date, amount), each with a "Download" button.
  - A "New Invoice" form: client dropdown (only clients with a billing profile — the three set up now), description textarea, total amount field, a "Generate" button that creates the record and immediately downloads the PDF.
  - The Clients page gains the new billing fields (legal name, address, attention) on its existing add/edit form, so Callum can set up Ultimate Intern/LeSaMai/NLD/others himself later without needing to come back through chat.
- **October backfill seeding**: a one-time data migration inserting the two known October invoices, purely to reserve their numbers so the counter continues at `-003`. Lovelots (`-002`) is fully known from the sample PDF. That Place (`-001`) — only the number is known. `totalAmount` and `description` are nullable specifically for this case: That Place's row is seeded with both left null rather than a fake $0.00 (which would read as a real recorded fact later) and the list view shows "—" for a null amount. See the open question below if you'd rather have the real figures recorded instead.
- **Validation**: total amount must be a positive number when set by the invoice form (the nullable case above only applies to the backfilled That Place row, which the form never produces); description may be left blank (not every invoice necessarily needs a sub-line).

## Open question for Callum

- **That Place's October invoice (`ARC2610-001`)** — do you want its real amount and description recorded (just tell me the two numbers/text), or is it fine to seed it with the number reserved and the amount/description left blank in the history view?
