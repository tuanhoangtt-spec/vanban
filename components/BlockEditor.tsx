"use client";

import type { DocumentBlock, ParsedDocument, TableCell } from "@/types";
import { Heading, Rows3, AlignJustify, MoreHorizontal, PenLine, FileStack, ImageIcon } from "lucide-react";
import { MathText } from "./MathText";

const hasMath = (text: string) => /\$[^$]+\$/.test(text ?? "");

function MathPreview({ text }: { text: string }) {
  if (!hasMath(text)) return null;
  return (
    <div className="rounded-md bg-ink/[0.03] border border-ink/10 px-2 py-1.5 text-sm">
      <MathText text={text} />
    </div>
  );
}

function AutoTextarea({
  value,
  onChange,
  className,
  ariaLabel,
}: {
  value: string;
  onChange: (v: string) => void;
  className?: string;
  ariaLabel?: string;
}) {
  return (
    <textarea
      aria-label={ariaLabel}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      rows={1}
      onInput={(e) => {
        const el = e.currentTarget;
        el.style.height = "auto";
        el.style.height = `${el.scrollHeight}px`;
      }}
      className={[
        "w-full resize-none bg-transparent outline-none rounded-md px-2 py-1 -mx-2",
        "focus:bg-accentSoft/60 focus:ring-1 focus:ring-accent/30 transition-colors",
        className ?? "",
      ].join(" ")}
    />
  );
}

function BlockTag({ icon: Icon, label }: { icon: any; label: string }) {
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-ink/35">
      <Icon className="h-3 w-3" /> {label}
    </span>
  );
}

export function BlockEditor({
  document,
  onChange,
}: {
  document: ParsedDocument;
  onChange: (doc: ParsedDocument) => void;
}) {
  const updateBlock = (index: number, next: DocumentBlock) => {
    const blocks = document.blocks.slice();
    blocks[index] = next;
    onChange({ blocks });
  };

  const updateCell = (
    blockIndex: number,
    rowIndex: number,
    cellIndex: number,
    content: string
  ) => {
    const block = document.blocks[blockIndex];
    if (block.type !== "table") return;
    const rows = block.rows.map((row, r) =>
      r !== rowIndex
        ? row
        : row.map((cell, c) => (c !== cellIndex ? cell : { ...cell, content }))
    );
    updateBlock(blockIndex, { ...block, rows });
  };

  return (
    <div className="space-y-3">
      {document.blocks.map((block, i) => {
        switch (block.type) {
          case "heading":
            return (
              <div key={i} className="space-y-1">
                <BlockTag icon={Heading} label={`Tiêu đề ${block.level ?? ""}`} />
                <AutoTextarea
                  ariaLabel="Nội dung tiêu đề"
                  value={block.content}
                  onChange={(v) => updateBlock(i, { ...block, content: v })}
                  className="font-serif font-bold text-center text-base"
                />
                <MathPreview text={block.content} />
              </div>
            );

          case "paragraph":
            return (
              <div key={i} className="space-y-1">
                <BlockTag icon={AlignJustify} label="Đoạn văn" />
                <AutoTextarea
                  ariaLabel="Nội dung đoạn văn"
                  value={block.runs.map((r) => r.text).join("")}
                  onChange={(v) =>
                    updateBlock(i, { ...block, runs: [{ text: v, bold: block.runs[0]?.bold }] })
                  }
                  className="text-sm leading-relaxed text-justify"
                />
                <MathPreview text={block.runs.map((r) => r.text).join("")} />
              </div>
            );

          case "dotted_line":
            return (
              <div key={i} className="space-y-1">
                <BlockTag icon={MoreHorizontal} label="Dòng điền thông tin" />
                <div className="flex items-end gap-2 text-sm">
                  <AutoTextarea
                    ariaLabel="Nhãn"
                    value={block.label}
                    onChange={(v) => updateBlock(i, { ...block, label: v })}
                    className="shrink-0 basis-1/3 font-medium"
                  />
                  <div className="flex-1 dotted-fill pb-1">
                    <AutoTextarea
                      ariaLabel="Giá trị"
                      value={block.value ?? ""}
                      onChange={(v) => updateBlock(i, { ...block, value: v })}
                      className="font-semibold text-accent"
                    />
                  </div>
                </div>
                <MathPreview text={block.value ?? ""} />
              </div>
            );

          case "table":
            return (
              <div key={i} className="space-y-1">
                <BlockTag icon={Rows3} label={`Bảng ${block.rows.length} hàng`} />
                <div className="overflow-x-auto rounded-lg border border-ink/15">
                  <table className="w-full text-sm border-collapse">
                    <tbody>
                      {block.rows.map((row, r) => (
                        <tr key={r}>
                          {row.map((cell: TableCell, c) => (
                            <td
                              key={c}
                              className="border border-ink/15 px-1 py-0.5 align-top min-w-[90px]"
                            >
                              <AutoTextarea
                                ariaLabel={`Ô hàng ${r + 1} cột ${c + 1}`}
                                value={cell.content}
                                onChange={(v) => updateCell(i, r, c, v)}
                                className={cell.bold ? "font-semibold text-xs" : "text-xs"}
                              />
                              {hasMath(cell.content) && (
                                <div className="text-xs mt-0.5">
                                  <MathText text={cell.content} />
                                </div>
                              )}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            );

          case "signature_row":
            return (
              <div key={i} className="space-y-1">
                <BlockTag icon={PenLine} label="Chữ ký" />
                <div
                  className="grid gap-3"
                  style={{ gridTemplateColumns: `repeat(${block.columns.length}, minmax(0,1fr))` }}
                >
                  {block.columns.map((col, ci) => (
                    <div key={ci} className="text-center space-y-1">
                      <AutoTextarea
                        ariaLabel="Tiêu đề chữ ký"
                        value={col.title}
                        onChange={(v) => {
                          const columns = block.columns.slice();
                          columns[ci] = { ...col, title: v };
                          updateBlock(i, { ...block, columns });
                        }}
                        className="font-semibold text-center text-xs"
                      />
                      <div className="h-10" />
                      <AutoTextarea
                        ariaLabel="Tên người ký"
                        value={col.name ?? ""}
                        onChange={(v) => {
                          const columns = block.columns.slice();
                          columns[ci] = { ...col, name: v };
                          updateBlock(i, { ...block, columns });
                        }}
                        className="font-semibold text-center text-xs"
                      />
                    </div>
                  ))}
                </div>
              </div>
            );

          case "image":
            return (
              <div key={i} className="space-y-1">
                <BlockTag icon={ImageIcon} label="Hình minh họa" />
                <div className="rounded-lg border border-ink/15 bg-ink/[0.02] p-2 flex items-start gap-3">
                  {block.dataUrl ? (
                    <img
                      src={block.dataUrl}
                      alt={block.caption ?? "Hình minh họa"}
                      className="max-h-32 rounded border border-ink/10 shrink-0"
                    />
                  ) : (
                    <div className="h-16 w-24 shrink-0 rounded border border-dashed border-ink/20 flex items-center justify-center text-[10px] text-ink/35 text-center px-1">
                      Đang cắt hình...
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <AutoTextarea
                      ariaLabel="Chú thích hình"
                      value={block.caption ?? ""}
                      onChange={(v) => updateBlock(i, { ...block, caption: v })}
                      className="text-xs italic"
                    />
                  </div>
                </div>
              </div>
            );

          case "page_break":
            return (
              <div key={i} className="flex items-center gap-2 py-1 text-ink/30">
                <div className="flex-1 border-t border-dashed border-ink/20" />
                <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide">
                  <FileStack className="h-3 w-3" /> Ngắt trang
                </span>
                <div className="flex-1 border-t border-dashed border-ink/20" />
              </div>
            );

          case "spacer":
          default:
            return <div key={i} className="h-2" />;
        }
      })}
    </div>
  );
}
