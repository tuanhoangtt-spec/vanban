import type { MathNode } from "@/types";

// ---------------------------------------------------------------------------
// 1) Split a text field into alternating plain-text / math segments on
//    unescaped "$...$" delimiters ("\$" is a literal dollar sign).
// ---------------------------------------------------------------------------

export type TextSegment = { kind: "text"; value: string };
export type MathSegment = { kind: "math"; nodes: MathNode[] };
export type InlineSegment = TextSegment | MathSegment;

export type RawTextSegment = { kind: "text"; value: string };
export type RawMathSegment = { kind: "math"; latex: string };
export type RawInlineSegment = RawTextSegment | RawMathSegment;

// Splits on unescaped "$...$" delimiters ("\$" is a literal dollar sign)
// without parsing the math content — used by the in-browser KaTeX preview,
// which wants the raw LaTeX-lite source rather than our MathNode AST.
export function splitDollarSegments(input: string): RawInlineSegment[] {
  const segments: RawInlineSegment[] = [];
  let buf = "";
  let i = 0;
  const n = input.length;

  const flushText = () => {
    if (buf) {
      segments.push({ kind: "text", value: buf });
      buf = "";
    }
  };

  while (i < n) {
    const ch = input[i];
    if (ch === "\\" && input[i + 1] === "$") {
      buf += "$";
      i += 2;
      continue;
    }
    if (ch === "$") {
      let j = i + 1;
      let mathSrc = "";
      let closed = false;
      while (j < n) {
        if (input[j] === "\\" && input[j + 1] === "$") {
          mathSrc += "$";
          j += 2;
          continue;
        }
        if (input[j] === "$") {
          closed = true;
          j += 1;
          break;
        }
        mathSrc += input[j];
        j += 1;
      }
      if (closed) {
        flushText();
        segments.push({ kind: "math", latex: mathSrc });
        i = j;
        continue;
      }
      // unmatched '$' — treat as a literal character instead of failing
      buf += ch;
      i += 1;
      continue;
    }
    buf += ch;
    i += 1;
  }
  flushText();
  return segments;
}

export function splitInlineMath(input: string): InlineSegment[] {
  return splitDollarSegments(input).map((seg) =>
    seg.kind === "text" ? seg : { kind: "math", nodes: parseMath(seg.latex) }
  );
}

// True if the text contains at least one "tall" construct (fraction, root,
// sub/superscript, sum, integral) — callers use this to add a little extra
// line spacing so the formula doesn't collide with neighbouring lines.
export function hasTallMath(input: string): boolean {
  return splitInlineMath(input).some(
    (seg) => seg.kind === "math" && someTall(seg.nodes)
  );
}

function someTall(nodes: MathNode[]): boolean {
  return nodes.some((node) => {
    switch (node.t) {
      case "frac":
      case "sqrt":
      case "nthroot":
      case "sub":
      case "sup":
      case "subsup":
      case "sum":
      case "int":
      case "lim":
        return true;
      case "func":
        return someTall(node.children);
      case "group":
        return someTall(node.children);
      default:
        return false;
    }
  });
}

// ---------------------------------------------------------------------------
// 2) Parse a tiny LaTeX-like subset into a MathNode[] tree.
//
//    Supported: ^ _ (single-token or {grouped}), \frac{}{}, \sqrt{},
//    \sqrt[n]{}, \sin \cos \tan \cot \ln \log \exp \arcsin \arccos \arctan
//    \sinh \cosh \tanh \min \max \gcd \lcm, \lim (with an immediately
//    following _{...} read as the limit condition), \sum \int (with optional
//    _{...}^{...}), \left \right (ignored, underlying bracket kept literal),
//    a small greek/operator symbol table, and plain characters.
// ---------------------------------------------------------------------------

const FRAC_CMDS = new Set(["frac", "dfrac", "tfrac"]);
const FUNC_CMDS = new Set([
  "sin", "cos", "tan", "cot", "sec", "csc",
  "ln", "log", "exp",
  "arcsin", "arccos", "arctan",
  "sinh", "cosh", "tanh",
  "min", "max", "gcd", "lcm", "det",
]);

const SYMBOLS: Record<string, string> = {
  to: "→", rightarrow: "→", Rightarrow: "⇒", leftarrow: "←", leftrightarrow: "↔",
  infty: "∞", pm: "±", mp: "∓", times: "×", cdot: "·", div: "÷",
  le: "≤", leq: "≤", ge: "≥", geq: "≥", ne: "≠", neq: "≠", approx: "≈", equiv: "≡",
  in: "∈", notin: "∉", subset: "⊂", subseteq: "⊆", cup: "∪", cap: "∩", emptyset: "∅",
  forall: "∀", exists: "∃", partial: "∂", nabla: "∇", degree: "°",
  ldots: "…", cdots: "⋯", dots: "…",
  alpha: "α", beta: "β", gamma: "γ", Gamma: "Γ", delta: "δ", Delta: "Δ",
  epsilon: "ε", varepsilon: "ε", zeta: "ζ", eta: "η", theta: "θ", Theta: "Θ",
  iota: "ι", kappa: "κ", lambda: "λ", Lambda: "Λ", mu: "μ", nu: "ν",
  xi: "ξ", Xi: "Ξ", pi: "π", Pi: "Π", rho: "ρ", sigma: "σ", Sigma: "Σ",
  tau: "τ", upsilon: "υ", phi: "φ", varphi: "φ", Phi: "Φ", chi: "χ",
  psi: "ψ", Psi: "Ψ", omega: "ω", Omega: "Ω",
  prime: "′",
};

class MathParseError extends Error {}

function parseMath(src: string): MathNode[] {
  try {
    const p = new Parser(src);
    const nodes = p.parseExpr();
    return mergeAdjacentText(nodes);
  } catch {
    // Malformed input (mismatched braces, unknown edge case, ...) — degrade
    // gracefully to a literal text run instead of throwing away the export.
    return [{ t: "r", v: src.trim() }];
  }
}

class Parser {
  private i = 0;
  constructor(private s: string) {}

  private peek(): string | undefined {
    return this.s[this.i];
  }

  private skipSpace() {
    while (this.i < this.s.length && /\s/.test(this.s[this.i])) this.i++;
  }

  parseExpr(stopAtBrace = false): MathNode[] {
    const out: MathNode[] = [];
    while (this.i < this.s.length) {
      this.skipSpace();
      if (this.i >= this.s.length) break;
      if (stopAtBrace && this.peek() === "}") break;
      const atom = this.parseAtom();
      if (atom) out.push(atom);
    }
    return out;
  }

  private parseGroup(): MathNode[] {
    this.skipSpace();
    if (this.peek() === "{") {
      this.i++; // consume '{'
      const nodes = this.parseExpr(true);
      this.skipSpace();
      if (this.peek() === "}") this.i++;
      else throw new MathParseError("unterminated {}");
      return nodes;
    }
    // no braces — a single atom is the group (e.g. ^2, \sqrt x)
    const atom = this.parseAtom();
    return atom ? [atom] : [];
  }

  private parseAtom(): MathNode | null {
    this.skipSpace();
    if (this.i >= this.s.length) return null;
    const ch = this.s[this.i];

    let node: MathNode;

    if (ch === "\\") {
      node = this.parseCommand();
    } else if (ch === "{") {
      this.i++;
      const children = this.parseExpr(true);
      this.skipSpace();
      if (this.peek() === "}") this.i++;
      node = { t: "group", children };
    } else if (ch === "}") {
      return null;
    } else {
      this.i++;
      node = { t: "r", v: ch };
    }

    return this.parsePostfix(node);
  }

  // Attaches a trailing ^{...} / _{...} (in either order) to the atom just parsed.
  private parsePostfix(node: MathNode): MathNode {
    this.skipSpace();
    let sub: MathNode[] | null = null;
    let sup: MathNode[] | null = null;

    for (let guard = 0; guard < 2; guard++) {
      this.skipSpace();
      if (this.peek() === "^" && sup === null) {
        this.i++;
        sup = this.parseGroup();
      } else if (this.peek() === "_" && sub === null) {
        this.i++;
        sub = this.parseGroup();
      } else {
        break;
      }
    }

    if (sub && sup) return { t: "subsup", base: [node], sub, sup };
    if (sup) return { t: "sup", base: [node], sup };
    if (sub) return { t: "sub", base: [node], sub };
    return node;
  }

  private readCommandName(): string {
    this.i++; // consume backslash
    let name = "";
    while (this.i < this.s.length && /[a-zA-Z]/.test(this.s[this.i])) {
      name += this.s[this.i];
      this.i++;
    }
    if (!name) {
      // "\{" "\}" "\\" "\$" "\," etc — treat the escaped char as literal
      const c = this.s[this.i] ?? "";
      this.i++;
      return `\x00${c}`; // sentinel handled by caller
    }
    return name;
  }

  private parseCommand(): MathNode {
    const name = this.readCommandName();

    if (name.startsWith("\x00")) {
      return { t: "r", v: name.slice(1) };
    }

    if (FRAC_CMDS.has(name)) {
      const num = this.parseGroup();
      const den = this.parseGroup();
      return { t: "frac", num, den };
    }

    if (name === "sqrt") {
      this.skipSpace();
      let degree: MathNode[] | undefined;
      if (this.peek() === "[") {
        this.i++;
        let deg = "";
        while (this.i < this.s.length && this.s[this.i] !== "]") {
          deg += this.s[this.i];
          this.i++;
        }
        if (this.peek() === "]") this.i++;
        degree = parseMath(deg);
      }
      const children = this.parseGroup();
      return degree
        ? { t: "nthroot", degree, children }
        : { t: "sqrt", children };
    }

    if (name === "lim") {
      this.skipSpace();
      let sub: MathNode[] = [];
      if (this.peek() === "_") {
        this.i++;
        sub = this.parseGroup();
      }
      const children = this.parseGroup();
      return { t: "lim", sub, children };
    }

    if (name === "sum" || name === "int" || name === "iint" || name === "oint") {
      this.skipSpace();
      let sub: MathNode[] = [];
      let sup: MathNode[] = [];
      for (let guard = 0; guard < 2; guard++) {
        this.skipSpace();
        if (this.peek() === "_" && sub.length === 0) {
          this.i++;
          sub = this.parseGroup();
        } else if (this.peek() === "^" && sup.length === 0) {
          this.i++;
          sup = this.parseGroup();
        } else break;
      }
      const children = this.parseGroup();
      return name === "sum"
        ? { t: "sum", sub, sup, children }
        : { t: "int", sub, sup, children };
    }

    if (FUNC_CMDS.has(name)) {
      const children = this.parseGroup();
      return { t: "func", name, children };
    }

    if (name === "left" || name === "right") {
      // \left( ... \right) — keep the bracket glyph, drop the sizing command
      this.skipSpace();
      const bracket = this.s[this.i] ?? "";
      this.i++;
      return { t: "r", v: bracket };
    }

    if (name === "text" || name === "mathrm" || name === "operatorname") {
      const children = this.parseGroup();
      return { t: "func", name: mathNodesToPlainText(children), children: [] };
    }

    if (name in SYMBOLS) {
      return { t: "r", v: SYMBOLS[name] };
    }

    // Unknown command — fall back to its name as literal text so nothing
    // silently disappears.
    return { t: "r", v: name };
  }
}

function mathNodesToPlainText(nodes: MathNode[]): string {
  return nodes
    .map((n) => (n.t === "r" ? n.v : n.t === "group" ? mathNodesToPlainText(n.children) : ""))
    .join("");
}

function mergeAdjacentText(nodes: MathNode[]): MathNode[] {
  const out: MathNode[] = [];
  for (const node of nodes) {
    const prev = out[out.length - 1];
    if (node.t === "r" && prev && prev.t === "r") {
      prev.v += node.v;
      continue;
    }
    if (node.t === "group") {
      out.push(...mergeAdjacentText(node.children));
      continue;
    }
    out.push(node);
  }
  return out;
}

export { parseMath };
