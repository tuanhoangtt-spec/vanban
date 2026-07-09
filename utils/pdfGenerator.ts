import { jsPDF } from "jspdf";
import { autoTable } from "jspdf-autotable";
import { saveAs } from "file-saver";
import { registerPdfFont, PDF_FONT_FAMILY } from "./pdfFonts";
import type {
  ParsedDocument,
  DocumentBlock,
  BlockAlignment,
  TableCell,
} from "@/types";

// Mirrors the fixed office formatting used in docxGenerator.ts, translated
// to jsPDF's mm/pt units, so the PDF and the Word export read the same way.
const PAGE_WIDTH_MM = 210; // A4
const PAGE_HEIGHT_MM = 297;
const MARGIN_MM = 20; // 2cm
const CONTENT_WIDTH_MM = PAGE_WIDTH_MM - MARGIN_MM * 2;
const CONTENT_BOTTOM_MM = PAGE_HEIGHT_MM - MARGIN_MM;

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
      this.doc.addPage();
      this.y = MARGIN_MM;
    }
  }

  advance(mm: number) {
    this.y += mm;
  }

  forcePageBreak() {
    this.doc.addPage();
    this.y = MARGIN_MM;
  }
}

function drawWrappedText(
  doc: jsPDF,
  cursor: PdfCursor,
  text: string,
  opts: { align: BlockAlignment; bold?: boolean; sizePt?: number }
) {
  if (!text) {
    cursor.ensureSpace(LINE_HEIGHT_MM);
    cursor.advance(LINE_HEIGHT_MM);
    return;
  }
  doc.setFont(PDF_FONT_FAMILY, opts.bold ? "bold" : "normal");
  doc.setFontSize(opts.sizePt ?? FONT_SIZE_PT);

  const lines = doc.splitTextToSize(text, CONTENT_WIDTH_MM) as string[];
  const align = jsAlign(opts.align);

  lines.forEach((line, i) => {
    cursor.ensureSpace(LINE_HEIGHT_MM);
    const isLast = i === lines.length - 1;
    if (align === "center") {
      doc.text(line, MARGIN_MM + CONTENT_WIDTH_MM / 2, cursor.y, { align: "center" });
    } else if (align === "right") {
      doc.text(line, MARGIN_MM + CONTENT_WIDTH_MM, cursor.y, { align: "right" });
    } else if (align === "justify" && !isLast) {
      doc.text(line, MARGIN_MM, cursor.y, { maxWidth: CONTENT_WIDTH_MM, align: "justify" });
    } else {
      doc.text(line, MARGIN_MM, cursor.y);
    }
    cursor.advance(LINE_HEIGHT_MM);
  });
}

function drawHeading(doc: jsPDF, cursor: PdfCursor, block: Extract<DocumentBlock, { type: "heading" }>) {
  drawWrappedText(doc, cursor, block.content, {
    align: block.alignment ?? "center",
    bold: block.bold ?? true,
    sizePt: block.level === 1 ? HEADING_SIZE_PT : FONT_SIZE_PT,
  });
  cursor.advance(BLOCK_GAP_MM);
}

function drawParagraph(doc: jsPDF, cursor: PdfCursor, block: Extract<DocumentBlock, { type: "paragraph" }>) {
  const text = block.runs.map((r) => r.text).join("");
  drawWrappedText(doc, cursor, text, {
    align: block.alignment ?? "justify",
    bold: block.runs[0]?.bold,
  });
  cursor.advance(BLOCK_GAP_MM * 0.6);
}

function drawDottedLine(doc: jsPDF, cursor: PdfCursor, block: Extract<DocumentBlock, { type: "dotted_line" }>) {
  cursor.ensureSpace(LINE_HEIGHT_MM);
  doc.setFontSize(FONT_SIZE_PT);

  const label = `${(block.label ?? "").trim()}${(block.label ?? "").trim().endsWith(":") ? "" : ":"} `;
  const value = (block.value ?? "").trim();

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
  const body = rows.map((row) => row.map((cell) => cell.content ?? ""));
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
    doc.text(col.title, centerX, y, { align: "center" });
    y += LINE_HEIGHT_MM;

    if (col.subtitle) {
      doc.setFont(PDF_FONT_FAMILY, "italic");
      doc.setFontSize(FONT_SIZE_PT - 2);
      doc.text(col.subtitle, centerX, y, { align: "center" });
      y += LINE_HEIGHT_MM;
    }

    y += 14; // space reserved for the physical signature

    doc.setFont(PDF_FONT_FAMILY, "bold");
    doc.setFontSize(FONT_SIZE_PT);
    doc.text(col.name ?? "", centerX, y, { align: "center" });
  });

  cursor.advance(blockHeight);
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
    case "page_break":
      return cursor.forcePageBreak();
    case "spacer":
      cursor.ensureSpace(BLOCK_GAP_MM);
      return cursor.advance(BLOCK_GAP_MM);
  }
}

export async function buildPdf(document: ParsedDocument): Promise<jsPDF> {
  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
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
