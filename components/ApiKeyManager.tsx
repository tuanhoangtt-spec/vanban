"use client";

import { useEffect, useState } from "react";
import {
  KeyRound,
  Plus,
  Trash2,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import type { ApiKeyEntry } from "@/types";
import { loadKeys, saveKeys, addKey, removeKey, isExhausted } from "@/utils/apiKeyPool";

export function useApiKeyPool() {
  const [keys, setKeys] = useState<ApiKeyEntry[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setKeys(loadKeys());
    setLoaded(true);
  }, []);

  const update = (next: ApiKeyEntry[]) => {
    setKeys(next);
    saveKeys(next);
  };

  return { keys, setKeys: update, loaded };
}

function maskKey(key: string) {
  if (key.length <= 8) return "••••••";
  return `${key.slice(0, 4)}${"•".repeat(Math.max(4, key.length - 8))}${key.slice(-4)}`;
}

export function ApiKeyManager({
  keys,
  onChange,
}: {
  keys: ApiKeyEntry[];
  onChange: (keys: ApiKeyEntry[]) => void;
}) {
  const [draft, setDraft] = useState("");
  const [expanded, setExpanded] = useState(keys.length <= 1);

  const availableCount = keys.filter((k) => !isExhausted(k)).length;

  const handleAdd = () => {
    if (!draft.trim()) return;
    onChange(addKey(keys, draft));
    setDraft("");
  };

  return (
    <div className="rounded-2xl border border-ink/10 bg-white shadow-card p-4 sm:p-5">
      <div className="flex items-center gap-2 mb-2">
        <KeyRound className="h-4 w-4 text-accent" strokeWidth={2.25} />
        <h2 className="text-sm font-semibold tracking-tight">Google Gemini API Key</h2>

        {keys.length > 0 && (
          <span
            className={[
              "inline-flex items-center gap-1 text-xs rounded-full px-2 py-0.5 ml-auto",
              availableCount > 0 ? "text-accent bg-accentSoft" : "text-warn bg-warn/10",
            ].join(" ")}
          >
            {availableCount > 0 ? (
              <>
                <CheckCircle2 className="h-3 w-3" />
                {availableCount}/{keys.length} key sẵn sàng
              </>
            ) : (
              <>
                <AlertCircle className="h-3 w-3" />
                Tất cả key đã hết quota hôm nay
              </>
            )}
          </span>
        )}

        {keys.length > 1 && (
          <button
            onClick={() => setExpanded((v) => !v)}
            className="text-ink/40 hover:text-ink/70 transition"
            aria-label={expanded ? "Thu gọn" : "Mở rộng"}
          >
            {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
        )}
      </div>

      <div className="flex gap-2 mb-2">
        <input
          type="password"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleAdd()}
          placeholder="Dán API Key tại đây (AIzaSy...) rồi bấm Thêm"
          className="flex-1 rounded-xl border border-ink/15 bg-paper/60 px-3.5 py-2.5 text-sm font-mono outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent transition"
          autoComplete="off"
          spellCheck={false}
        />
        <button
          onClick={handleAdd}
          disabled={!draft.trim()}
          className="inline-flex items-center gap-1.5 rounded-xl bg-accent text-white text-sm font-semibold px-3.5 py-2.5 hover:bg-accent/90 transition disabled:opacity-40"
        >
          <Plus className="h-4 w-4" /> Thêm
        </button>
      </div>

      {expanded && keys.length > 0 && (
        <ul className="space-y-1.5 mb-2">
          {keys.map((k) => {
            const exhausted = isExhausted(k);
            return (
              <li
                key={k.id}
                className="flex items-center gap-2 rounded-lg border border-ink/10 px-3 py-2 text-xs"
              >
                <span
                  className={[
                    "h-1.5 w-1.5 rounded-full shrink-0",
                    exhausted ? "bg-warn" : "bg-emerald-500",
                  ].join(" ")}
                />
                <span className="font-semibold shrink-0">{k.label}</span>
                <span className="font-mono text-ink/40 truncate">{maskKey(k.key)}</span>
                <span
                  className={[
                    "ml-auto shrink-0 font-medium",
                    exhausted ? "text-warn" : "text-emerald-600",
                  ].join(" ")}
                >
                  {exhausted ? "Hết quota hôm nay" : "Sẵn sàng"}
                </span>
                <button
                  onClick={() => onChange(removeKey(keys, k.id))}
                  aria-label={`Xóa ${k.label}`}
                  className="text-ink/30 hover:text-warn transition shrink-0"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <p className="text-xs text-ink/50 leading-relaxed">
        Có thể thêm nhiều API Key — khi một key hết hạn mức (quota) trong ngày, hệ thống sẽ tự
        động chuyển sang key tiếp theo còn khả dụng. Key chỉ lưu cục bộ trong trình duyệt này.{" "}
        <a
          href="https://aistudio.google.com/app/apikey"
          target="_blank"
          rel="noreferrer"
          className="text-accent underline underline-offset-2 inline-flex items-center gap-0.5"
        >
          Lấy key miễn phí tại Google AI Studio <ExternalLink className="h-3 w-3" />
        </a>
      </p>
    </div>
  );
}
