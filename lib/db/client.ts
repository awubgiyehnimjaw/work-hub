import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { neon } from "@neondatabase/serverless";
import { drizzle as drizzleNeonHttp } from "drizzle-orm/neon-http";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import * as schema from "./schema";

const MIGRATIONS_FOLDER = path.resolve(
  import.meta.dirname,
  "migrations",
);

async function createTestDb() {
  // Fresh in-memory Postgres per process/import — no path means ephemeral,
  // so there is no cross-file state between test files.
  const client = new PGlite();
  const testDb = drizzlePglite(client, { schema });
  await migratePglite(testDb, { migrationsFolder: MIGRATIONS_FOLDER });
  return testDb;
}

function createProductionDb() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set");
  }
  const sql = neon(connectionString);
  return drizzleNeonHttp(sql, { schema });
}

export const db =
  process.env.NODE_ENV === "test"
    ? await createTestDb()
    : createProductionDb();
