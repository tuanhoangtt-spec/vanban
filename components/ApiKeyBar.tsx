"use client";

import { useEffect, useState } from "react";
import { KeyRound, Eye, EyeOff, CheckCircle2, ExternalLink } from "lucide-react";

const STORAGE_KEY = "vn-ocr-docx:gemini-api-key";

export function useApiKey() {
  const [apiKey, setApiKey] = useState("");
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved) setApiKey(saved);
    setLoaded(true);
  }, []);

  const save = (key: string) => {
    setApiKey(key);
    if (key.trim()) {
      window.localStorage.setItem(STORAGE_KEY, key.trim());
    } else {
      window.localStorage.removeItem(STORAGE_KEY);
    }
  };

  return { apiKey, setApiKey: save, loaded };
}

export function ApiKeyBar({
  apiKey,
  onChange,
}: {
  apiKey: string;
  onChange: (key: string) => void;
}) {
  const [visible, setVisible] = useState(false);
  const [draft, setDraft] = useState(apiKey);

  useEffect(() => setDraft(apiKey), [apiKey]);

  return (
    <div className="rounded-2xl border border-ink/10 bg-white shadow-card p-4 sm:p-5">
      <div className="flex items-center gap-2 mb-2">
        <KeyRound className="h-4 w-4 text-accent" strokeWidth={2.25} />
        <label htmlFor="gemini-key" className="text-sm font-semibold tracking-tight">
          Google Gemini API Key
        </label>
        {apiKey && (
          <span className="inline-flex items-center gap-1 text-xs text-accent bg-accentSoft rounded-full px-2 py-0.5 ml-auto">
            <CheckCircle2 className="h-3 w-3" /> Đã lưu trên trình duyệt này
          </span>
        )}
      </div>
      <div className="flex gap-2">
        <div className="relative flex-1">
          <input
            id="gemini-key"
            type={visible ? "text" : "password"}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => onChange(draft)}
            placeholder="Dán API Key của bạn tại đây (AIza...)"
            className="w-full rounded-xl border border-ink/15 bg-paper/60 px-3.5 py-2.5 text-sm font-mono outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent transition"
            autoComplete="off"
            spellCheck={false}
          />
          <button
            type="button"
            onClick={() => setVisible((v) => !v)}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-ink/40 hover:text-ink/70 transition"
            aria-label={visible ? "Ẩn API key" : "Hiện API key"}
          >
            {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
      </div>
      <p className="mt-2.5 text-xs text-ink/50 leading-relaxed">
        Key chỉ được lưu cục bộ trong trình duyệt của bạn (localStorage), không gửi
        về máy chủ nào khác ngoài Google. Chưa có key?{" "}
        <a
          href="https://aistudio.google.com/app/apikey"
          target="_blank"
          rel="noreferrer"
          className="text-accent underline underline-offset-2 inline-flex items-center gap-0.5"
        >
          Lấy miễn phí tại Google AI Studio <ExternalLink className="h-3 w-3" />
        </a>
      </p>
    </div>
  );
}
