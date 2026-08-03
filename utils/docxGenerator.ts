import {
  Document,
  Packer,
  Paragraph,
  TextRun as DocxTextRun,
  Table,
  TableRow,
  TableCell as DocxTableCell,
  ImageRun,
  AlignmentType,
  BorderStyle,
  WidthType,
  TabStopType,
  LeaderType,
  PageBreak,
  PageOrientation,
} from "docx";
import { saveAs } from "file-saver";
import type {
  ParsedDocument,
  DocumentBlock,
  BlockAlignment,
  TableCell,
} from "@/types";
import { splitInlineMath } from "./mathParser";
import { buildInlineMath } from "./docxMath";

// "data:image/png;base64,...." -> raw bytes. Works in both the browser
// (atob) and the Node test harness (Buffer), since utils/imageCrop.ts always
// produces PNG data URLs via canvas.toDataURL("image/png").
function base64ToBytes(base64: string): Uint8Array {
  if (typeof atob === "function") {
    const bin = atob(base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }
  return new Uint8Array(Buffer.from(base64, "base64"));
}

// Reads width/height straight out of the PNG IHDR chunk (bytes 16-23) so we
// can scale-to-fit without needing an <img> load round-trip.
function pngPixelSize(bytes: Uint8Array): { width: number; height: number } {
  if (bytes.length < 24) return { width: 640, height: 480 };
  const width = (bytes[16] << 24) | (bytes[17] << 16) | (bytes[18] << 8) | bytes[19];
  const height = (bytes[20] << 24) | (bytes[21] << 16) | (bytes[22] << 8) | bytes[23];
  return { width: width >>> 0 || 640, height: height >>> 0 || 480 };
}

// Turns free text that may contain "$...$" formulas into a mix of ordinary
// DocxTextRun (for plain text, keeping the requested styling) and native
// OMML Math elements (for the formulas) — used for every text-bearing block
// so headings, paragraphs, dotted lines and table cells can all carry math.
function textToDocxRuns(
  text: string,
  style: { bold?: boolean; italic?: boolean; underline?: boolean; size?: number } = {}
): (DocxTextRun | ReturnType<typeof buildInlineMath>)[] {
  const size = style.size ?? FONT_SIZE_HALF_POINTS;
  return splitInlineMath(text ?? "").map((seg) =>
    seg.kind === "text"
      ? new DocxTextRun({
          text: seg.value,
          bold: style.bold,
          italics: style.italic,
          underline: style.underline ? {} : undefined,
          font: FONT_FAMILY,
          size,
        })
      : buildInlineMath(seg.nodes)
  );
}

// ---- Fixed office formatting constants (do not change) -------------------
const FONT_FAMILY = "Times New Roman";
const FONT_SIZE_HALF_POINTS = 28; // 14pt
const HEADING_SIZE_HALF_POINTS = 32; // 16pt, ~2pt larger than body, still Times New Roman
const PAGE_WIDTH_DXA = 11906; // A4
const PAGE_HEIGHT_DXA = 16838; // A4
const MARGIN_DXA = 1134; // 2cm
// DXA -> px at 96dpi (1in = 1440dxa = 96px), used only to scale embedded
// images to fit within the page's printable width.
const MAX_IMAGE_WIDTH_PX = Math.floor((PAGE_WIDTH_DXA - MARGIN_DXA * 2) / 15);
const MAX_IMAGE_HEIGHT_PX = 640;

const CELL_BORDER = {
  style: BorderStyle.SINGLE,
  size: 4,
  color: "000000",
};

const TABLE_BORDERS = {
  top: CELL_BORDER,
  bottom: CELL_BORDER,
  left: CELL_BORDER,
  right: CELL_BORDER,
  insideHorizontal: CELL_BORDER,
  insideVertical: CELL_BORDER,
};

function mapAlignment(a?: BlockAlignment): (typeof AlignmentType)[keyof typeof AlignmentType] {
  switch (a) {
    case "center":
      return AlignmentType.CENTER;
    case "right":
      return AlignmentType.RIGHT;
    case "justify":
      return AlignmentType.JUSTIFIED;
    case "left":
    default:
      return AlignmentType.LEFT;
  }
}

function heading(block: Extract<DocumentBlock, { type: "heading" }>): Paragraph {
  return new Paragraph({
    alignment: mapAlignment(block.alignment ?? "center"),
    spacing: { after: 200 },
    children: textToDocxRuns(block.content, {
      bold: block.bold ?? true,
      size: block.level === 1 ? HEADING_SIZE_HALF_POINTS : FONT_SIZE_HALF_POINTS,
    }),
  });
}

function paragraph(block: Extract<DocumentBlock, { type: "paragraph" }>): Paragraph {
  return new Paragraph({
    alignment: mapAlignment(block.alignment ?? "justify"),
    spacing: { after: 160 },
    children: block.runs.flatMap((r) =>
      textToDocxRuns(r.text, { bold: r.bold, italic: r.italic, underline: r.underline })
    ),
  });
}

// Dotted fill-in line, e.g. "Họ và tên: ............... Nguyễn Văn A"
// Implemented with a right tab + dotted leader so the dots stay unbroken
// regardless of label/value length, instead of literal "." characters.
function dottedLine(block: Extract<DocumentBlock, { type: "dotted_line" }>): Paragraph {
  const label = block.label?.trim() ?? "";
  const value = block.value?.trim() ?? "";
  return new Paragraph({
    alignment: mapAlignment(block.alignment ?? "left"),
    spacing: { after: 160 },
    tabStops: [
      {
        type: TabStopType.RIGHT,
        position: PAGE_WIDTH_DXA - MARGIN_DXA * 2,
        leader: LeaderType.DOT,
      },
    ],
    children: [
      ...textToDocxRuns(`${label}${label.endsWith(":") ? "" : ":"}\t`),
      ...textToDocxRuns(value, { bold: true }),
    ],
  });
}

function buildCell(cell: TableCell): DocxTableCell {
  return new DocxTableCell({
    borders: TABLE_BORDERS,
    margins: { top: 80, bottom: 80, left: 100, right: 100 },
    columnSpan: cell.colspan,
    rowSpan: cell.rowspan,
    children: [
      new Paragraph({
        alignment: mapAlignment(cell.alignment ?? "left"),
        children: textToDocxRuns(cell.content ?? "", { bold: cell.bold }),
      }),
    ],
  });
}

function table(block: Extract<DocumentBlock, { type: "table" }>): Table {
  const rows = block.rows.length > 0 ? block.rows : [[{ content: "" }]];
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: TABLE_BORDERS,
    rows: rows.map(
      (row) =>
        new TableRow({
          children: row.map(buildCell),
        })
    ),
  });
}

function signatureRow(
  block: Extract<DocumentBlock, { type: "signature_row" }>
): Table {
  // Borderless table used purely for layout so the two/three signature
  // columns stay aligned side by side, matching common VN form footers.
  const colCount = block.columns.length || 2;
  const noBorder = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
  const invisibleBorders = {
    top: noBorder,
    bottom: noBorder,
    left: noBorder,
    right: noBorder,
    insideHorizontal: noBorder,
    insideVertical: noBorder,
  };

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: invisibleBorders,
    rows: [
      new TableRow({
        children: block.columns.map(
          (col) =>
            new DocxTableCell({
              borders: invisibleBorders,
              width: { size: 100 / colCount, type: WidthType.PERCENTAGE },
              children: [
                new Paragraph({
                  alignment: AlignmentType.CENTER,
                  children: [
                    new DocxTextRun({
                      text: col.title,
                      bold: true,
                      font: FONT_FAMILY,
                      size: FONT_SIZE_HALF_POINTS,
                    }),
                  ],
                }),
                ...(col.subtitle
                  ? [
                      new Paragraph({
                        alignment: AlignmentType.CENTER,
                        children: [
                          new DocxTextRun({
                            text: col.subtitle,
                            italics: true,
                            font: FONT_FAMILY,
                            size: FONT_SIZE_HALF_POINTS - 4,
                          }),
                        ],
                      }),
                    ]
                  : []),
                new Paragraph({ text: "" }),
                new Paragraph({ text: "" }),
                new Paragraph({
                  alignment: AlignmentType.CENTER,
                  children: [
                    new DocxTextRun({
                      text: col.name ?? "",
                      bold: true,
                      font: FONT_FAMILY,
                      size: FONT_SIZE_HALF_POINTS,
                    }),
                  ],
                }),
              ],
            })
        ),
      }),
    ],
  });
}

function imageBlock(block: Extract<DocumentBlock, { type: "image" }>): Paragraph[] {
  const placeholder = () => [
    new Paragraph({
      alignment: mapAlignment(block.alignment ?? "left"),
      spacing: { after: 160 },
      children: textToDocxRuns(
        `[Hình minh họa${block.caption ? ": " + block.caption : ""}]`,
        { italic: true }
      ),
    }),
  ];

  if (!block.dataUrl) return placeholder();

  try {
    const bytes = base64ToBytes(block.dataUrl.split(",")[1] ?? "");
    const { width: pxWidth, height: pxHeight } = pngPixelSize(bytes);
    const scale = Math.min(MAX_IMAGE_WIDTH_PX / pxWidth, MAX_IMAGE_HEIGHT_PX / pxHeight, 1);
    const width = Math.max(1, Math.round(pxWidth * scale));
    const height = Math.max(1, Math.round(pxHeight * scale));

    const paragraphs = [
      new Paragraph({
        alignment: mapAlignment(block.alignment ?? "center"),
        spacing: { after: block.caption ? 60 : 160 },
        children: [new ImageRun({ type: "png", data: bytes, transformation: { width, height } })],
      }),
    ];
    if (block.caption) {
      paragraphs.push(
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 160 },
          children: textToDocxRuns(block.caption, {
            italic: true,
            size: FONT_SIZE_HALF_POINTS - 4,
          }),
        })
      );
    }
    return paragraphs;
  } catch (err) {
    // A malformed data URL shouldn't take the whole export down.
    console.error("Không chèn được hình minh họa vào Word:", err);
    return placeholder();
  }
}

function blockToDocxElements(block: DocumentBlock): (Paragraph | Table)[] {
  switch (block.type) {
    case "heading":
      return [heading(block)];
    case "paragraph":
      return [paragraph(block)];
    case "dotted_line":
      return [dottedLine(block)];
    case "table":
      return [table(block)];
    case "signature_row":
      return [signatureRow(block)];
    case "image":
      return imageBlock(block);
    case "page_break":
      return [new Paragraph({ children: [new PageBreak()] })];
    case "spacer":
      return [new Paragraph({ text: "", spacing: { after: 160 } })];
    default:
      return [new Paragraph({ text: "" })];
  }
}

export function buildDocx(doc: ParsedDocument): Document {
  const children = doc.blocks.flatMap(blockToDocxElements);

  // Detected client-side from the source file's own page geometry (see
  // utils/imageCrop.ts:detectDocumentOrientation) — a single value for the
  // whole document, not per-page. Landscape just swaps the A4 width/height.
  const landscape = doc.orientation === "landscape";
  const pageWidth = landscape ? PAGE_HEIGHT_DXA : PAGE_WIDTH_DXA;
  const pageHeight = landscape ? PAGE_WIDTH_DXA : PAGE_HEIGHT_DXA;

  return new Document({
    styles: {
      default: {
        document: {
          run: {
            font: FONT_FAMILY,
            size: FONT_SIZE_HALF_POINTS,
          },
        },
      },
    },
    sections: [
      {
        properties: {
          page: {
            size: {
              width: pageWidth,
              height: pageHeight,
              orientation: landscape ? PageOrientation.LANDSCAPE : PageOrientation.PORTRAIT,
            },
            margin: {
              top: MARGIN_DXA,
              bottom: MARGIN_DXA,
              left: MARGIN_DXA,
              right: MARGIN_DXA,
            },
          },
        },
        children,
      },
    ],
  });
}

export async function downloadDocx(doc: ParsedDocument, filename: string) {
  const document = buildDocx(doc);
  const blob = await Packer.toBlob(document);
  const safeName = filename.trim() || "van-ban";
  saveAs(blob, `${safeName}.docx`);
}
