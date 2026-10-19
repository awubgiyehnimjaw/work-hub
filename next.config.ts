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
  // `@react-pdf/renderer` (used to render invoice PDFs in
  // lib/invoices/pdf.tsx) has the same category of issue as
  // `@electric-sql/pglite` above: its package.json maps its main entry
  // through a `"browser"` field to a browser-only build. If webpack
  // bundles it into the server build and picks up that mapping, the
  // library loses the Node-native (pdfkit/fontkit) code path it needs to
  // read font/asset files from disk. Excluding it from bundling makes
  // Next load it via a plain `require()` at runtime instead, same as
  // pglite.
  serverExternalPackages: ["@electric-sql/pglite", "@react-pdf/renderer"],
};

export default nextConfig;
