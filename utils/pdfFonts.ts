// PDF export needs a font embedded in the file itself (jsPDF's built-in fonts
// don't cover Vietnamese diacritics). We ship Liberation Serif — Apache-2.0
// licensed, metrically compatible with Times New Roman (same glyph widths,
// so line breaks/pagination match the .docx output), with full coverage of
// Vietnamese combining diacritics. Actual "Times New Roman" can't be
// redistributed (it's a commercial Microsoft font), so this is the closest
// legally-shippable equivalent.

export const PDF_FONT_FAMILY = "LiberationSerif";

type FontVariant = "normal" | "bold" | "italic" | "bolditalic";

const FONT_FILES: Record<FontVariant, string> = {
  normal: "/fonts/LiberationSerif-Regular.ttf",
  bold: "/fonts/LiberationSerif-Bold.ttf",
  italic: "/fonts/LiberationSerif-Italic.ttf",
  bolditalic: "/fonts/LiberationSerif-BoldItalic.ttf",
};

let cache: Promise<Record<FontVariant, string>> | null = null;

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000; // avoid call-stack blowups on large files
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

async function fetchBase64(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Không tải được font PDF (${url}): HTTP ${res.status}`);
  }
  return arrayBufferToBase64(await res.arrayBuffer());
}

/** Fetches all four font variants once and caches the result for the session. */
export function loadPdfFontsBase64(): Promise<Record<FontVariant, string>> {
  if (!cache) {
    cache = (async () => {
      const entries = await Promise.all(
        (Object.entries(FONT_FILES) as [FontVariant, string][]).map(
          async ([variant, url]) => [variant, await fetchBase64(url)] as const
        )
      );
      return Object.fromEntries(entries) as Record<FontVariant, string>;
    })();
  }
  return cache;
}

/** Registers the embedded font on a jsPDF document instance. */
export async function registerPdfFont(doc: import("jspdf").jsPDF) {
  const fonts = await loadPdfFontsBase64();
  doc.addFileToVFS("LiberationSerif-Regular.ttf", fonts.normal);
  doc.addFont("LiberationSerif-Regular.ttf", PDF_FONT_FAMILY, "normal");
  doc.addFileToVFS("LiberationSerif-Bold.ttf", fonts.bold);
  doc.addFont("LiberationSerif-Bold.ttf", PDF_FONT_FAMILY, "bold");
  doc.addFileToVFS("LiberationSerif-Italic.ttf", fonts.italic);
  doc.addFont("LiberationSerif-Italic.ttf", PDF_FONT_FAMILY, "italic");
  doc.addFileToVFS("LiberationSerif-BoldItalic.ttf", fonts.bolditalic);
  doc.addFont("LiberationSerif-BoldItalic.ttf", PDF_FONT_FAMILY, "bolditalic");
  doc.setFont(PDF_FONT_FAMILY, "normal");
}
