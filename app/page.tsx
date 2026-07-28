"use client";

import { useState } from "react";
import { FileText, ScanLine, Sparkles } from "lucide-react";
import { ApiKeyManager, useApiKeyPool } from "@/components/ApiKeyManager";
import { UploadZone } from "@/components/UploadZone";
import { DocumentCard } from "@/components/DocumentCard";
import { scanImageWithKeyPool, GeminiError } from "@/utils/geminiClient";
import { cropImageBlocks } from "@/utils/imageCrop";
import type { ParsedDocument, UploadedImage } from "@/types";

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

export default function Home() {
  const { keys, setKeys, loaded } = useApiKeyPool();
  const [images, setImages] = useState<UploadedImage[]>([]);

  const handleFiles = (files: File[]) => {
    const next: UploadedImage[] = files.map((file) => ({
      id: uid(),
      file,
      previewUrl: URL.createObjectURL(file),
      status: "idle",
    }));
    setImages((prev) => [...next, ...prev]);
  };

  const updateImage = (id: string, patch: Partial<UploadedImage>) => {
    setImages((prev) => prev.map((img) => (img.id === id ? { ...img, ...patch } : img)));
  };

  const handleScan = async (id: string) => {
    const target = images.find((i) => i.id === id);
    if (!target) return;

    updateImage(id, { status: "processing", error: undefined });
    try {
      const { document, usedKey, keys: updatedKeys } = await scanImageWithKeyPool(
        keys,
        target.file
      );
      setKeys(updatedKeys); // persist exhaustion/usage bookkeeping
      // Gemini only returns bounding boxes for graphic regions (rule 14) —
      // the actual pixels are cropped client-side from the file the user
      // uploaded, since Gemini never sends image bytes back.
      const withImages = await cropImageBlocks(target.file, document);
      updateImage(id, { status: "done", result: withImages, usedKeyLabel: usedKey.label });
    } catch (err) {
      // Even on failure, key exhaustion flags set during rotation attempts
      // should stick, so re-read the pool from storage on the next render.
      const message =
        err instanceof GeminiError
          ? err.message
          : "Đã xảy ra lỗi không xác định khi quét ảnh. Vui lòng thử lại.";
      updateImage(id, { status: "error", error: message });
    }
  };

  const handleRemove = (id: string) => {
    setImages((prev) => {
      const target = prev.find((i) => i.id === id);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((i) => i.id !== id);
    });
  };

  const handleResultChange = (id: string, doc: ParsedDocument) => {
    updateImage(id, { result: doc });
  };

  const scanAll = () => {
    images.filter((i) => i.status === "idle" || i.status === "error").forEach((i) => handleScan(i.id));
  };

  const pendingCount = images.filter((i) => i.status === "idle").length;

  return (
    <main className="min-h-screen">
      {/* Header */}
      <header className="border-b border-ink/10 bg-white/70 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-5 sm:px-8 py-4 flex items-center gap-3">
          <div className="h-9 w-9 rounded-full bg-ink text-white flex items-center justify-center shrink-0">
            <ScanLine className="h-4.5 w-4.5" strokeWidth={2.25} />
          </div>
          <div className="leading-tight">
            <h1 className="font-serif font-bold text-lg tracking-tight">Quét Văn Bản → Word</h1>
            <p className="text-xs text-ink/45">Ảnh giấy tờ tiếng Việt, chữ viết tay, bảng biểu → file .docx chuẩn văn phòng</p>
          </div>
          <span className="ml-auto hidden sm:inline-flex items-center gap-1 text-[11px] font-semibold text-accent bg-accentSoft px-2.5 py-1 rounded-full">
            <Sparkles className="h-3 w-3" /> Chạy bằng Gemini 2.5 Flash
          </span>
        </div>
      </header>

      <div className="max-w-4xl mx-auto px-5 sm:px-8 py-8 space-y-6">
        {loaded && <ApiKeyManager keys={keys} onChange={setKeys} />}

        <UploadZone onFiles={handleFiles} />

        {images.length > 0 && (
          <div className="flex items-center justify-between">
            <p className="text-sm text-ink/50">
              {images.length} ảnh đã tải lên
              {pendingCount > 0 && ` · ${pendingCount} chưa quét`}
            </p>
            {pendingCount > 1 && (
              <button
                onClick={scanAll}
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-accent hover:underline"
              >
                <ScanLine className="h-3.5 w-3.5" />
                Quét tất cả ({pendingCount})
              </button>
            )}
          </div>
        )}

        <div className="space-y-4">
          {images.map((img) => (
            <DocumentCard
              key={img.id}
              image={img}
              onScan={handleScan}
              onRemove={handleRemove}
              onResultChange={handleResultChange}
            />
          ))}
        </div>

        {images.length === 0 && (
          <div className="flex flex-col items-center text-center py-14 text-ink/35">
            <FileText className="h-8 w-8 mb-3" strokeWidth={1.5} />
            <p className="text-sm">Chưa có ảnh nào. Tải ảnh lên để bắt đầu.</p>
          </div>
        )}
      </div>

      <footer className="max-w-4xl mx-auto px-5 sm:px-8 py-8 text-xs text-ink/35 text-center">
        Dữ liệu ảnh được gửi trực tiếp từ trình duyệt của bạn đến Google Gemini API bằng API Key
        của chính bạn — không đi qua máy chủ trung gian nào khác.
      </footer>
    </main>
  );
}

