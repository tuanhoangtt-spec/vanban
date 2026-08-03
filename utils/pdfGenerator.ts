import { jsPDF } from "jspdf";
import { autoTable } from "jspdf-autotable";
import { saveAs } from "file-saver";
import { registerPdfFont, PDF_FONT_FAMILY } from "./pdfFonts";
import type {
  ParsedDocument,
  DocumentBlock,
  BlockAlignment,
  TableCell,
  MathNode,
} from "@/types";
import { splitInlineMath, hasTallMath } from "./mathParser";
import { measureMath, drawMath } from "./pdfMath";
import { textWithMathToPlain } from "./mathPlainText";

// Mirrors the fixed office formatting used in docxGenerator.ts, translated
// to jsPDF's mm/pt units, so the PDF and the Word export read the same way.
//
// These are `let`, not `const`: buildPdf() reassigns them once at the top,
// based on document.orientation (detected client-side from the source
// file's own page geometry — see utils/imageCrop.ts). Every draw* function
// below reads them at call time (normal JS closure lookup), so setting them
// before any drawBlock() call is enough to make the whole export landscape
// — no need to thread a layout object through every function signature.
// This is a document-level switch, not per-page.
const A4_SHORT_MM = 210;
const A4_LONG_MM = 297;
let PAGE_WIDTH_MM = A4_SHORT_MM; // portrait by default
let PAGE_HEIGHT_MM = A4_LONG_MM;
const MARGIN_MM = 20; // 2cm
let CONTENT_WIDTH_MM = PAGE_WIDTH_MM - MARGIN_MM * 2;
let CONTENT_BOTTOM_MM = PAGE_HEIGHT_MM - MARGIN_MM;

const FONT_SIZE_PT = 14;
const HEADING_SIZE_PT = 16;
const LINE_HEIGHT_MM = 6.2;
const BLOCK_GAP_MM = 3;

type FontStyle = "normal" | "bold" | "italic" | "bolditalic";

function jsAlign(a?: BlockAlignment): "left" | "center" | "right" | "justify" {
  switch (a) {
    case "center":
      return "center";
    case "right":
      return "right";
    case "justify":
      return "justify";
    default:
      return "left";
  }
}

class PdfCursor {
  y = MARGIN_MM;
  constructor(private doc: jsPDF) {}

  ensureSpace(neededMm: number) {
    if (this.y + neededMm > CONTENT_BOTTOM_MM) {
      this.doc.addPage("a4", PAGE_WIDTH_MM > PAGE_HEIGHT_MM ? "landscape" : "portrait");
      this.y = MARGIN_MM;
    }
  }

  advance(mm: number) {
    this.y += mm;
  }

  forcePageBreak() {
    this.doc.addPage("a4", PAGE_WIDTH_MM > PAGE_HEIGHT_MM ? "landscape" : "portrait");
    this.y = MARGIN_MM;
  }
}

// ---- inline text + math layout ----------------------------------------
// jsPDF has no OMML support, so paragraphs/headings that may contain "$...$"
// formulas are laid out manually: text is tokenized into words/spaces/math
// atoms, wrapped to CONTENT_WIDTH_MM, and drawn token by token so a formula
// never gets cut mid-expression. Lines that contain a "tall" construct
// (fraction, root, sub/superscript, sum, integral) get extra line height so
// they don't collide with the line above/below.

type InlineToken =
  | { kind: "word"; text: string; bold?: boolean; italic?: boolean }
  | { kind: "space"; bold?: boolean; italic?: boolean }
  | { kind: "math"; nodes: MathNode[] };

type InlineRun = { text: string; bold?: boolean; italic?: boolean };

function tokenizeRuns(runs: InlineRun[]): InlineToken[] {
  const out: InlineToken[] = [];
  for (const run of runs) {
    for (const seg of splitInlineMath(run.text ?? "")) {
      if (seg.kind === "math") {
        out.push({ kind: "math", nodes: seg.nodes });
        continue;
      }
      const parts = seg.value.split(/(\s+)/).filter((p) => p.length > 0);
      for (const p of parts) {
        if (/^\s+$/.test(p)) out.push({ kind: "space", bold: run.bold, italic: run.italic });
        else out.push({ kind: "word", text: p, bold: run.bold, italic: run.italic });
      }
    }
  }
  return out;
}

function tokenWidth(doc: jsPDF, token: InlineToken, sizePt: number): number {
  if (token.kind === "math") return measureMath({ doc }, token.nodes, sizePt);
  doc.setFont(PDF_FONT_FAMILY, token.bold ? "bold" : token.italic ? "italic" : "normal");
  doc.setFontSize(sizePt);
  return doc.getTextWidth(token.kind === "space" ? " " : token.text);
}

function tokenIsTall(token: InlineToken): boolean {
  if (token.kind !== "math") return false;
  const tall = new Set(["frac", "sqrt", "nthroot", "sup", "sub", "subsup", "sum", "int", "lim"]);
  const walk = (nodes: MathNode[]): boolean =>
    nodes.some((n) => tall.has(n.t) || (n.t === "func" && walk(n.children)) || (n.t === "group" && walk(n.children)));
  return walk(token.nodes);
}

function wrapTokens(doc: jsPDF, tokens: InlineToken[], sizePt: number, maxWidthMm: number): InlineToken[][] {
  const lines: InlineToken[][] = [];
  let line: InlineToken[] = [];
  let lineWidth = 0;

  for (const token of tokens) {
    const w = tokenWidth(doc, token, sizePt);
    if (line.length > 0 && lineWidth + w > maxWidthMm) {
      // trim a trailing space before pushing
      if (line[line.length - 1]?.kind === "space") line.pop();
      lines.push(line);
      line = [];
      lineWidth = 0;
      if (token.kind === "space") continue; // don't start a new line with a space
    }
    line.push(token);
    lineWidth += w;
  }
  if (line.length > 0) {
    if (line[line.length - 1]?.kind === "space") line.pop();
    lines.push(line);
  }
  return lines.length > 0 ? lines : [[]];
}

function drawInlineRuns(
  doc: jsPDF,
  cursor: PdfCursor,
  runs: InlineRun[],
  opts: { align: BlockAlignment; sizePt?: number }
) {
  const sizePt = opts.sizePt ?? FONT_SIZE_PT;
  const tokens = tokenizeRuns(runs);
  const lines = wrapTokens(doc, tokens, sizePt, CONTENT_WIDTH_MM);
  const align = jsAlign(opts.align);

  lines.forEach((line, lineIdx) => {
    const tall = line.some(tokenIsTall);
    const lineHeight = tall ? LINE_HEIGHT_MM * 1.65 : LINE_HEIGHT_MM;
    const topPad = tall ? LINE_HEIGHT_MM * 0.55 : 0;
    cursor.ensureSpace(lineHeight + topPad);
    cursor.advance(topPad);

    const widths = line.map((t) => tokenWidth(doc, t, sizePt));
    const contentWidth = widths.reduce((a, b) => a + b, 0);

    let startX = MARGIN_MM;
    let extraPerSpace = 0;
    if (align === "center") startX = MARGIN_MM + (CONTENT_WIDTH_MM - contentWidth) / 2;
    else if (align === "right") startX = MARGIN_MM + CONTENT_WIDTH_MM - contentWidth;
    else if (align === "justify" && lineIdx < lines.length - 1) {
      const spaceCount = line.filter((t) => t.kind === "space").length;
      if (spaceCount > 0) extraPerSpace = Math.max(0, (CONTENT_WIDTH_MM - contentWidth) / spaceCount);
    }

    let x = startX;
    for (let i = 0; i < line.length; i++) {
      const token = line[i];
      if (token.kind === "math") {
        x = drawMath({ doc }, x, cursor.y, token.nodes, sizePt);
      } else if (token.kind === "word") {
        doc.setFont(PDF_FONT_FAMILY, token.bold ? "bold" : token.italic ? "italic" : "normal");
        doc.setFontSize(sizePt);
        doc.text(token.text, x, cursor.y);
        x += widths[i];
      } else {
        x += widths[i] + extraPerSpace;
      }
    }

    cursor.advance(lineHeight);
  });
}

function drawHeading(doc: jsPDF, cursor: PdfCursor, block: Extract<DocumentBlock, { type: "heading" }>) {
  drawInlineRuns(doc, cursor, [{ text: block.content, bold: block.bold ?? true }], {
    align: block.alignment ?? "center",
    sizePt: block.level === 1 ? HEADING_SIZE_PT : FONT_SIZE_PT,
  });
  cursor.advance(BLOCK_GAP_MM);
}

function drawParagraph(doc: jsPDF, cursor: PdfCursor, block: Extract<DocumentBlock, { type: "paragraph" }>) {
  drawInlineRuns(doc, cursor, block.runs, { align: block.alignment ?? "justify" });
  cursor.advance(BLOCK_GAP_MM * 0.6);
}

function drawDottedLine(doc: jsPDF, cursor: PdfCursor, block: Extract<DocumentBlock, { type: "dotted_line" }>) {
  cursor.ensureSpace(LINE_HEIGHT_MM);
  doc.setFontSize(FONT_SIZE_PT);

  const label = `${textWithMathToPlain(block.label ?? "").trim()}${(block.label ?? "").trim().endsWith(":") ? "" : ":"} `;
  const value = textWithMathToPlain(block.value ?? "").trim();

  doc.setFont(PDF_FONT_FAMILY, "normal");
  doc.text(label, MARGIN_MM, cursor.y);
  const labelWidth = doc.getTextWidth(label);

  doc.setFont(PDF_FONT_FAMILY, "bold");
  const valueWidth = value ? doc.getTextWidth(value) : 0;
  const valueX = MARGIN_MM + CONTENT_WIDTH_MM - valueWidth;

  const dotsStart = MARGIN_MM + labelWidth + 1;
  const dotsEnd = valueX - 1;
  if (dotsEnd > dotsStart) {
    doc.setLineDashPattern([0.4, 0.9], 0);
    doc.setLineWidth(0.15);
    doc.line(dotsStart, cursor.y - 1, dotsEnd, cursor.y - 1);
    doc.setLineDashPattern([], 0);
  }

  if (value) {
    doc.text(value, valueX, cursor.y);
  }

  cursor.advance(LINE_HEIGHT_MM + BLOCK_GAP_MM * 0.4);
}

function drawTable(doc: jsPDF, cursor: PdfCursor, block: Extract<DocumentBlock, { type: "table" }>) {
  const rows = block.rows.length > 0 ? block.rows : [[{ content: "" } as TableCell]];
  const body = rows.map((row) => row.map((cell) => textWithMathToPlain(cell.content ?? "")));
  const styleMap = new Map<string, { bold?: boolean; align?: BlockAlignment }>();
  rows.forEach((row, r) =>
    row.forEach((cell, c) => styleMap.set(`${r}-${c}`, { bold: cell.bold, align: cell.alignment }))
  );

  autoTable(doc, {
    body,
    startY: cursor.y,
    margin: { left: MARGIN_MM, right: MARGIN_MM, bottom: MARGIN_MM },
    tableWidth: CONTENT_WIDTH_MM,
    theme: "grid",
    styles: {
      font: PDF_FONT_FAMILY,
      fontSize: FONT_SIZE_PT,
      cellPadding: 1.5,
      lineColor: [0, 0, 0],
      lineWidth: 0.15,
      textColor: [0, 0, 0],
      valign: "top",
    },
    didParseCell: (data) => {
      const style = styleMap.get(`${data.row.index}-${data.column.index}`);
      if (style?.bold) data.cell.styles.fontStyle = "bold";
      if (style?.align) data.cell.styles.halign = jsAlign(style.align) as any;
    },
  });

  cursor.y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + BLOCK_GAP_MM;
}

function drawSignatureRow(doc: jsPDF, cursor: PdfCursor, block: Extract<DocumentBlock, { type: "signature_row" }>) {
  const colCount = block.columns.length || 2;
  const colWidth = CONTENT_WIDTH_MM / colCount;
  const blockHeight = LINE_HEIGHT_MM * 2 + 16; // title(+subtitle) + signing gap + name
  cursor.ensureSpace(blockHeight);

  block.columns.forEach((col, i) => {
    const centerX = MARGIN_MM + colWidth * i + colWidth / 2;
    let y = cursor.y;

    doc.setFont(PDF_FONT_FAMILY, "bold");
    doc.setFontSize(FONT_SIZE_PT);
    doc.text(textWithMathToPlain(col.title), centerX, y, { align: "center" });
    y += LINE_HEIGHT_MM;

    if (col.subtitle) {
      doc.setFont(PDF_FONT_FAMILY, "italic");
      doc.setFontSize(FONT_SIZE_PT - 2);
      doc.text(textWithMathToPlain(col.subtitle), centerX, y, { align: "center" });
      y += LINE_HEIGHT_MM;
    }

    y += 14; // space reserved for the physical signature

    doc.setFont(PDF_FONT_FAMILY, "bold");
    doc.setFontSize(FONT_SIZE_PT);
    doc.text(textWithMathToPlain(col.name ?? ""), centerX, y, { align: "center" });
  });

  cursor.advance(blockHeight);
}

function drawImage(doc: jsPDF, cursor: PdfCursor, block: Extract<DocumentBlock, { type: "image" }>) {
  if (!block.dataUrl) {
    // Cropping hasn't run yet (or failed) — same text placeholder the app
    // used before "image" blocks existed, so nothing is silently dropped.
    drawInlineRuns(
      doc,
      cursor,
      [{ text: `[Hình minh họa${block.caption ? ": " + block.caption : ""}]`, italic: true }],
      { align: block.alignment ?? "left" }
    );
    cursor.advance(BLOCK_GAP_MM * 0.6);
    return;
  }

  try {
    const props = doc.getImageProperties(block.dataUrl);
    const maxWidthMm = CONTENT_WIDTH_MM;
    const maxHeightMm = 120; // cap so one figure can't consume the whole page
    let wMm = maxWidthMm;
    let hMm = (props.height / props.width) * wMm;
    if (hMm > maxHeightMm) {
      hMm = maxHeightMm;
      wMm = (props.width / props.height) * hMm;
    }

    cursor.ensureSpace(hMm + BLOCK_GAP_MM);
    const align = block.alignment ?? "center";
    let x = MARGIN_MM;
    if (align === "center") x = MARGIN_MM + (CONTENT_WIDTH_MM - wMm) / 2;
    else if (align === "right") x = MARGIN_MM + CONTENT_WIDTH_MM - wMm;

    doc.addImage(block.dataUrl, "PNG", x, cursor.y, wMm, hMm);
    cursor.advance(hMm + (block.caption ? 1.5 : BLOCK_GAP_MM));

    if (block.caption) {
      doc.setFont(PDF_FONT_FAMILY, "italic");
      doc.setFontSize(FONT_SIZE_PT - 2);
      doc.text(textWithMathToPlain(block.caption), MARGIN_MM + CONTENT_WIDTH_MM / 2, cursor.y, {
        align: "center",
      });
      cursor.advance(LINE_HEIGHT_MM * 0.8 + BLOCK_GAP_MM * 0.4);
    }
  } catch (err) {
    // A corrupt/oversized data URL shouldn't take the whole export down.
    console.error("Không chèn được hình minh họa vào PDF:", err);
  }
}

function drawBlock(doc: jsPDF, cursor: PdfCursor, block: DocumentBlock) {
  switch (block.type) {
    case "heading":
      return drawHeading(doc, cursor, block);
    case "paragraph":
      return drawParagraph(doc, cursor, block);
    case "dotted_line":
      return drawDottedLine(doc, cursor, block);
    case "table":
      return drawTable(doc, cursor, block);
    case "signature_row":
      return drawSignatureRow(doc, cursor, block);
    case "image":
      return drawImage(doc, cursor, block);
    case "page_break":
      return cursor.forcePageBreak();
    case "spacer":
      cursor.ensureSpace(BLOCK_GAP_MM);
      return cursor.advance(BLOCK_GAP_MM);
  }
}

export async function buildPdf(document: ParsedDocument): Promise<jsPDF> {
  const landscape = document.orientation === "landscape";
  PAGE_WIDTH_MM = landscape ? A4_LONG_MM : A4_SHORT_MM;
  PAGE_HEIGHT_MM = landscape ? A4_SHORT_MM : A4_LONG_MM;
  CONTENT_WIDTH_MM = PAGE_WIDTH_MM - MARGIN_MM * 2;
  CONTENT_BOTTOM_MM = PAGE_HEIGHT_MM - MARGIN_MM;

  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: landscape ? "landscape" : "portrait" });
  await registerPdfFont(doc);
  doc.setFont(PDF_FONT_FAMILY, "normal");
  doc.setFontSize(FONT_SIZE_PT);

  const cursor = new PdfCursor(doc);
  for (const block of document.blocks) {
    drawBlock(doc, cursor, block);
  }
  return doc;
}

export async function downloadPdf(document: ParsedDocument, filename: string) {
  const doc = await buildPdf(document);
  const blob = doc.output("blob");
  const safeName = filename.trim() || "van-ban";
  saveAs(blob, `${safeName}.pdf`);
}
