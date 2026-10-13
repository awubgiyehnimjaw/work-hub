import { mkdirSync } from "node:fs";
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

async function createLocalDevDb() {
  // Local development without a provisioned Neon database: a file-backed
  // PGlite instance persisted under a gitignored directory at the repo
  // root. Unlike the test branch, this data directory is NOT ephemeral —
  // it persists across `next dev` restarts so local data survives
  // between runs — but it is still just local Postgres-in-WASM, migrated
  // on startup the same way the test branch is.
  //
  // This is only called at real `next dev` runtime — gated on both
  // `NODE_ENV !== "production"` and the `NEXT_PHASE` check below, so
  // neither `next build`'s "Collecting page data" step nor a `next
  // start` production deploy missing `DATABASE_URL` ever reaches this —
  // so it's safe to construct and migrate eagerly here and await the
  // result before a single request is ever served.
  //
  // `process.cwd()` (the project root for `next dev`/`build`/`start`
  // alike) is used instead of `import.meta.dirname` deliberately: unlike
  // `createTestDb`'s condition, "DATABASE_URL is unset" is not statically
  // known to webpack, so this function is not dead-code-eliminated from
  // the production bundle, and `import.meta.dirname` is `undefined` in
  // that compiled server bundle (the same webpack quirk documented on
  // `createTestDb`). That previously crashed `path.resolve` here with
  // "paths[0] argument must be of type string" whenever this ran inside
  // a webpack-bundled context — `process.cwd()` isn't subject to that.
  const migrationsFolder = path.resolve(process.cwd(), "lib/db/migrations");
  const dataDir = path.resolve(process.cwd(), ".data/dev-db");
  // PGlite's file-backed mode does a plain (non-recursive) `mkdir` on the
  // data directory, so it throws ENOENT the first time around if `.data`
  // itself doesn't exist yet. Creating it ourselves, recursively, avoids
  // that; `recursive: true` also makes this a no-op on subsequent runs.
  mkdirSync(dataDir, { recursive: true });
  const client = new PGlite(dataDir);
  const devDb = drizzlePglite(client, { schema });
  await migratePglite(devDb, { migrationsFolder });
  return devDb;
}

/**
 * Inert placeholder used only during `next build`'s "Collecting page
 * data" step when `DATABASE_URL` is unset — i.e. exactly the local-dev
 * case `createLocalDevDb` handles, but inside the one context where
 * actually constructing it is unsafe.
 *
 * That build step `require()`s every route module purely to read static
 * metadata; it never invokes a handler, so nothing ever queries this.
 * But unlike the production branch's "DATABASE_URL is not set" check,
 * "DATABASE_URL is unset" is not something webpack can statically
 * eliminate, so `createLocalDevDb` would otherwise actually run during
 * the build — attempting real filesystem I/O (creating `.data/dev-db`
 * and migrating it) in a context where that's fragile at best (e.g. the
 * parent directory may not exist yet, since PGlite doesn't create it
 * recursively). Swapping in this no-op Proxy for that one phase avoids
 * all of that while leaving real `next dev`/`next start` runtime
 * untouched.
 */
function createInertBuildTimeDb(): ReturnType<typeof drizzlePglite> {
  return new Proxy({} as ReturnType<typeof drizzlePglite>, {
    get(_target, prop) {
      throw new Error(
        `Local dev db placeholder accessed (property: ${String(prop)}). ` +
          "This placeholder only exists to satisfy next build's page-data " +
          "collection and should never actually be queried.",
      );
    },
  });
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

export type DbMode =
  | "test"
  | "production"
  | "build-placeholder"
  | "production-missing-database-url"
  | "local-dev";

/**
 * Pure decision logic for which of the five `db` branches below to take,
 * extracted so the gating itself — in particular, that a production
 * runtime with no `DATABASE_URL` fails loudly instead of silently falling
 * through to the local-dev database — can be unit-tested directly with
 * plain inputs, without needing to reimport `lib/db/client.ts` under
 * different `process.env` values (this module reads `process.env` once,
 * at import time, and the test suite itself always runs with
 * `NODE_ENV=test`).
 *
 * Order matters and mirrors the `db` ternary exactly:
 *  1. `NODE_ENV === "test"` → ephemeral in-memory PGlite, always wins.
 *  2. `DATABASE_URL` set → real (lazy) Neon connection.
 *  3. `NEXT_PHASE === "phase-production-build"` → inert build-time
 *     placeholder, regardless of `NODE_ENV` (the build itself runs with
 *     `NODE_ENV=production`, so this must be checked before case 4).
 *  4. `NODE_ENV === "production"` (and none of the above) → missing
 *     `DATABASE_URL` in a real production runtime; fail loudly via the
 *     same lazy production path/throw as case 2, rather than silently
 *     constructing a throwaway local database that would mask the
 *     misconfiguration and lose data on every restart.
 *  5. Otherwise (`development`, or any other non-test, non-production
 *     value) → file-backed local dev database.
 */
export function selectDbMode({
  nodeEnv,
  databaseUrl,
  nextPhase,
}: {
  nodeEnv: string | undefined;
  databaseUrl: string | undefined;
  nextPhase: string | undefined;
}): DbMode {
  if (nodeEnv === "test") {
    return "test";
  }
  if (databaseUrl) {
    return "production";
  }
  if (nextPhase === "phase-production-build") {
    return "build-placeholder";
  }
  if (nodeEnv === "production") {
    return "production-missing-database-url";
  }
  return "local-dev";
}

const dbMode = selectDbMode({
  nodeEnv: process.env.NODE_ENV,
  databaseUrl: process.env.DATABASE_URL,
  nextPhase: process.env.NEXT_PHASE,
});

export const db =
  dbMode === "test"
    ? await createTestDb()
    : dbMode === "production"
      ? createLazyProductionDb()
      : dbMode === "build-placeholder"
        ? createInertBuildTimeDb()
        : dbMode === "production-missing-database-url"
          ? // Production runtime (`next start`), not the build phase, with
            // `DATABASE_URL` missing from the deployed environment (e.g. a
            // secret-rotation mistake or wrong environment target). Reuse
            // the exact same lazy production path — and therefore the same
            // "DATABASE_URL is not set" throw on first access — as the
            // `"production"` mode above takes when `DATABASE_URL` is set.
            // Falling through to the local file-backed PGlite database
            // here would silently paper over the misconfiguration: the
            // app would appear to work while every request read/wrote a
            // throwaway database that gets wiped on the next
            // deploy/restart, and the real problem would never surface as
            // an error.
            createLazyProductionDb()
          : await createLocalDevDb();
