import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  // tsconfig.json sets `"jsx": "preserve"` for Next's own SWC-based JSX
  // transform, but Vite's transform pipeline respects that setting too and
  // then fails to parse any .tsx file it loads directly (e.g.
  // lib/invoices/pdf.tsx, imported by tests/invoices/pdf.test.ts) since
  // "preserve" leaves raw JSX syntax in place for a later compiler step
  // that never runs here. Vite 7's default oxc-based transform reads the
  // same tsconfig setting and ignores an `esbuild.jsx` override, so both
  // are set: `oxc: false` falls back to the esbuild transform, which then
  // honors `esbuild.jsx: "automatic"` to compile JSX itself — without
  // touching tsconfig.json's Next-facing setting.
  oxc: false,
  esbuild: {
    jsx: "automatic",
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "."),
    },
  },
});
