import { GoogleGenerativeAI } from "@google/generative-ai";
import { SYSTEM_INSTRUCTION, USER_PROMPT } from "./geminiPrompt";
import type { ParsedDocument, DocumentBlock } from "@/types";

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

function fileToGenerativePart(file: File): Promise<{ inlineData: { data: string; mimeType: string } }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.split(",")[1] ?? "";
      resolve({ inlineData: { data: base64, mimeType: file.type || "image/jpeg" } });
    };
    reader.onerror = () => reject(new GeminiError("UNKNOWN", "Không thể đọc file ảnh."));
    reader.readAsDataURL(file);
  });
}

/** Strip ```json fences etc, then attempt to locate the outermost {...} object. */
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

export async function scanImageToDocument(
  apiKey: string,
  file: File
): Promise<ParsedDocument> {
  if (!apiKey || !apiKey.trim()) {
    throw new GeminiError("MISSING_KEY", "Vui lòng nhập Google Gemini API Key trước khi quét.");
  }

  let genAI: GoogleGenerativeAI;
  try {
    genAI = new GoogleGenerativeAI(apiKey.trim());
  } catch {
    throw new GeminiError("INVALID_KEY", "API Key không hợp lệ.");
  }

  const model = genAI.getGenerativeModel({
    model: "gemini-1.5-flash",
    systemInstruction: SYSTEM_INSTRUCTION,
    generationConfig: {
      temperature: 0.1,
      responseMimeType: "application/json",
    },
  });

  const imagePart = await fileToGenerativePart(file);

  let resultText: string;
  try {
    const result = await model.generateContent([USER_PROMPT, imagePart]);
    resultText = result.response.text();
  } catch (err: any) {
    const message: string = err?.message || "";
    if (message.includes("API key not valid") || message.includes("API_KEY_INVALID")) {
      throw new GeminiError("INVALID_KEY", "API Key không đúng hoặc đã bị thu hồi. Vui lòng kiểm tra lại.");
    }
    if (message.includes("429") || message.toLowerCase().includes("quota")) {
      throw new GeminiError("QUOTA", "Đã vượt hạn mức sử dụng API (quota). Vui lòng thử lại sau hoặc kiểm tra gói cước Gemini API.");
    }
    if (message.toLowerCase().includes("fetch") || message.toLowerCase().includes("network")) {
      throw new GeminiError("NETWORK", "Lỗi kết nối mạng khi gọi Gemini API. Vui lòng kiểm tra kết nối Internet.");
    }
    throw new GeminiError("UNKNOWN", `Lỗi không xác định từ Gemini API: ${message || "vui lòng thử lại."}`);
  }

  let parsed: unknown;
  try {
    const jsonStr = extractJson(resultText);
    parsed = JSON.parse(jsonStr);
  } catch (err) {
    if (err instanceof GeminiError) throw err;
    throw new GeminiError("PARSE", "AI trả về dữ liệu không đúng định dạng JSON. Vui lòng thử quét lại.");
  }

  const blocksRaw = (parsed as any)?.blocks;
  const blocks = validateBlocks(blocksRaw);

  if (blocks.length === 0) {
    throw new GeminiError("PARSE", "AI không đọc được nội dung nào từ ảnh. Vui lòng thử ảnh rõ nét hơn.");
  }

  return { blocks };
}
