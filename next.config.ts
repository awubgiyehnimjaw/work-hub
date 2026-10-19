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
  // lib/invoices/pdf.tsx reads public/invoice/logo.png and
  // public/invoice/paynow-qr.png at runtime via plain `fs` reads
  // (`path.resolve(process.cwd(), ...)`), not a static import or
  // `<Image>` component. Vercel's file-tracing (`@vercel/nft`) determines
  // which files get bundled into each serverless function by statically
  // analyzing the code, and a runtime-constructed path string isn't
  // always picked up — so without this, the PDF download route could
  // work in `next dev`/`next build` locally (where the whole repo is on
  // disk) but 404/throw on Vercel when those two PNGs aren't included in
  // its function's deployment bundle. This explicitly forces them in.
  outputFileTracingIncludes: {
    "/api/invoices/[id]/pdf": ["./public/invoice/**"],
  },
};

export default nextConfig;
