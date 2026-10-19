/**
 * One-time production script — `npm run db:backfill-invoices`.
 *
 * Backfills the three known client billing profiles (Lovelots, That
 * Place, HappyFish) and the two real October 2026 invoices that were
 * already issued to That Place and Lovelots before this app's Invoices
 * feature existed — see `lib/db/backfill-invoices.ts` for why this
 * matters (it's what keeps this app's own invoice-number sequence from
 * colliding with numbers already in use).
 *
 * Both `seedClientBillingProfiles` and `backfillOctoberInvoices` are
 * idempotent, so running this against an already-backfilled database is
 * a safe no-op.
 *
 * Uses relative imports (not the `@/` alias) so this can run directly
 * under `tsx` with no tsconfig-paths resolution step.
 */
import { seedClientBillingProfiles } from "./seed";
import { backfillOctoberInvoices } from "./backfill-invoices";

async function main(): Promise<void> {
  await seedClientBillingProfiles();
  await backfillOctoberInvoices();
  console.log("Database backfilled: client billing profiles + October 2026 invoices (idempotent).");
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error("db:backfill-invoices failed:", error);
    process.exit(1);
  });
