import type { MathNode } from "@/types";
import { splitInlineMath } from "./mathParser";

function nodeToPlain(node: MathNode): string {
  switch (node.t) {
    case "r":
      return node.v;
    case "group":
      return nodesToPlain(node.children);
    case "frac":
      return `(${nodesToPlain(node.num)})/(${nodesToPlain(node.den)})`;
    case "sup":
      return `${nodesToPlain(node.base)}^${wrapIfMulti(node.sup)}`;
    case "sub":
      return `${nodesToPlain(node.base)}_${wrapIfMulti(node.sub)}`;
    case "subsup":
      return `${nodesToPlain(node.base)}_${wrapIfMulti(node.sub)}^${wrapIfMulti(node.sup)}`;
    case "sqrt":
      return `√(${nodesToPlain(node.children)})`;
    case "nthroot":
      return `${nodesToPlain(node.degree)}√(${nodesToPlain(node.children)})`;
    case "func":
      return `${node.name}(${nodesToPlain(node.children)})`;
    case "lim":
      return `lim_${wrapIfMulti(node.sub)} ${nodesToPlain(node.children)}`;
    case "sum":
      return `Σ${node.sub.length ? `_${wrapIfMulti(node.sub)}` : ""}${node.sup.length ? `^${wrapIfMulti(node.sup)}` : ""} ${nodesToPlain(node.children)}`;
    case "int":
      return `∫${node.sub.length ? `_${wrapIfMulti(node.sub)}` : ""}${node.sup.length ? `^${wrapIfMulti(node.sup)}` : ""} ${nodesToPlain(node.children)}`;
    default:
      return "";
  }
}

function wrapIfMulti(nodes: MathNode[]): string {
  const s = nodesToPlain(nodes);
  return s.length === 1 ? s : `{${s}}`;
}

function nodesToPlain(nodes: MathNode[]): string {
  return nodes.map(nodeToPlain).join("");
}

// Renders a text field (which may contain "$...$" spans) down to a single
// plain string, approximating formulas with ^ _ () √ Σ ∫ notation. Used
// anywhere we haven't built full graphical math layout (table cells,
// dotted-line values, signature blocks).
export function textWithMathToPlain(text: string): string {
  return splitInlineMath(text ?? "")
    .map((seg) => (seg.kind === "text" ? seg.value : nodesToPlain(seg.nodes)))
    .join("");
}
