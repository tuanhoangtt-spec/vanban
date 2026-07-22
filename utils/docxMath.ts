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
  type MathComponent,
} from "docx";
import type { MathNode } from "@/types";

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
    case "sup":
      return [new MathSuperScript({ children: seq(node.base), superScript: seq(node.sup) })];
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
