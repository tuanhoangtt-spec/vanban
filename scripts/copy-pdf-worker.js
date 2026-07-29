// Copies the pdfjs-dist worker file into public/ so it can be referenced by a
// plain string path (e.g. "/pdf.worker.min.mjs") instead of the webpack
// `new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url)` pattern.
//
// Why this exists: Next.js's production build runs Terser over every emitted
// static/media/*.mjs asset it discovers via `new URL(..., import.meta.url)`,
// but the pdfjs-dist worker file is itself an ES module (uses top-level
// `import`/`export`), which Terser's non-module parser rejects with
// "'import', and 'export' cannot be used outside of module code". This is a
// known, unresolved Next.js + pdfjs-dist interaction (see
// https://github.com/vercel/next.js/discussions/61549). Serving the worker
// as a static public file sidesteps the bug entirely and keeps everything
// self-hosted (no CDN dependency, matches the project's $0-server design).
//
// Runs automatically via the "postinstall" script in package.json so the
// copied file always matches whatever pdfjs-dist version is installed.

const fs = require("fs");
const path = require("path");

const SRC = path.join(
  __dirname,
  "..",
  "node_modules",
  "pdfjs-dist",
  "build",
  "pdf.worker.min.mjs"
);
const DEST = path.join(__dirname, "..", "public", "pdf.worker.min.mjs");

try {
  fs.copyFileSync(SRC, DEST);
  console.log(`[copy-pdf-worker] Copied ${SRC} -> ${DEST}`);
} catch (err) {
  console.error(
    "[copy-pdf-worker] Failed to copy pdf.worker.min.mjs from pdfjs-dist. " +
      "Cropping images from PDF uploads will not work until this file exists " +
      "at public/pdf.worker.min.mjs. Original error:",
    err
  );
  // Don't fail `npm install` over this — most other features still work
  // without it, and the error above makes the cause obvious.
}
