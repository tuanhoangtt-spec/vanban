import { GoogleGenAI, ApiError } from "@google/genai";
import { SYSTEM_INSTRUCTION, USER_PROMPT } from "./geminiPrompt";
import { orderedForAttempt, markExhausted, markUsed } from "./apiKeyPool";
import type { ApiKeyEntry, ParsedDocument, DocumentBlock } from "@/types";

// gemini-1.5-flash was fully retired in 2026 (requests now 404). Gemini 2.5
// Flash is the current stable, vision-capable, cost-efficient model as of
// this writing. Kept as a single constant so it's easy to bump later.
const MODEL = "gemini-2.5-flash";

export class GeminiError extends Error {
  code:
    | "MISSING_KEY"
    | "INVALID_KEY"
    | "QUOTA"
    | "NETWORK"
    | "PARSE"
    | "UNKNOWN";
  constructor(code: GeminiError["code"], message: string) {
    super(message);
    this.code = code;
    this.name = "GeminiError";
  }
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.split(",")[1] ?? "");
    };
    reader.onerror = () => reject(new GeminiError("UNKNOWN", "Không thể đọc file ảnh."));
    reader.readAsDataURL(file);
  });
}

function extractJson(raw: string): string {
  let text = raw.trim();
  text = text.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "");
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) {
    throw new GeminiError("PARSE", "Không tìm thấy JSON hợp lệ trong phản hồi của AI.");
  }
  return text.slice(start, end + 1);
}

function validateBlocks(blocks: unknown): DocumentBlock[] {
  if (!Array.isArray(blocks)) {
    throw new GeminiError("PARSE", "Dữ liệu trả về không phải là danh sách block hợp lệ.");
  }
  const allowedTypes = new Set([
    "heading",
    "paragraph",
    "dotted_line",
    "table",
    "signature_row",
    "spacer",
  ]);
  for (const b of blocks) {
    if (!b || typeof b !== "object" || !allowedTypes.has((b as any).type)) {
      throw new GeminiError("PARSE", "Có block với định dạng không hợp lệ trong dữ liệu AI trả về.");
    }
  }
  return blocks as DocumentBlock[];
}

/** Classify a raw error thrown by the SDK/fetch into one of our GeminiError codes. */
function classifyError(err: unknown): GeminiError {
  if (err instanceof ApiError) {
    const status = err.status;
    if (status === 400 || status === 401 || status === 403) {
      return new GeminiError(
        "INVALID_KEY",
        "API Key không đúng, không có quyền truy cập model, hoặc chưa bật billing cho project. Vui lòng kiểm tra lại trong Google AI Studio."
      );
    }
    if (status === 404) {
      return new GeminiError(
        "UNKNOWN",
        `Model "${MODEL}" không khả dụng với API Key này (404). Model có thể đã bị Google ngừng hỗ trợ — vui lòng báo cho người phát triển để cập nhật tên model.`
      );
    }
    if (status === 429) {
      return new GeminiError("QUOTA", "Đã vượt hạn mức sử dụng (quota) của API Key này.");
    }
    if (status && status >= 500) {
      return new GeminiError(
        "NETWORK",
        "Máy chủ Gemini đang gặp sự cố tạm thời (lỗi 5xx). Vui lòng thử lại sau ít phút."
      );
    }
    return new GeminiError("UNKNOWN", `Lỗi từ Gemini API (mã ${status ?? "?"}): ${err.message}`);
  }

  const message = err instanceof Error ? err.message : String(err);
  if (/failed to fetch|network|ENOTFOUND|ECONNREFUSED/i.test(message)) {
    return new GeminiError(
      "NETWORK",
      "Lỗi kết nối mạng khi gọi Gemini API. Vui lòng kiểm tra kết nối Internet, tường lửa, hoặc trình chặn quảng cáo có thể đang chặn generativelanguage.googleapis.com."
    );
  }
  return new GeminiError("UNKNOWN", `Lỗi không xác định: ${message}`);
}

async function callGemini(apiKey: string, file: File): Promise<ParsedDocument> {
  const ai = new GoogleGenAI({ apiKey });
  const base64 = await fileToBase64(file);

  let resultText: string;
  try {
    const response = await ai.models.generateContent({
      model: MODEL,
      contents: [
        {
          role: "user",
          parts: [
            { text: USER_PROMPT },
            { inlineData: { mimeType: file.type || "image/jpeg", data: base64 } },
          ],
        },
      ],
      config: {
        systemInstruction: SYSTEM_INSTRUCTION,
        temperature: 0.1,
        responseMimeType: "application/json",
      },
    });
    resultText = response.text ?? "";
  } catch (err) {
    throw classifyError(err);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJson(resultText));
  } catch (err) {
    if (err instanceof GeminiError) throw err;
    throw new GeminiError("PARSE", "AI trả về dữ liệu không đúng định dạng JSON. Vui lòng thử quét lại.");
  }

  const blocks = validateBlocks((parsed as any)?.blocks);
  if (blocks.length === 0) {
    throw new GeminiError("PARSE", "AI không đọc được nội dung nào từ ảnh. Vui lòng thử ảnh rõ nét hơn.");
  }
  return { blocks };
}

export type ScanOutcome = {
  document: ParsedDocument;
  usedKey: ApiKeyEntry;
  keys: ApiKeyEntry[]; // updated pool (exhaustion/usage timestamps) to persist
};

/**
 * Scans an image using the first available key in the pool. If a key comes
 * back with a QUOTA error, it's marked exhausted (until the next local
 * midnight) and the next available key is tried automatically, so the user
 * doesn't have to swap keys by hand once their daily free-tier limit is hit.
 */
export async function scanImageWithKeyPool(
  keysIn: ApiKeyEntry[],
  file: File
): Promise<ScanOutcome> {
  if (keysIn.length === 0) {
    throw new GeminiError("MISSING_KEY", "Vui lòng thêm ít nhất một Google Gemini API Key trước khi quét.");
  }

  let keys = keysIn;
  const attemptOrder = orderedForAttempt(keys);
  let lastError: GeminiError | null = null;

  for (const candidate of attemptOrder) {
    keys = markUsed(keys, candidate.id);
    try {
      const document = await callGemini(candidate.key, file);
      return { document, usedKey: candidate, keys };
    } catch (err) {
      const geminiErr = err instanceof GeminiError ? err : classifyError(err);
      lastError = geminiErr;
      if (geminiErr.code === "QUOTA") {
        keys = markExhausted(keys, candidate.id);
        continue; // try the next key in the pool
      }
      // Any other error (invalid key, network, parse) is specific to this
      // attempt — surface it immediately instead of silently trying more keys.
      throw geminiErr;
    }
  }

  throw (
    lastError ??
    new GeminiError("QUOTA", "Tất cả API Key trong danh sách đều đã hết hạn mức hôm nay.")
  );
}
