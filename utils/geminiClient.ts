import { GoogleGenAI, ApiError } from "@google/genai";
import { SYSTEM_INSTRUCTION, USER_PROMPT } from "./geminiPrompt";
import { orderedForAttempt, markExhausted, markUsed } from "./apiKeyPool";
import type { ApiKeyEntry, ParsedDocument, DocumentBlock } from "@/types";

// Model history: gemini-1.5-flash was fully retired in 2026 (404 on every
// request). gemini-2.5-flash was the next stable pick, but Google has been
// returning 404 for it on some API keys well before its official "no
// earlier than Oct 16, 2026" shutdown date (widely reported on Google's own
// developer forum since July 2026) — Google's deprecation rollout for this
// model has not been consistent across all accounts/regions.
//
// To avoid the app going dark again the next time Google flips a switch,
// we try a short list of candidates in order instead of hardcoding one
// name. "gemini-flash-latest" is Google's own recommended alias for this
// exact problem — it always resolves server-side to whatever the current
// GA Flash model is, so it should keep working across future renames
// without a code change. The two explicit fallbacks are current (Aug 2026)
// stable, vision-capable models kept as a safety net in case the alias
// itself is ever the one returning 404.
const MODEL_CANDIDATES = ["gemini-flash-latest", "gemini-2.5-flash", "gemini-3.5-flash"] as const;

export class GeminiError extends Error {
  code:
    | "MISSING_KEY"
    | "INVALID_KEY"
    | "QUOTA"
    | "NETWORK"
    | "PARSE"
    | "MODEL_NOT_FOUND"
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
    "page_break",
    "image",
  ]);
  for (const b of blocks) {
    if (!b || typeof b !== "object" || !allowedTypes.has((b as any).type)) {
      throw new GeminiError("PARSE", "Có block với định dạng không hợp lệ trong dữ liệu AI trả về.");
    }
  }
  return blocks as DocumentBlock[];
}

/** Classify a raw error thrown by the SDK/fetch into one of our GeminiError codes. */
function classifyError(err: unknown, model?: string): GeminiError {
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
        "MODEL_NOT_FOUND",
        `Model "${model ?? "?"}" không khả dụng với API Key này (404). Đang thử model dự phòng...`
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

// Gemini's inline request payload has a hard ceiling (base64 inflates bytes
// ~1.33x); staying comfortably under it avoids opaque failures for big scans
// or many-page PDFs. Files above this should be split or use the Files API
// (not implemented here to keep the app fully client-side / serverless).
const MAX_FILE_SIZE_BYTES = 18 * 1024 * 1024; // ~18MB on disk

async function callGemini(apiKey: string, file: File): Promise<ParsedDocument> {
  if (file.size > MAX_FILE_SIZE_BYTES) {
    throw new GeminiError(
      "UNKNOWN",
      `File "${file.name}" quá lớn (${(file.size / 1024 / 1024).toFixed(1)}MB). Vui lòng dùng file dưới ${MAX_FILE_SIZE_BYTES / 1024 / 1024}MB, hoặc nén/giảm số trang PDF.`
    );
  }

  const ai = new GoogleGenAI({ apiKey });
  const base64 = await fileToBase64(file);

  let resultText: string | undefined;

  // Try each candidate model in order. We only move on to the next
  // candidate when the CURRENT one specifically 404s (model retired /
  // not available for this key) — any other error (bad key, quota,
  // network, safety block) is real and should surface immediately rather
  // than being masked by silently retrying with a different model.
  for (const model of MODEL_CANDIDATES) {
    try {
      const response = await ai.models.generateContent({
        model,
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
          // Gemini Flash models have "thinking" on by default, and thinking
          // tokens are deducted from the SAME budget as the visible output.
          // On dense documents (big tables, lots of handwriting) the model
          // can burn the entire default budget on internal reasoning and
          // return an EMPTY response with finishReason "MAX_TOKENS" — no
          // error, just nothing. Capping the thinking budget and raising
          // maxOutputTokens generously guarantees room is left for the
          // actual JSON to be written out.
          //
          // Images used to get a smaller budget than PDFs on the assumption
          // they'd be simpler (e.g. one photographed page). Real-world
          // testing with a dense government form (CT01 — 84 table cells
          // across a household-member grid and two digit-box sequences, all
          // as a single JPG) showed that assumption was wrong: the model
          // was cut off mid-JSON at 16384 tokens. Images can be just as
          // content-dense as PDF pages, so both now get the same generous
          // budget.
          maxOutputTokens: 32768,
          thinkingConfig: { thinkingBudget: 4096 },
        },
      });

      const finishReason = response.candidates?.[0]?.finishReason;
      const text = response.text ?? "";

      // Check finishReason BEFORE looking at whether resultText is empty.
      // Truncation from hitting maxOutputTokens doesn't always leave an
      // empty response — it can leave a partial, non-empty chunk of JSON
      // cut off mid-string/mid-object. That partial text would previously
      // skip this whole block (since the old check only ran when resultText
      // was empty) and fall through to a plain JSON.parse() failure below,
      // surfacing a generic "AI trả về dữ liệu không đúng định dạng JSON"
      // error that gave no hint about *why* — even though we already knew
      // exactly why.
      if (finishReason === "MAX_TOKENS") {
        throw new GeminiError(
          "PARSE",
          "Ảnh/PDF có quá nhiều nội dung khiến AI chưa viết xong phản hồi trong giới hạn token. Vui lòng thử lại, hoặc chụp/crop ảnh thành từng phần nhỏ hơn nếu ảnh có rất nhiều chữ."
        );
      }
      if (finishReason === "SAFETY" || finishReason === "PROHIBITED_CONTENT") {
        throw new GeminiError(
          "PARSE",
          "Gemini từ chối xử lý ảnh này (bị chặn bởi bộ lọc an toàn nội dung). Vui lòng thử ảnh khác."
        );
      }
      if (!text.trim()) {
        throw new GeminiError(
          "PARSE",
          `AI trả về phản hồi rỗng (finishReason: ${finishReason ?? "không rõ"}). Vui lòng thử quét lại.`
        );
      }
      resultText = text;
      break; // success — stop trying further candidates
    } catch (err) {
      const geminiErr = err instanceof GeminiError ? err : classifyError(err, model);
      if (geminiErr.code === "MODEL_NOT_FOUND") {
        resultText = undefined;
        continue; // this model is gone for this key — try the next candidate
      }
      throw geminiErr;
    }
  }

  if (resultText === undefined) {
    throw new GeminiError(
      "MODEL_NOT_FOUND",
      `Không có model Gemini nào khả dụng với API Key này (đã thử: ${MODEL_CANDIDATES.join(", ")}). Model có thể đã bị Google ngừng hỗ trợ hoàn toàn cho key này, hoặc key chưa được cấp quyền dùng Gemini. Vui lòng kiểm tra lại API Key trong Google AI Studio, hoặc báo cho người phát triển để cập nhật danh sách model.`
    );
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
