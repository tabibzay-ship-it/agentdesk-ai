import { createHash, randomUUID } from "node:crypto";
import JSZip from "jszip";

export const CHAT_ATTACHMENT_BUCKET = "chat-attachments";
export const MAX_ATTACHMENT_BYTES = numberFromEnv("CHAT_ATTACHMENT_MAX_BYTES", 10 * 1024 * 1024);
export const MAX_ATTACHMENTS_PER_MESSAGE = numberFromEnv("CHAT_ATTACHMENT_MAX_COUNT", 5);
export const MAX_ACCOUNT_STORAGE_BYTES = numberFromEnv("CHAT_ATTACHMENT_ACCOUNT_MAX_BYTES", 100 * 1024 * 1024);
export const MAX_EXTRACTED_CHARS = numberFromEnv("CHAT_ATTACHMENT_MAX_EXTRACTED_CHARS", 16_000);
export const MAX_TOTAL_CONTEXT_CHARS = numberFromEnv("CHAT_ATTACHMENT_MAX_CONTEXT_CHARS", 32_000);

const ALLOWED = {
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp",
  ".pdf": "application/pdf", ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".txt": "text/plain", ".csv": "text/csv",
} as const;

export type ProcessedAttachment = {
  id: string;
  originalName: string;
  storageName: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  kind: "image" | "document";
  extractedText: string | null;
  processingStatus: "ready";
};

function numberFromEnv(name: string, fallback: number) {
  const parsed = Number(process.env[name]);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function extension(name: string) {
  const match = /\.[a-z0-9]+$/i.exec(name.trim());
  return match?.[0].toLowerCase() ?? "";
}

function xmlText(xml: string) {
  return xml
    .replace(/<w:tab\s*\/>|<a:br\s*\/>/gi, "\t")
    .replace(/<\/w:p>|<\/a:p>|<\/row>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ").replace(/\n\s+/g, "\n").trim();
}

function hasPrefix(bytes: Uint8Array, expected: number[]) {
  return expected.every((value, index) => bytes[index] === value);
}

async function extractPdf(bytes: Uint8Array) {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const loadingTask = getDocument({ data: bytes, useWorkerFetch: false });
  const document = await loadingTask.promise;
  const pages: string[] = [];
  try {
    for (let index = 1; index <= Math.min(document.numPages, 100); index += 1) {
      const page = await document.getPage(index);
      const content = await page.getTextContent();
      pages.push(content.items.map((item) => ("str" in item ? item.str : "")).join(" "));
      if (pages.join("\n").length >= MAX_EXTRACTED_CHARS) break;
    }
  } finally {
    await loadingTask.destroy();
  }
  return pages.join("\n").slice(0, MAX_EXTRACTED_CHARS).trim();
}

async function extractOffice(bytes: Uint8Array, ext: string) {
  const zip = await JSZip.loadAsync(bytes, { checkCRC32: true, createFolders: false });
  const names = Object.keys(zip.files);
  if (names.length > 5_000) throw new Error("This Office file contains too many entries.");
  if (names.some((name) => /(?:vbaProject\.bin|activeX|embeddings\/|oleObject)/i.test(name))) {
    throw new Error("Files containing macros or embedded executable objects are not supported.");
  }
  const required = ext === ".docx" ? "word/document.xml" : ext === ".xlsx" ? "xl/workbook.xml" : "ppt/presentation.xml";
  if (!zip.file("[Content_Types].xml") || !zip.file(required)) throw new Error("The file content does not match its extension.");
  const pattern = ext === ".docx" ? /^word\/(?:document|header\d+|footer\d+)\.xml$/i
    : ext === ".xlsx" ? /^xl\/(?:sharedStrings|worksheets\/sheet\d+)\.xml$/i
      : /^ppt\/slides\/slide\d+\.xml$/i;
  const parts: string[] = [];
  let totalUncompressed = 0;
  for (const name of names.filter((value) => pattern.test(value)).sort()) {
    const text = await zip.file(name)!.async("string");
    totalUncompressed += text.length;
    if (totalUncompressed > 50 * 1024 * 1024) throw new Error("The expanded document is too large to process safely.");
    parts.push(xmlText(text));
    if (parts.join("\n").length >= MAX_EXTRACTED_CHARS) break;
  }
  return parts.join("\n").slice(0, MAX_EXTRACTED_CHARS).trim();
}

export async function validateAndProcessFile(file: File): Promise<ProcessedAttachment> {
  if (!file.name || file.name.length > 180 || /[\0/\\]/.test(file.name)) throw new Error("Invalid file name.");
  if (file.size < 1 || file.size > MAX_ATTACHMENT_BYTES) throw new Error(`Files must be smaller than ${Math.floor(MAX_ATTACHMENT_BYTES / 1024 / 1024)} MB.`);
  const ext = extension(file.name);
  const expectedMime = ALLOWED[ext as keyof typeof ALLOWED];
  if (!expectedMime) throw new Error("This file type is not supported.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  // PDF.js may transfer (and therefore detach) the supplied ArrayBuffer while
  // parsing. Capture integrity metadata before any processor can mutate the
  // view so persisted size and digest always describe the uploaded bytes.
  const sizeBytes = bytes.byteLength;
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  let actualMime = expectedMime;
  let extractedText: string | null = null;
  let kind: "image" | "document" = "document";

  if (ext === ".jpg" || ext === ".jpeg") {
    if (!hasPrefix(bytes, [0xff, 0xd8, 0xff])) throw new Error("The JPEG signature is invalid.");
    kind = "image";
  } else if (ext === ".png") {
    if (!hasPrefix(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) throw new Error("The PNG signature is invalid.");
    kind = "image";
  } else if (ext === ".webp") {
    if (new TextDecoder("ascii").decode(bytes.slice(0, 4)) !== "RIFF" || new TextDecoder("ascii").decode(bytes.slice(8, 12)) !== "WEBP") throw new Error("The WebP signature is invalid.");
    kind = "image";
  } else if (ext === ".pdf") {
    if (new TextDecoder("ascii").decode(bytes.slice(0, 5)) !== "%PDF-") throw new Error("The PDF signature is invalid.");
    extractedText = await extractPdf(bytes);
  } else if ([".docx", ".xlsx", ".pptx"].includes(ext)) {
    if (!hasPrefix(bytes, [0x50, 0x4b])) throw new Error("The Office document signature is invalid.");
    extractedText = await extractOffice(bytes, ext);
  } else {
    if (bytes.includes(0)) throw new Error("Binary files cannot be uploaded as text.");
    try { extractedText = new TextDecoder("utf-8", { fatal: true }).decode(bytes).slice(0, MAX_EXTRACTED_CHARS).trim(); }
    catch { throw new Error("Text files must use UTF-8 encoding."); }
    actualMime = ext === ".csv" ? "text/csv" : "text/plain";
  }

  if (kind === "document" && !extractedText) throw new Error("No readable text could be extracted from this document.");
  const id = randomUUID();
  return {
    id, originalName: file.name, storageName: `${id}${ext}`, mimeType: actualMime,
    sizeBytes, sha256, kind,
    extractedText, processingStatus: "ready",
  };
}

export function attachmentDto(row: Record<string, unknown>) {
  return {
    id: String(row.id), name: String(row.original_name), mimeType: String(row.mime_type),
    size: Number(row.size_bytes), kind: row.kind === "image" ? "image" : "document",
    status: String(row.processing_status), downloadUrl: `/api/chat/attachments/${String(row.id)}`,
  };
}
