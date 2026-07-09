import type { ApiKeyEntry } from "@/types";

const STORAGE_KEY = "vn-ocr-docx:gemini-api-keys";
const LEGACY_SINGLE_KEY = "vn-ocr-docx:gemini-api-key";

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

/** Midnight (local time) of the next day — used as the default "quota resets" estimate. */
function nextLocalMidnight(): number {
  const d = new Date();
  d.setHours(24, 0, 0, 0);
  return d.getTime();
}

export function loadKeys(): ApiKeyEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed: ApiKeyEntry[] = JSON.parse(raw);
      // Auto-clear exhaustion flags once their reset time has passed.
      const now = Date.now();
      return parsed.map((k) =>
        k.exhaustedUntil && k.exhaustedUntil <= now
          ? { ...k, exhaustedUntil: undefined }
          : k
      );
    }
    // Migrate a key saved by the previous single-key version of the app.
    const legacy = window.localStorage.getItem(LEGACY_SINGLE_KEY);
    if (legacy) {
      const migrated: ApiKeyEntry[] = [{ id: uid(), key: legacy, label: "Key 1" }];
      saveKeys(migrated);
      window.localStorage.removeItem(LEGACY_SINGLE_KEY);
      return migrated;
    }
  } catch {
    // ignore corrupt storage
  }
  return [];
}

export function saveKeys(keys: ApiKeyEntry[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(keys));
}

export function addKey(keys: ApiKeyEntry[], rawKey: string, label?: string): ApiKeyEntry[] {
  const trimmed = rawKey.trim();
  if (!trimmed) return keys;
  if (keys.some((k) => k.key === trimmed)) return keys; // no duplicates
  const next: ApiKeyEntry[] = [
    ...keys,
    { id: uid(), key: trimmed, label: label?.trim() || `Key ${keys.length + 1}` },
  ];
  saveKeys(next);
  return next;
}

export function removeKey(keys: ApiKeyEntry[], id: string): ApiKeyEntry[] {
  const next = keys.filter((k) => k.id !== id);
  saveKeys(next);
  return next;
}

export function markExhausted(keys: ApiKeyEntry[], id: string): ApiKeyEntry[] {
  const next = keys.map((k) =>
    k.id === id ? { ...k, exhaustedUntil: nextLocalMidnight() } : k
  );
  saveKeys(next);
  return next;
}

export function markUsed(keys: ApiKeyEntry[], id: string): ApiKeyEntry[] {
  const next = keys.map((k) => (k.id === id ? { ...k, lastUsedAt: Date.now() } : k));
  saveKeys(next);
  return next;
}

export function isExhausted(k: ApiKeyEntry): boolean {
  return !!k.exhaustedUntil && k.exhaustedUntil > Date.now();
}

/** Ordered list of keys to try: available keys first (least-recently-used first), then exhausted ones last as a last resort. */
export function orderedForAttempt(keys: ApiKeyEntry[]): ApiKeyEntry[] {
  const available = keys.filter((k) => !isExhausted(k));
  const exhausted = keys.filter(isExhausted);
  const byLru = (a: ApiKeyEntry, b: ApiKeyEntry) => (a.lastUsedAt ?? 0) - (b.lastUsedAt ?? 0);
  return [...available.sort(byLru), ...exhausted.sort(byLru)];
}
