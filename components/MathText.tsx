"use client";

import { useMemo } from "react";
import katex from "katex";
import { splitDollarSegments } from "@/utils/mathParser";

// Renders a text field that may contain "$...$" formulas, drawing the math
// parts with KaTeX so the person can see the actual rendered formula (not
// raw LaTeX-ish text) while reviewing/editing OCR output before export.
export function MathText({ text, className }: { text: string; className?: string }) {
  const segments = useMemo(() => splitDollarSegments(text ?? ""), [text]);

  return (
    <span className={className}>
      {segments.map((seg, i) => {
        if (seg.kind === "text") return <span key={i}>{seg.value}</span>;
        let html: string;
        try {
          html = katex.renderToString(seg.latex, { throwOnError: false, output: "html" });
        } catch {
          html = seg.latex;
        }
        return (
          <span
            key={i}
            className="inline-block align-middle"
            // eslint-disable-next-line react/no-danger
            dangerouslySetInnerHTML={{ __html: html }}
          />
        );
      })}
    </span>
  );
}
