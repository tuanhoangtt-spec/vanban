// Structured representation of a scanned Vietnamese document.
// Gemini is instructed to return exactly this shape as JSON.

export type BlockAlignment = "left" | "center" | "right" | "justify";

export type TextRun = {
  // Plain text. May contain inline math wrapped in single-dollar delimiters,
  // e.g. "Đạo hàm của $y = x^{5}$ là". A tiny LaTeX-like subset is supported
  // (^, _, \frac, \sqrt, \sin/\cos/..., \lim, \sum, \int, greek letters, etc.
  // — see utils/mathParser.ts for the exact grammar). This keeps every block
  // that already carries free text (paragraphs, headings, dotted lines, table
  // cells) able to contain real, natively-rendered formulas in both the .docx
  // and .pdf export, without changing the JSON shape Gemini has to produce.
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
};

// ---- Inline math AST -------------------------------------------------
// Produced by parsing the "$...$" spans inside any text field. Deliberately
// small: it covers what actually shows up in Vietnamese math exams (đạo hàm,
// giới hạn, tích phân...) rather than being a general LaTeX engine.
export type MathNode =
  | { t: "r"; v: string } // literal run: letters, digits, operators, unicode symbols
  | { t: "group"; children: MathNode[] } // {...} grouping, no visual mark
  | { t: "frac"; num: MathNode[]; den: MathNode[] }
  | { t: "sup"; base: MathNode[]; sup: MathNode[] }
  | { t: "sub"; base: MathNode[]; sub: MathNode[] }
  | { t: "subsup"; base: MathNode[]; sub: MathNode[]; sup: MathNode[] }
  | { t: "sqrt"; children: MathNode[] }
  | { t: "nthroot"; degree: MathNode[]; children: MathNode[] }
  | { t: "func"; name: string; children: MathNode[] } // sin, cos, tan, cot, ln, log, exp...
  | { t: "lim"; sub: MathNode[]; children: MathNode[] } // lim_{x->a} f(x)
  | { t: "sum"; sub: MathNode[]; sup: MathNode[]; children: MathNode[] }
  | { t: "int"; sub: MathNode[]; sup: MathNode[]; children: MathNode[] };

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

// Marks a page boundary from a multi-page source (PDF). Renders as an
// explicit page break in both the .docx and .pdf export.
export type PageBreakBlock = {
  type: "page_break";
};

export type DocumentBlock =
  | HeadingBlock
  | ParagraphBlock
  | DottedLineBlock
  | TableBlock
  | SignatureBlock
  | SpacerBlock
  | PageBreakBlock;

export type ParsedDocument = {
  blocks: DocumentBlock[];
};

export type ScanStatus = "idle" | "uploading" | "processing" | "done" | "error";

// Despite the name, this now also holds uploaded PDF files (Gemini reads
// PDFs natively, including multiple pages, embedded diagrams and tables).
export type UploadedImage = {
  id: string;
  file: File;
  previewUrl: string;
  status: ScanStatus;
  error?: string;
  result?: ParsedDocument;
  usedKeyLabel?: string;
};

// One entry in the user's pool of Gemini API keys. Several keys let the app
// automatically rotate to the next one once a key's daily free-tier quota
// is exhausted, instead of forcing the user to paste in a new key by hand.
export type ApiKeyEntry = {
  id: string;
  key: string;
  label: string;
  // Epoch ms until which this key is considered exhausted (quota hit).
  // Cleared automatically once that time passes.
  exhaustedUntil?: number;
  lastUsedAt?: number;
};
