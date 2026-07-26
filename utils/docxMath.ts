import {
  Math as DocxMath,
  MathRun,
  MathFraction,
  MathSuperScript,
  MathSubScript,
  MathSubSuperScript,
  MathRadical,
  MathFunction,
  MathSum,
  MathIntegral,
  MathLimitLower,
  XmlComponent,
  XmlAttributeComponent,
  type MathComponent,
} from "docx";
import type { MathNode } from "@/types";

// A plain (upright, non-italic) math run: <m:r><m:rPr><m:sty m:val="p"/></m:rPr><m:t>...</m:t></m:r>.
// docx's own MathRun has no way to opt out of OMML's default italic styling for
// Latin letters — that's normally sidestepped by wrapping function names in
// MathFunction (whose semantic <m:func>/<m:fName> Word renders upright on its
// own). We need an upright function name OUTSIDE of MathFunction (see the
// "sup" case below), so this builds the same "m:sty=p" the equation editor
// itself emits for a plain-styled run, using docx's low-level XML primitives.
// XmlComponent itself is declared abstract in docx's type definitions
// (even though runtime-instantiable) — a trivial concrete subclass lets us
// build arbitrary raw OMML elements like <m:rPr>, <m:sty>, <m:t> below.
// XmlComponent/XmlAttributeComponent are declared abstract in docx's type
// definitions (even though runtime-instantiable), and their `root` array is
// protected — trivial concrete subclasses plus the public addChildElement()
// method let us build arbitrary raw OMML elements like <m:rPr>/<m:sty>/<m:t>.
class RawXml extends XmlComponent {}
class RawAttr<T extends Record<string, unknown>> extends XmlAttributeComponent<T> {}

class MathPlainRun extends XmlComponent {
  constructor(text: string) {
    super("m:r");
    const sty = new RawXml("m:sty");
    sty.addChildElement(new RawAttr({ "m:val": "p" }) as unknown as XmlComponent);
    const rPr = new RawXml("m:rPr");
    rPr.addChildElement(sty);
    const t = new RawXml("m:t");
    t.addChildElement(text);
    this.addChildElement(rPr);
    this.addChildElement(t);
  }
}

function seq(nodes: MathNode[]): MathComponent[] {
  const out: MathComponent[] = [];
  for (const node of nodes) out.push(...one(node));
  return out;
}

function one(node: MathNode): MathComponent[] {
  switch (node.t) {
    case "r":
      return node.v ? [new MathRun(node.v)] : [];
    case "group":
      return seq(node.children);
    case "frac":
      return [
        new MathFraction({ numerator: seq(node.num), denominator: seq(node.den) }),
      ];
    case "sup": {
      // "\cos{x}^{2}" parses as sup{base:[func cos x], sup:[2]}. Rendered
      // literally (whole "cos x" as the superscript base) it reads as
      // "cos x²" — the exponent looks like it belongs to x, not cos —
      // instead of the intended "cos²x". Put the exponent on the function
      // name itself and keep its argument outside the superscript.
      if (node.base.length === 1 && node.base[0].t === "func") {
        const fn = node.base[0];
        return [
          new MathSuperScript({ children: [new MathPlainRun(fn.name)], superScript: seq(node.sup) }),
          ...seq(fn.children),
        ];
      }
      return [new MathSuperScript({ children: seq(node.base), superScript: seq(node.sup) })];
    }
    case "sub":
      return [new MathSubScript({ children: seq(node.base), subScript: seq(node.sub) })];
    case "subsup":
      return [
        new MathSubSuperScript({
          children: seq(node.base),
          subScript: seq(node.sub),
          superScript: seq(node.sup),
        }),
      ];
    case "sqrt":
      return [new MathRadical({ children: seq(node.children) })];
    case "nthroot":
      return [new MathRadical({ children: seq(node.children), degree: seq(node.degree) })];
    case "func":
      return [
        new MathFunction({
          name: [new MathRun(node.name)],
          children: seq(node.children),
        }),
      ];
    case "lim": {
      const limBase = new MathLimitLower({
        children: [new MathRun("lim")],
        limit: seq(node.sub),
      });
      return [limBase, ...seq(node.children)];
    }
    case "sum":
      return [
        new MathSum({
          children: seq(node.children),
          subScript: node.sub.length ? seq(node.sub) : undefined,
          superScript: node.sup.length ? seq(node.sup) : undefined,
        }),
      ];
    case "int":
      return [
        new MathIntegral({
          children: seq(node.children),
          subScript: node.sub.length ? seq(node.sub) : undefined,
          superScript: node.sup.length ? seq(node.sup) : undefined,
        }),
      ];
    default:
      return [];
  }
}

// Wraps a parsed math AST as an inline equation, ready to sit inside a
// Paragraph's `children` array next to ordinary TextRun instances.
export function buildInlineMath(nodes: MathNode[]): DocxMath {
  return new DocxMath({ children: seq(nodes) });
}
