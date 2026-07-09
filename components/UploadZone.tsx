"use client";

import { useCallback } from "react";
import { useDropzone } from "react-dropzone";
import { UploadCloud, ImagePlus } from "lucide-react";

export function UploadZone({
  onFiles,
}: {
  onFiles: (files: File[]) => void;
}) {
  const onDrop = useCallback(
    (accepted: File[]) => {
      if (accepted.length) onFiles(accepted);
    },
    [onFiles]
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      "image/jpeg": [".jpg", ".jpeg"],
      "image/png": [".png"],
      "image/webp": [".webp"],
      "application/pdf": [".pdf"],
    },
    multiple: true,
  });

  return (
    <div
      {...getRootProps()}
      className={[
        "group relative cursor-pointer rounded-2xl border-2 border-dashed transition-all",
        "flex flex-col items-center justify-center text-center px-6 py-12 sm:py-16",
        isDragActive
          ? "border-accent bg-accentSoft"
          : "border-ink/20 bg-white hover:border-accent/60 hover:bg-accentSoft/40",
      ].join(" ")}
    >
      <input {...getInputProps()} />
      <div
        className={[
          "h-14 w-14 rounded-full flex items-center justify-center mb-4 transition-colors",
          isDragActive ? "bg-accent text-white" : "bg-accentSoft text-accent",
        ].join(" ")}
      >
        {isDragActive ? (
          <UploadCloud className="h-6 w-6" strokeWidth={2} />
        ) : (
          <ImagePlus className="h-6 w-6" strokeWidth={2} />
        )}
      </div>
      <p className="font-serif text-lg font-semibold text-ink">
        {isDragActive ? "Thả ảnh vào đây" : "Kéo thả ảnh văn bản vào đây"}
      </p>
      <p className="text-sm text-ink/50 mt-1">
        hoặc bấm để chọn file — hỗ trợ .jpg, .png, .webp, .pdf (nhiều trang) — có thể chọn nhiều file cùng lúc
      </p>
    </div>
  );
}
