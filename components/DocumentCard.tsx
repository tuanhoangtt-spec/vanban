"use client";

import { useState } from "react";
import {
  ScanLine,
  Loader2,
  AlertTriangle,
  Download,
  Trash2,
  RefreshCcw,
  ImageIcon,
} from "lucide-react";
import type { UploadedImage, ParsedDocument } from "@/types";
import { BlockEditor } from "./BlockEditor";
import { downloadDocx } from "@/utils/docxGenerator";

export function DocumentCard({
  image,
  onScan,
  onRemove,
  onResultChange,
}: {
  image: UploadedImage;
  onScan: (id: string) => void;
  onRemove: (id: string) => void;
  onResultChange: (id: string, doc: ParsedDocument) => void;
}) {
  const [filename, setFilename] = useState(
    image.file.name.replace(/\.[^/.]+$/, "") || "van-ban"
  );
  const [downloading, setDownloading] = useState(false);

  const handleDownload = async () => {
    if (!image.result) return;
    setDownloading(true);
    try {
      await downloadDocx(image.result, filename);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="rounded-2xl border border-ink/10 bg-white shadow-card overflow-hidden">
      <div className="flex flex-col sm:flex-row">
        {/* Left: original image preview */}
        <div className="sm:w-56 shrink-0 bg-ink/5 relative">
          <img
            src={image.previewUrl}
            alt={image.file.name}
            className="w-full h-48 sm:h-full object-cover"
          />
          <div className="absolute top-2 left-2 inline-flex items-center gap-1 bg-black/55 text-white text-[10px] px-2 py-1 rounded-full backdrop-blur-sm">
            <ImageIcon className="h-3 w-3" />
            <span className="max-w-[8rem] truncate">{image.file.name}</span>
          </div>
        </div>

        {/* Right: status / actions / preview */}
        <div className="flex-1 p-4 sm:p-5 min-w-0">
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <StatusPill status={image.status} error={image.error} />

            <div className="ml-auto flex items-center gap-2">
              {(image.status === "idle" || image.status === "error") && (
                <button
                  onClick={() => onScan(image.id)}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-accent text-white text-xs font-semibold px-3 py-2 hover:bg-accent/90 transition"
                >
                  <ScanLine className="h-3.5 w-3.5" />
                  {image.status === "error" ? "Quét lại" : "Quét & Chuyển đổi"}
                </button>
              )}
              {image.status === "done" && (
                <button
                  onClick={() => onScan(image.id)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-ink/15 text-ink/70 text-xs font-semibold px-3 py-2 hover:bg-ink/5 transition"
                >
                  <RefreshCcw className="h-3.5 w-3.5" />
                  Quét lại
                </button>
              )}
              <button
                onClick={() => onRemove(image.id)}
                aria-label="Xóa ảnh"
                className="inline-flex items-center justify-center rounded-lg border border-ink/15 text-ink/50 h-8 w-8 hover:bg-warn/10 hover:text-warn hover:border-warn/30 transition"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          {image.status === "processing" && (
            <div className="flex items-center gap-2 text-sm text-ink/50 py-6 justify-center">
              <Loader2 className="h-4 w-4 animate-spin" />
              Gemini đang đọc ảnh, vui lòng chờ trong giây lát...
            </div>
          )}

          {image.status === "error" && (
            <div className="flex items-start gap-2 text-sm text-warn bg-warn/5 border border-warn/20 rounded-lg p-3">
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
              <span>{image.error}</span>
            </div>
          )}

          {image.status === "done" && image.result && (
            <>
              {image.usedKeyLabel && (
                <p className="text-[11px] text-ink/35 mb-2">
                  Đã quét bằng <span className="font-medium text-ink/50">{image.usedKeyLabel}</span>
                </p>
              )}
              <div className="max-h-80 overflow-y-auto rounded-lg border border-ink/10 bg-paper/50 p-3 mb-3">
                <BlockEditor
                  document={image.result}
                  onChange={(doc) => onResultChange(image.id, doc)}
                />
              </div>

              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  value={filename}
                  onChange={(e) => setFilename(e.target.value)}
                  className="flex-1 rounded-lg border border-ink/15 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent"
                  placeholder="Tên file"
                />
                <button
                  onClick={handleDownload}
                  disabled={downloading}
                  className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-ink text-white text-sm font-semibold px-4 py-2 hover:bg-ink/85 transition disabled:opacity-60"
                >
                  {downloading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Download className="h-4 w-4" />
                  )}
                  Tải về Word (.docx)
                </button>
              </div>
            </>
          )}

          {image.status === "idle" && (
            <p className="text-sm text-ink/40 py-6 text-center">
              Bấm "Quét & Chuyển đổi" để bắt đầu nhận diện nội dung ảnh này.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function StatusPill({ status, error }: { status: UploadedImage["status"]; error?: string }) {
  const map: Record<UploadedImage["status"], { label: string; className: string }> = {
    idle: { label: "Chưa quét", className: "bg-ink/5 text-ink/50" },
    uploading: { label: "Đang tải...", className: "bg-accentSoft text-accent" },
    processing: { label: "Đang xử lý AI", className: "bg-accentSoft text-accent" },
    done: { label: "Hoàn tất", className: "bg-emerald-50 text-emerald-700" },
    error: { label: "Lỗi", className: "bg-warn/10 text-warn" },
  };
  const { label, className } = map[status];
  return (
    <span className={`text-[11px] font-semibold px-2.5 py-1 rounded-full ${className}`} title={error}>
      {label}
    </span>
  );
}
