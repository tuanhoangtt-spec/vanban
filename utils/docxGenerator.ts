import {
  Document,
  Packer,
  Paragraph,
  TextRun as DocxTextRun,
  Table,
  TableRow,
  TableCell as DocxTableCell,
  AlignmentType,
  BorderStyle,
  WidthType,
  TabStopType,
  LeaderType,
} from "docx";
import { saveAs } from "file-saver";
import type {
  ParsedDocument,
  DocumentBlock,
  BlockAlignment,
  TableCell,
} from "@/types";

// ---- Fixed office formatting constants (do not change) -------------------
const FONT_FAMILY = "Times New Roman";
const FONT_SIZE_HALF_POINTS = 28; // 14pt
const HEADING_SIZE_HALF_POINTS = 32; // 16pt, ~2pt larger than body, still Times New Roman
const PAGE_WIDTH_DXA = 11906; // A4
const PAGE_HEIGHT_DXA = 16838; // A4
const MARGIN_DXA = 1134; // 2cm

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
    children: [
      new DocxTextRun({
        text: block.content,
        bold: block.bold ?? true,
        font: FONT_FAMILY,
        size:
          block.level === 1
            ? HEADING_SIZE_HALF_POINTS
            : FONT_SIZE_HALF_POINTS,
      }),
    ],
  });
}

function paragraph(block: Extract<DocumentBlock, { type: "paragraph" }>): Paragraph {
  return new Paragraph({
    alignment: mapAlignment(block.alignment ?? "justify"),
    spacing: { after: 160 },
    children: block.runs.map(
      (r) =>
        new DocxTextRun({
          text: r.text,
          bold: r.bold,
          italics: r.italic,
          underline: r.underline ? {} : undefined,
          font: FONT_FAMILY,
          size: FONT_SIZE_HALF_POINTS,
        })
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
      new DocxTextRun({
        text: `${label}${label.endsWith(":") ? "" : ":"}\t`,
        font: FONT_FAMILY,
        size: FONT_SIZE_HALF_POINTS,
      }),
      new DocxTextRun({
        text: value,
        bold: true,
        font: FONT_FAMILY,
        size: FONT_SIZE_HALF_POINTS,
      }),
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
        children: [
          new DocxTextRun({
            text: cell.content ?? "",
            bold: cell.bold,
            font: FONT_FAMILY,
            size: FONT_SIZE_HALF_POINTS,
          }),
        ],
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

function blockToDocxElement(block: DocumentBlock): Paragraph | Table {
  switch (block.type) {
    case "heading":
      return heading(block);
    case "paragraph":
      return paragraph(block);
    case "dotted_line":
      return dottedLine(block);
    case "table":
      return table(block);
    case "signature_row":
      return signatureRow(block);
    case "spacer":
      return new Paragraph({ text: "", spacing: { after: 160 } });
    default:
      return new Paragraph({ text: "" });
  }
}

export function buildDocx(doc: ParsedDocument): Document {
  const children = doc.blocks.map(blockToDocxElement);

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
              width: PAGE_WIDTH_DXA,
              height: PAGE_HEIGHT_DXA,
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
