import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // `@electric-sql/pglite` (used for the file-backed local dev database
  // in lib/db/client.ts) ships Node-native filesystem code behind a
  // `"browser"` package.json field that maps `fs`/`path`/`url` to
  // `false`. When webpack bundles it into the server build anyway, that
  // mapping breaks its on-disk (non-in-memory) mode at runtime with
  // obscure "path argument must be ... URL" errors. Excluding it from
  // bundling makes Next load it via a plain `require()` at runtime
  // instead, identical to how it behaves in a non-bundled Node script.
  serverExternalPackages: ["@electric-sql/pglite"],
};

export default nextConfig;
