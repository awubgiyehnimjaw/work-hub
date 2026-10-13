/**
 * One-time (or re-runnable) manual seed script — `npm run db:seed`.
 *
 * Both `seedClients`/`seedSuggestions` are idempotent (upsert via
 * `onConflictDoNothing`), so running this against an already-seeded
 * database is a safe no-op. This exists because nothing else in the app
 * calls these at deploy time (see docs/superpowers/deploy-notes.md §4.1) —
 * without it, a fresh production database has an empty `suggestions`
 * table (so `/api/suggestions` 500s the moment the review queue and to-do
 * list are both empty) and an empty `clients` table (so the first real
 * upload auto-creates that client row flagged `recognized: false`,
 * permanently mis-flagging a real client as unrecognized).
 *
 * Uses relative imports (not the `@/` alias) so this can run directly
 * under `tsx` with no tsconfig-paths resolution step.
 */
import { seedClients, seedSuggestions } from "./seed";

async function main(): Promise<void> {
  await seedClients();
  await seedSuggestions();
  console.log("Database seeded: known clients + growth suggestions (idempotent).");
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error("db:seed failed:", error);
    process.exit(1);
  });
