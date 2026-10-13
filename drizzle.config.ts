import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./lib/db/schema.ts",
  out: "./lib/db/migrations",
  dialect: "postgresql",
  // Only consumed by `drizzle-kit migrate` (run once, by hand, against the
  // real Neon database during deployment — see docs/superpowers/deploy-notes.md).
  // Falls back to an empty string so commands that don't need a live
  // connection (e.g. `drizzle-kit generate`) keep working without
  // DATABASE_URL set, exactly as local dev (lib/db/client.ts) already
  // assumes no DATABASE_URL is required outside production.
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "",
  },
});
