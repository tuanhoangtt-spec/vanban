// Structured representation of a scanned Vietnamese document.
// Gemini is instructed to return exactly this shape as JSON.

export type BlockAlignment = "left" | "center" | "right" | "justify";

export type TextRun = {
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
};

export type HeadingBlock = {
  type: "heading";
  content: string;
  level?: 1 | 2 | 3; // 1 = document title, 3 = minor heading
  alignment?: BlockAlignment;
  bold?: boolean;
};

export type ParagraphBlock = {
  type: "paragraph";
  // runs allow mixed bold/italic inside a single paragraph (e.g. "Họ và tên: " + bold value)
  runs: TextRun[];
  alignment?: BlockAlignment;
};

// A line like "Họ và tên: .................." — label + dotted fill + optional value.
export type DottedLineBlock = {
  type: "dotted_line";
  label: string;
  value?: string;
  alignment?: BlockAlignment;
};

export type TableCell = {
  content: string;
  bold?: boolean;
  alignment?: BlockAlignment;
  colspan?: number;
  rowspan?: number;
};

export type TableBlock = {
  type: "table";
  rows: TableCell[][];
};

export type SignatureBlock = {
  // Two-column "NGƯỜI MUA / NGƯỜI BÁN" style signature areas, common in VN forms.
  type: "signature_row";
  columns: { title: string; subtitle?: string; name?: string }[];
};

export type SpacerBlock = {
  type: "spacer";
};

export type DocumentBlock =
  | HeadingBlock
  | ParagraphBlock
  | DottedLineBlock
  | TableBlock
  | SignatureBlock
  | SpacerBlock;

export type ParsedDocument = {
  blocks: DocumentBlock[];
};

export type ScanStatus = "idle" | "uploading" | "processing" | "done" | "error";

export type UploadedImage = {
  id: string;
  file: File;
  previewUrl: string;
  status: ScanStatus;
  error?: string;
  result?: ParsedDocument;
};
