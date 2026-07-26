import type { jsPDF } from "jspdf";
import type { MathNode } from "@/types";
import { PDF_FONT_FAMILY } from "./pdfFonts";

// Manual math typesetting for jsPDF. There is no OMML/MathML support in
// jsPDF, so formulas are drawn glyph-by-glyph: italic font for variables,
// upright for function names, shrinking font size + baseline shifts for
// sub/superscripts, and hand-drawn fraction bars / radical signs.

const SUP_DROP = 0.32; // superscript rise, as a fraction of font size (mm-ish via pt->size scaling handled by caller)
const SUB_DROP = 0.22; // subscript drop
const SHRINK = 0.68; // font-size multiplier for nested sub/sup/limits
const FRAC_GAP_PT = 0.9; // gap above/below the fraction bar, in pt-equivalent mm
const PT_TO_MM = 0.3528;

type Ctx = { doc: jsPDF };

function setMathFont(doc: jsPDF, sizePt: number, style: "italic" | "normal" | "bold") {
  doc.setFont(PDF_FONT_FAMILY, style);
  doc.setFontSize(sizePt);
}

// ---- width measurement -----------------------------------------------
export function measureMath(ctx: Ctx, nodes: MathNode[], sizePt: number): number {
  return nodes.reduce((w, n) => w + measureNode(ctx, n, sizePt), 0);
}

function measureNode(ctx: Ctx, node: MathNode, sizePt: number): number {
  const { doc } = ctx;
  switch (node.t) {
    case "r": {
      setMathFont(doc, sizePt, /[a-zA-Zα-ωΑ-Ω]/.test(node.v) ? "italic" : "normal");
      return doc.getTextWidth(node.v);
    }
    case "group":
      return measureMath(ctx, node.children, sizePt);
    case "frac": {
      const num = measureMath(ctx, node.num, sizePt * SHRINK);
      const den = measureMath(ctx, node.den, sizePt * SHRINK);
      return Math.max(num, den) + 2 * FRAC_GAP_PT * PT_TO_MM;
    }
    case "sup": {
      // "cos^{2}{x}" etc. parses as sup{base:[func cos x], sup:[2]}. Drawing
      // that literally (base, then superscript) reads as "cos x²" — the
      // exponent looks like it belongs to the argument, not the function —
      // instead of the intended "cos²x". Detect that shape and lay the
      // exponent right after the function name instead, matching how the
      // notation is actually printed.
      const funcSup = asFuncSup(node);
      if (funcSup) {
        setMathFont(doc, sizePt, "normal");
        const label = FUNC_LABEL[funcSup.fn.name] ?? funcSup.fn.name;
        const labelW = doc.getTextWidth(label);
        const supW = measureMath(ctx, funcSup.sup, sizePt * SHRINK);
        const spaceW = doc.getTextWidth(" ");
        return labelW + supW + spaceW + measureMath(ctx, funcSup.fn.children, sizePt);
      }
      return measureMath(ctx, node.base, sizePt) + measureMath(ctx, node.sup, sizePt * SHRINK);
    }
    case "sub":
      return measureMath(ctx, node.base, sizePt) + measureMath(ctx, node.sub, sizePt * SHRINK);
    case "subsup":
      return (
        measureMath(ctx, node.base, sizePt) +
        Math.max(measureMath(ctx, node.sub, sizePt * SHRINK), measureMath(ctx, node.sup, sizePt * SHRINK))
      );
    case "sqrt": {
      const inner = measureMath(ctx, node.children, sizePt);
      setMathFont(doc, sizePt, "normal");
      return doc.getTextWidth("√") + inner + 1;
    }
    case "nthroot": {
      const inner = measureMath(ctx, node.children, sizePt);
      const deg = measureMath(ctx, node.degree, sizePt * SHRINK);
      setMathFont(doc, sizePt, "normal");
      return Math.max(deg, doc.getTextWidth("√")) + inner + 1;
    }
    case "func": {
      setMathFont(doc, sizePt, "normal");
      const nameW = doc.getTextWidth(FUNC_LABEL[node.name] ?? node.name);
      const spaceW = doc.getTextWidth(" ");
      return nameW + spaceW + measureMath(ctx, node.children, sizePt);
    }
    case "lim": {
      setMathFont(doc, sizePt, "normal");
      const limW = doc.getTextWidth("lim");
      const subW = measureMath(ctx, node.sub, sizePt * SHRINK);
      const spaceW = doc.getTextWidth(" ");
      return Math.max(limW, subW) + spaceW + measureMath(ctx, node.children, sizePt);
    }
    case "sum":
    case "int": {
      setMathFont(ctx.doc, sizePt * 1.5, "normal");
      const symW = doc.getTextWidth(node.t === "sum" ? "∑" : "∫");
      const subW = node.sub.length ? measureMath(ctx, node.sub, sizePt * SHRINK) : 0;
      const supW = node.sup.length ? measureMath(ctx, node.sup, sizePt * SHRINK) : 0;
      return Math.max(symW, subW, supW) + 1 + measureMath(ctx, node.children, sizePt);
    }
    default:
      return 0;
  }
}

// Recognizes the sup{base:[func ...]} shape produced when parsing e.g.
// "\cos{x}^{2}" so it can be special-cased (see the "sup" branches above
// and below).
function asFuncSup(
  node: Extract<MathNode, { t: "sup" }>
): { fn: Extract<MathNode, { t: "func" }>; sup: MathNode[] } | null {
  if (node.base.length === 1 && node.base[0].t === "func") {
    return { fn: node.base[0], sup: node.sup };
  }
  return null;
}

const FUNC_LABEL: Record<string, string> = {
  ln: "ln", log: "log", exp: "exp",
  sin: "sin", cos: "cos", tan: "tan", cot: "cot", sec: "sec", csc: "csc",
  arcsin: "arcsin", arccos: "arccos", arctan: "arctan",
  sinh: "sinh", cosh: "cosh", tanh: "tanh",
  min: "min", max: "max", gcd: "gcd", lcm: "lcm", det: "det",
};

// ---- drawing -----------------------------------------------------------
// Draws nodes starting at baseline (x, y) in mm, returns the new x position.
export function drawMath(ctx: Ctx, x: number, y: number, nodes: MathNode[], sizePt: number): number {
  let cx = x;
  for (const node of nodes) cx = drawNode(ctx, cx, y, node, sizePt);
  return cx;
}

function drawNode(ctx: Ctx, x: number, y: number, node: MathNode, sizePt: number): number {
  const { doc } = ctx;
  const riseMm = sizePt * PT_TO_MM * SUP_DROP;
  const dropMm = sizePt * PT_TO_MM * SUB_DROP;

  switch (node.t) {
    case "r": {
      const italic = /[a-zA-Zα-ωΑ-Ω]/.test(node.v);
      setMathFont(doc, sizePt, italic ? "italic" : "normal");
      doc.text(node.v, x, y);
      return x + doc.getTextWidth(node.v);
    }
    case "group":
      return drawMath(ctx, x, y, node.children, sizePt);
    case "frac": {
      const smallSize = sizePt * SHRINK;
      const numW = measureMath(ctx, node.num, smallSize);
      const denW = measureMath(ctx, node.den, smallSize);
      const w = Math.max(numW, denW);
      const gap = FRAC_GAP_PT * PT_TO_MM;
      const barY = y - sizePt * PT_TO_MM * 0.28;
      drawMath(ctx, x + (w - numW) / 2, barY - gap - sizePt * PT_TO_MM * 0.05, node.num, smallSize);
      drawMath(ctx, x + (w - denW) / 2, barY + gap + sizePt * PT_TO_MM * 0.45, node.den, smallSize);
      doc.setLineWidth(0.15);
      doc.line(x, barY, x + w, barY);
      return x + w + gap;
    }
    case "sup": {
      const funcSup = asFuncSup(node);
      if (funcSup) {
        setMathFont(doc, sizePt, "normal");
        const label = FUNC_LABEL[funcSup.fn.name] ?? funcSup.fn.name;
        doc.text(label, x, y);
        const labelW = doc.getTextWidth(label);
        drawMath(ctx, x + labelW, y - riseMm, funcSup.sup, sizePt * SHRINK);
        const supW = measureMath(ctx, funcSup.sup, sizePt * SHRINK);
        const spaceW = doc.getTextWidth(" ");
        return drawMath(ctx, x + labelW + supW + spaceW, y, funcSup.fn.children, sizePt);
      }
      const baseEndX = drawMath(ctx, x, y, node.base, sizePt);
      drawMath(ctx, baseEndX, y - riseMm, node.sup, sizePt * SHRINK);
      return baseEndX + measureMath(ctx, node.sup, sizePt * SHRINK);
    }
    case "sub": {
      const baseEndX = drawMath(ctx, x, y, node.base, sizePt);
      drawMath(ctx, baseEndX, y + dropMm, node.sub, sizePt * SHRINK);
      return baseEndX + measureMath(ctx, node.sub, sizePt * SHRINK);
    }
    case "subsup": {
      const baseEndX = drawMath(ctx, x, y, node.base, sizePt);
      drawMath(ctx, baseEndX, y - riseMm, node.sup, sizePt * SHRINK);
      drawMath(ctx, baseEndX, y + dropMm, node.sub, sizePt * SHRINK);
      return baseEndX + Math.max(measureMath(ctx, node.sup, sizePt * SHRINK), measureMath(ctx, node.sub, sizePt * SHRINK));
    }
    case "sqrt":
    case "nthroot": {
      const inner = node.children;
      const innerW = measureMath(ctx, inner, sizePt);
      setMathFont(doc, sizePt, "normal");
      const radicalW = doc.getTextWidth("√");
      doc.text("√", x, y);
      const barY = y - sizePt * PT_TO_MM * 0.72;
      doc.setLineWidth(0.15);
      doc.line(x + radicalW * 0.55, barY, x + radicalW + innerW + 0.8, barY);
      if (node.t === "nthroot" && node.degree.length) {
        drawMath(ctx, x - 0.3, y - sizePt * PT_TO_MM * 0.55, node.degree, sizePt * SHRINK * 0.85);
      }
      drawMath(ctx, x + radicalW + 0.4, y, inner, sizePt);
      return x + radicalW + innerW + 1;
    }
    case "func": {
      setMathFont(doc, sizePt, "normal");
      const label = FUNC_LABEL[node.name] ?? node.name;
      doc.text(label, x, y);
      const labelW = doc.getTextWidth(label);
      const spaceW = doc.getTextWidth(" ");
      return drawMath(ctx, x + labelW + spaceW, y, node.children, sizePt);
    }
    case "lim": {
      setMathFont(doc, sizePt, "normal");
      doc.text("lim", x, y);
      const limW = doc.getTextWidth("lim");
      const subW = measureMath(ctx, node.sub, sizePt * SHRINK);
      const w = Math.max(limW, subW);
      drawMath(ctx, x + (w - subW) / 2, y + dropMm * 1.1, node.sub, sizePt * SHRINK);
      const spaceW = doc.getTextWidth(" ");
      return drawMath(ctx, x + w + spaceW, y, node.children, sizePt);
    }
    case "sum":
    case "int": {
      const bigSize = sizePt * 1.5;
      setMathFont(doc, bigSize, "normal");
      const sym = node.t === "sum" ? "∑" : "∫";
      const symW = doc.getTextWidth(sym);
      const subW = node.sub.length ? measureMath(ctx, node.sub, sizePt * SHRINK) : 0;
      const supW = node.sup.length ? measureMath(ctx, node.sup, sizePt * SHRINK) : 0;
      const w = Math.max(symW, subW, supW);
      doc.text(sym, x + (w - symW) / 2, y + sizePt * PT_TO_MM * 0.15);
      if (node.sup.length) drawMath(ctx, x + (w - supW) / 2, y - sizePt * PT_TO_MM * 0.75, node.sup, sizePt * SHRINK);
      if (node.sub.length) drawMath(ctx, x + (w - subW) / 2, y + sizePt * PT_TO_MM * 0.6, node.sub, sizePt * SHRINK);
      return drawMath(ctx, x + w + 1, y, node.children, sizePt);
    }
    default:
      return x;
  }
}
