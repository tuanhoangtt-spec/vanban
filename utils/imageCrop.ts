// Gemini only ever returns a bounding box for graphic regions (see rule 14
// in geminiPrompt.ts) — never image bytes, since inlining a base64 crop back
// into its own JSON response would be wasteful and error-prone for a vision
// model. This module does the actual cropping, client-side, straight out of
// the file the user uploaded, once we know *where* to look.
//
// Runs entirely in the browser: image uploads are cropped directly via
// <canvas>; PDF uploads are first rasterized to a canvas with pdfjs-dist
// (only the specific page a block references, not the whole document) and
// then cropped the same way.

import type { DocumentBlock, ImageBlock, ParsedDocument } from "@/types";

let pdfjsLibPromise: Promise<typeof import("pdfjs-dist")> | null = null;

async function getPdfjs() {
  if (!pdfjsLibPromise) {
    pdfjsLibPromise = import("pdfjs-dist").then((lib) => {
      // Deliberately NOT `new URL("pdfjs-dist/build/pdf.worker.min.mjs",
      // import.meta.url)`: that form makes Next.js's production build emit
      // the worker as a static/media/*.mjs asset and then run Terser over
      // it, which fails because the worker file itself is an ES module
      // (top-level import/export) and Terser's default (non-module) parser
      // rejects that syntax. This is a known, still-unresolved Next.js +
      // pdfjs-dist interaction — see
      // https://github.com/vercel/next.js/discussions/61549
      //
      // Instead we serve the worker as a plain static file from `public/`
      // (copied there automatically by scripts/copy-pdf-worker.js via the
      // "postinstall" npm script) and point pdfjs at it with an ordinary
      // string path. Webpack never touches this file, so the bug doesn't
      // apply, and we stay CDN-free.
      lib.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
      return lib;
    });
  }
  return pdfjsLibPromise;
}

// scale=2 keeps crops crisp on a typical printed A4 page (roughly 150dpi)
// without generating enormous canvases for large multi-page PDFs.
const PDF_RENDER_SCALE = 2;

async function renderPdfPageToCanvas(file: File, pageNumber: number): Promise<HTMLCanvasElement> {
  const pdfjs = await getPdfjs();
  const buf = await file.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data: buf }).promise;
  const page = await pdf.getPage(pageNumber);
  const viewport = page.getViewport({ scale: PDF_RENDER_SCALE });

  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Không tạo được canvas để dựng trang PDF.");

  await page.render({ canvasContext: ctx, viewport }).promise;
  return canvas;
}

function loadImageFile(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Không đọc được ảnh gốc để cắt hình minh họa."));
    };
    img.src = url;
  });
}

// A crop is considered "blank" (i.e. the bbox almost certainly missed the
// actual figure and landed on empty page margin) when its pixels are nearly
// uniform. Found via real testing: on a page with two stacked diagrams,
// Gemini's bbox for the second one was accurate in size/shape but landed a
// bit off vertically, producing a technically-valid but completely blank
// PNG — no thrown error, so it silently made it all the way into the
// exported .docx as an empty white box.
//
// A real diagram (even a simple line drawing: axes + one curve) always
// covers a nontrivial fraction of pixels with ink, so its luminance std
// deviation is comfortably above this threshold; only truly blank/near-
// solid-color regions fall under it. Sampling a grid of points (not every
// pixel) keeps this fast even on larger crops.
const BLANK_CROP_STD_THRESHOLD = 2.5;

function isCropBlank(ctx: CanvasRenderingContext2D, width: number, height: number): boolean {
  const step = Math.max(1, Math.floor(Math.min(width, height) / 64)); // ~64x64 sample grid max
  const samples: number[] = [];
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const [r, g, b] = ctx.getImageData(x, y, 1, 1).data;
      samples.push(0.299 * r + 0.587 * g + 0.114 * b); // perceptual luminance
    }
  }
  if (samples.length < 4) return false; // too small to judge reliably, don't block it
  const mean = samples.reduce((a, v) => a + v, 0) / samples.length;
  const variance = samples.reduce((a, v) => a + (v - mean) ** 2, 0) / samples.length;
  return Math.sqrt(variance) < BLANK_CROP_STD_THRESHOLD;
}

function cropCanvasRegion(
  source: HTMLCanvasElement | HTMLImageElement,
  sourceWidth: number,
  sourceHeight: number,
  bbox: ImageBlock["bbox"]
): { dataUrl: string; blank: boolean } {
  const sx = Math.max(0, bbox.x) * sourceWidth;
  const sy = Math.max(0, bbox.y) * sourceHeight;
  const sw = Math.min(1 - Math.max(0, bbox.x), bbox.width) * sourceWidth;
  const sh = Math.min(1 - Math.max(0, bbox.y), bbox.height) * sourceHeight;

  const out = document.createElement("canvas");
  out.width = Math.max(1, Math.round(sw));
  out.height = Math.max(1, Math.round(sh));
  const ctx = out.getContext("2d");
  if (!ctx) throw new Error("Không tạo được canvas để cắt hình minh họa.");
  ctx.drawImage(source, sx, sy, sw, sh, 0, 0, out.width, out.height);
  return { dataUrl: out.toDataURL("image/png"), blank: isCropBlank(ctx, out.width, out.height) };
}

// Grows a bbox around its own center, clamped to stay inside the page
// (0..1). Used to recover from a blank crop: keep the model's estimate of
// *where roughly* the figure is, but widen the net in case the exact
// coordinates were a bit off.
function expandBbox(bbox: ImageBlock["bbox"], factor: number): ImageBlock["bbox"] {
  const cx = bbox.x + bbox.width / 2;
  const cy = bbox.y + bbox.height / 2;
  const w = Math.min(1, bbox.width * factor);
  const h = Math.min(1, bbox.height * factor);
  const x = Math.max(0, Math.min(1 - w, cx - w / 2));
  const y = Math.max(0, Math.min(1 - h, cy - h / 2));
  return { x, y, width: w, height: h };
}

// Found via real testing: on a page with two stacked diagrams, Gemini's
// bbox for the second one landed squarely on blank page background below
// the actual figure — same failure, reproducibly, across repeat scans of
// the same file. The exact crop wasn't recoverable by asking the model
// again, but the true figure was always just outside the guessed box.
//
// So instead of giving up on the first blank result, grow the crop around
// the SAME center a few times before falling back to a text placeholder.
// Verified against the real source page for this exact failure: a
// simulated off-by-~6%-of-page-height bbox (pure white, std ≈ 0) recovers
// real figure content (std jumps to ~24, far above BLANK_CROP_STD_THRESHOLD)
// already at the very first expansion (1.6x) — see README section 20.
const BLANK_RECOVERY_FACTORS = [1, 1.6, 2.2, 3];

function cropWithBlankRecovery(
  source: HTMLCanvasElement | HTMLImageElement,
  sourceWidth: number,
  sourceHeight: number,
  bbox: ImageBlock["bbox"]
): string {
  for (const factor of BLANK_RECOVERY_FACTORS) {
    const tryBbox = factor === 1 ? bbox : expandBbox(bbox, factor);
    const { dataUrl, blank } = cropCanvasRegion(source, sourceWidth, sourceHeight, tryBbox);
    if (!blank) return dataUrl;
  }
  // Every attempt, including the widest, came back blank — this genuinely
  // looks like empty page space rather than a slightly-off bbox. Don't
  // return a blank image; let the caller fall back to the text placeholder.
  throw new Error(
    "Vùng cắt vẫn trắng ngay cả sau khi mở rộng nhiều lần — bbox nhiều khả năng trỏ vào vùng thật sự không có hình."
  );
}

// Crops every "image" block in `doc` that doesn't already have a dataUrl,
// using `file` (the exact File the user uploaded) as the pixel source.
// Non-image blocks pass through untouched. Safe to call multiple times —
// blocks that already have a dataUrl are left alone.
export async function cropImageBlocks(file: File, doc: ParsedDocument): Promise<ParsedDocument> {
  const imageBlocks = doc.blocks.filter(
    (b): b is ImageBlock => b.type === "image" && !b.dataUrl
  );
  if (imageBlocks.length === 0) return doc;

  const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);

  // Cache rendered PDF pages so a document with several graphics on the
  // same page only rasterizes that page once.
  const pageCanvasCache = new Map<number, HTMLCanvasElement>();
  const imageElementCache: { el: HTMLImageElement | null } = { el: null };

  async function getCropSource(pageNumber: number) {
    if (isPdf) {
      let canvas = pageCanvasCache.get(pageNumber);
      if (!canvas) {
        canvas = await renderPdfPageToCanvas(file, pageNumber);
        pageCanvasCache.set(pageNumber, canvas);
      }
      return { source: canvas, width: canvas.width, height: canvas.height };
    }
    if (!imageElementCache.el) {
      imageElementCache.el = await loadImageFile(file);
    }
    const img = imageElementCache.el;
    return { source: img, width: img.naturalWidth, height: img.naturalHeight };
  }

  const newBlocks: DocumentBlock[] = [];
  for (const block of doc.blocks) {
    if (block.type !== "image" || block.dataUrl) {
      newBlocks.push(block);
      continue;
    }
    try {
      const { source, width, height } = await getCropSource(block.page ?? 1);
      const dataUrl = cropWithBlankRecovery(source, width, height, block.bbox);
      newBlocks.push({ ...block, dataUrl });
    } catch (err) {
      // Cropping failure (corrupt bbox, unreadable page...) shouldn't break
      // the whole export — fall back to no image; the generators already
      // know how to render an "image" block with no dataUrl as a text
      // placeholder, same as before this feature existed.
      console.error("Không cắt được hình minh họa:", err);
      newBlocks.push(block);
    }
  }

  return { blocks: newBlocks };
}
