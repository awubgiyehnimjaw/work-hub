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
  //
  // `pdfkit` (a transitive dependency of `@react-pdf/renderer`, used to
  // render invoice PDFs) loads its 14 standard font files (Helvetica,
  // Times, Courier, etc.) through Node's package.json `"imports"`
  // subpath-import feature (`#standard-fonts/*` → `./js/standard-fonts/
  // *.cjs`) — confirmed by reading node_modules/pdfkit/package.json and
  // pdfkit.js directly. `@vercel/nft`'s static analysis doesn't follow
  // this resolution pattern, so none of these font files were making it
  // into the deployed function: every real invoice PDF request in
  // production failed with `Cannot find module
  // '.../pdfkit/js/standard-fonts/Helvetica.cjs'` (confirmed via
  // `vercel logs`), even though the exact same code worked in `next dev`
  // and `next build` locally (the whole repo is on disk there, so the
  // broken resolution never surfaces). This line forces the whole
  // directory in rather than naming individual fonts, since which fonts
  // get used can change as the PDF layout evolves.
  outputFileTracingIncludes: {
    "/api/invoices/[id]/pdf": ["./public/invoice/**", "./node_modules/pdfkit/js/standard-fonts/**"],
  },
};

export default nextConfig;
