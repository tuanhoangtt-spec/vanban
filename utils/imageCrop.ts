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

// Page orientation is deliberately NOT something we ask Gemini for: it's
// determined straight from the geometry of the actual uploaded file, which
// is both more reliable and free (no extra model round-trip). This is a
// single, document-level value — see the "orientation" field on
// ParsedDocument — not a per-page one. Real Vietnamese exam/form documents
// are essentially always uniformly one orientation throughout; supporting
// genuinely mixed portrait+landscape pages within a single export would
// require multi-section .docx output and a per-page jsPDF format, which is
// a lot of added complexity for a case that hasn't been observed in
// practice. If that turns out to be needed later, this is the function to
// extend (return an array indexed by page instead of one value).
export async function detectDocumentOrientation(file: File): Promise<"portrait" | "landscape"> {
  const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);

  if (isPdf) {
    try {
      const pdfjs = await getPdfjs();
      const buf = await file.arrayBuffer();
      const pdf = await pdfjs.getDocument({ data: buf }).promise;
      let landscapeVotes = 0;
      let portraitVotes = 0;
      // Majority vote across pages (cheap: viewport only, no rendering) in
      // case a handful of pages are rotated/scanned oddly but most aren't.
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const { width, height } = page.getViewport({ scale: 1 });
        if (width > height) landscapeVotes++;
        else portraitVotes++;
      }
      return landscapeVotes > portraitVotes ? "landscape" : "portrait";
    } catch (err) {
      console.error("Không xác định được khổ giấy của PDF, dùng mặc định dọc:", err);
      return "portrait";
    }
  }

  try {
    const img = await loadImageFile(file);
    return img.naturalWidth > img.naturalHeight ? "landscape" : "portrait";
  } catch (err) {
    console.error("Không xác định được khổ giấy của ảnh, dùng mặc định dọc:", err);
    return "portrait";
  }
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

// A crop is considered "clipped" when its actual ink content runs edge-to-
// edge on an axis (near-zero margin on BOTH sides of that axis) — found via
// real testing on a *different* file (a page with two stacked multiple-
// choice graphs): the bbox for the second graph was not blank, it had real
// pixels, but was badly undersized on one axis, slicing straight through
// the figure. Reconstructing the actual bbox Gemini used (by comparing the
// exported crop's pixel dimensions against the source image's true
// dimensions) showed both graphs on that page were given the exact same
// bbox HEIGHT fraction (~0.18) regardless of their very different true
// sizes — evidence the model was reusing a rough template rather than
// measuring each figure. Because rule 14 already tells Gemini to err
// generous (pad the box rather than cut it tight), *any* crop whose content
// touches both edges of an axis with ~zero margin contradicts that
// instruction and is a reliable signal the box was too tight on that axis,
// independent of whether it's also blank.
const INK_LUMINANCE_THRESHOLD = 200;
const EDGE_TOUCH_MARGIN_FRACTION = 0.03;

interface CropContentAnalysis {
  blank: boolean;
  /** true if ink runs edge-to-edge (near-zero margin both sides) on the X or Y axis */
  clipped: boolean;
}

function analyzeCropContent(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number
): CropContentAnalysis {
  const step = Math.max(1, Math.floor(Math.min(width, height) / 80)); // up to ~80x80 sample grid
  const samples: number[] = [];
  let minXFrac = 1;
  let maxXFrac = 0;
  let minYFrac = 1;
  let maxYFrac = 0;
  let hasInk = false;

  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const [r, g, b] = ctx.getImageData(x, y, 1, 1).data;
      const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
      samples.push(luminance);
      if (luminance < INK_LUMINANCE_THRESHOLD) {
        hasInk = true;
        minXFrac = Math.min(minXFrac, x / width);
        maxXFrac = Math.max(maxXFrac, x / width);
        minYFrac = Math.min(minYFrac, y / height);
        maxYFrac = Math.max(maxYFrac, y / height);
      }
    }
  }

  if (samples.length < 4) return { blank: false, clipped: false }; // too small to judge, don't block it

  const mean = samples.reduce((a, v) => a + v, 0) / samples.length;
  const variance = samples.reduce((a, v) => a + (v - mean) ** 2, 0) / samples.length;
  const blank = Math.sqrt(variance) < BLANK_CROP_STD_THRESHOLD;
  if (blank || !hasInk) return { blank: true, clipped: false };

  const touchesX = minXFrac < EDGE_TOUCH_MARGIN_FRACTION && 1 - maxXFrac < EDGE_TOUCH_MARGIN_FRACTION;
  const touchesY = minYFrac < EDGE_TOUCH_MARGIN_FRACTION && 1 - maxYFrac < EDGE_TOUCH_MARGIN_FRACTION;
  return { blank: false, clipped: touchesX || touchesY };
}

function cropCanvasRegion(
  source: HTMLCanvasElement | HTMLImageElement,
  sourceWidth: number,
  sourceHeight: number,
  bbox: ImageBlock["bbox"]
): { dataUrl: string; analysis: CropContentAnalysis } {
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
  return { dataUrl: out.toDataURL("image/png"), analysis: analyzeCropContent(ctx, out.width, out.height) };
}

// Grows a bbox around its own center, clamped to stay inside the page
// (0..1). Used to recover from a blank or clipped crop: keep the model's
// estimate of *where roughly* the figure is, but widen the net in case the
// exact coordinates or size were off.
function expandBbox(bbox: ImageBlock["bbox"], factor: number): ImageBlock["bbox"] {
  const cx = bbox.x + bbox.width / 2;
  const cy = bbox.y + bbox.height / 2;
  const w = Math.min(1, bbox.width * factor);
  const h = Math.min(1, bbox.height * factor);
  const x = Math.max(0, Math.min(1 - w, cx - w / 2));
  const y = Math.max(0, Math.min(1 - h, cy - h / 2));
  return { x, y, width: w, height: h };
}

// Same expansion ladder covers both failure modes found via real testing:
// blank (bbox missed the figure entirely, see README §19-20) and clipped
// (bbox found the figure but sliced through it, see README §21). Both were
// observed specifically on the SECOND of two figures stacked vertically on
// one page, across two unrelated source files — reproducible enough to
// treat as a systematic model tendency, not one-off noise.
const RECOVERY_FACTORS = [1, 1.6, 2.2, 3];

function cropWithRecovery(
  source: HTMLCanvasElement | HTMLImageElement,
  sourceWidth: number,
  sourceHeight: number,
  bbox: ImageBlock["bbox"]
): string {
  let bestClippedFallback: string | null = null;
  for (const factor of RECOVERY_FACTORS) {
    const tryBbox = factor === 1 ? bbox : expandBbox(bbox, factor);
    const { dataUrl, analysis } = cropCanvasRegion(source, sourceWidth, sourceHeight, tryBbox);
    if (analysis.blank) continue; // keep expanding, hoping to land on real content
    if (!analysis.clipped) return dataUrl; // clean, non-blank, margins on all sides — done
    // Non-blank but still edge-touching: better than nothing, but keep
    // trying wider in case a bigger box clears the edges entirely. Remember
    // the largest attempt so far as a fallback in case nothing ever clears.
    bestClippedFallback = dataUrl;
  }
  if (bestClippedFallback) return bestClippedFallback;
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
      const dataUrl = cropWithRecovery(source, width, height, block.bbox);
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
