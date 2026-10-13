import { describe, expect, test } from "vitest";
import { selectDbMode } from "@/lib/db/client";

// `selectDbMode` is the pure gating logic extracted from the `db` export's
// branch selection in lib/db/client.ts. It's tested directly (rather than by
// re-importing lib/db/client.ts under different process.env values) because
// that module reads process.env once, at module-import time, and the whole
// suite runs under vitest's own NODE_ENV=test — so there's no way to observe
// a "real" production/local-dev/build-placeholder import from inside a test.
//
// The case this file exists to pin down: a production runtime (NODE_ENV
// "production") with no DATABASE_URL must fail loudly ("production-missing-
// database-url", which lib/db/client.ts maps to the same lazy-throw
// production path used when DATABASE_URL is set) rather than silently
// falling through to "local-dev" — see the regression this guards against
// in the commit that introduced the local-dev branch (cbb6eb0).
describe("selectDbMode", () => {
  test("NODE_ENV=test always wins, regardless of DATABASE_URL or NEXT_PHASE", () => {
    expect(
      selectDbMode({ nodeEnv: "test", databaseUrl: undefined, nextPhase: undefined }),
    ).toBe("test");
    expect(
      selectDbMode({
        nodeEnv: "test",
        databaseUrl: "postgres://example",
        nextPhase: "phase-production-build",
      }),
    ).toBe("test");
  });

  test("DATABASE_URL set selects the real production db outside test", () => {
    expect(
      selectDbMode({
        nodeEnv: "production",
        databaseUrl: "postgres://example",
        nextPhase: undefined,
      }),
    ).toBe("production");
    expect(
      selectDbMode({
        nodeEnv: "development",
        databaseUrl: "postgres://example",
        nextPhase: undefined,
      }),
    ).toBe("production");
  });

  test("next build's page-data collection gets the inert placeholder regardless of NODE_ENV", () => {
    // `next build` itself runs with NODE_ENV=production, so this case must
    // be checked (and win) ahead of the production-missing-database-url
    // case below, or every build without a provisioned DATABASE_URL would
    // throw instead of collecting page data.
    expect(
      selectDbMode({
        nodeEnv: "production",
        databaseUrl: undefined,
        nextPhase: "phase-production-build",
      }),
    ).toBe("build-placeholder");
  });

  test("production runtime with no DATABASE_URL fails loudly instead of falling back to local-dev", () => {
    expect(
      selectDbMode({ nodeEnv: "production", databaseUrl: undefined, nextPhase: undefined }),
    ).toBe("production-missing-database-url");
    // Also true when NEXT_PHASE is set to something other than the build
    // phase (e.g. unset at real `next start` runtime) — only the exact
    // build-phase string should ever reach the placeholder branch.
    expect(
      selectDbMode({
        nodeEnv: "production",
        databaseUrl: undefined,
        nextPhase: "phase-production-server",
      }),
    ).toBe("production-missing-database-url");
  });

  test("development (or any other non-test, non-production) with no DATABASE_URL uses the local dev db", () => {
    expect(
      selectDbMode({ nodeEnv: "development", databaseUrl: undefined, nextPhase: undefined }),
    ).toBe("local-dev");
    expect(selectDbMode({ nodeEnv: undefined, databaseUrl: undefined, nextPhase: undefined })).toBe(
      "local-dev",
    );
    expect(
      selectDbMode({ nodeEnv: "staging", databaseUrl: undefined, nextPhase: undefined }),
    ).toBe("local-dev");
  });
});
