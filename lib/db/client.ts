import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { neon } from "@neondatabase/serverless";
import { drizzle as drizzleNeonHttp } from "drizzle-orm/neon-http";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import * as schema from "./schema";

async function createTestDb() {
  // Fresh in-memory Postgres per process/import — no path means ephemeral,
  // so there is no cross-file state between test files.
  //
  // `import.meta.dirname` is resolved lazily, inside this test-only
  // function, rather than as a module-scope constant. Next.js's
  // production build bundles this module with webpack even though this
  // branch is never taken outside NODE_ENV=test, and webpack's bundler
  // does not populate `import.meta.dirname` correctly (it becomes
  // `undefined` in the compiled server bundle, which crashed
  // `path.resolve` during "Collecting page data"). Keeping the
  // computation inside this function means it only ever runs under
  // vitest's native ESM loader (which supports `import.meta.dirname`
  // correctly) and is dead-code-eliminated out of the production bundle
  // entirely, since `process.env.NODE_ENV === "test"` is statically
  // false at build time.
  const migrationsFolder = path.resolve(import.meta.dirname, "migrations");
  const client = new PGlite();
  const testDb = drizzlePglite(client, { schema });
  await migratePglite(testDb, { migrationsFolder });
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

type ProductionDb = ReturnType<typeof createProductionDb>;

/**
 * Wraps `createProductionDb` so the real Neon client is constructed on
 * first use rather than at module load.
 *
 * `db` is imported at module scope by almost every route handler, and
 * `next build`'s "Collecting page data" step requires() each route
 * module during the build itself — with no request context and no
 * deployment secrets loaded. Constructing the Neon client eagerly here
 * means `next build` would always throw "DATABASE_URL is not set"
 * before a single request is ever served. Deferring construction to the
 * first property access lets the module load safely at build time; the
 * real connection is only attempted when a request actually queries the
 * database, by which point DATABASE_URL is set in the deployed runtime.
 */
function createLazyProductionDb(): ProductionDb {
  let real: ProductionDb | undefined;
  function getReal(): ProductionDb {
    if (!real) {
      real = createProductionDb();
    }
    return real;
  }
  return new Proxy({} as ProductionDb, {
    get(_target, prop) {
      const instance = getReal();
      const value = Reflect.get(instance, prop, instance);
      return typeof value === "function" ? value.bind(instance) : value;
    },
  });
}

export const db =
  process.env.NODE_ENV === "test"
    ? await createTestDb()
    : createLazyProductionDb();
