import { createHash, randomUUID } from "node:crypto";
import { deflateSync } from "node:zlib";
import JSZip from "jszip";

async function loadSharp() {
  return (await import("sharp")).default;
}

export const EXPORT_FORMATS = ["txt", "csv", "docx", "xlsx", "pdf"] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];
export type ImageEditOperation =
  | { type: "rotate"; degrees: 90 | 180 | 270 }
  | { type: "grayscale" }
  | { type: "monochrome"; color: "black" | "white" }
  | { type: "enhance" }
  | { type: "remove-background" }
  | { type: "flip"; direction: "horizontal" | "vertical" }
  | { type: "resize"; width: number; height?: number };

export type ImageRequest =
  | { kind: "generate"; format: "logo" | "banner" | "poster" | "image" }
  | { kind: "edit"; operation: ImageEditOperation }
  | { kind: "unsupported-edit" }
  | { kind: "none" };

const MIME: Record<ExportFormat, string> = {
  txt: "text/plain",
  csv: "text/csv",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pdf: "application/pdf",
};

function xml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function safeBaseName(value: string) {
  const clean = value.normalize("NFKC").replace(/[\u0000-\u001f<>:"/\\|?*]+/g, " ").replace(/\s+/g, " ").trim();
  return (clean || "agentdesk-result").slice(0, 100);
}

function lines(value: string) {
  return value.replace(/\r\n?/g, "\n").split("\n");
}

function csvCell(value: string) {
  return `"${value.replace(/"/g, '""')}"`;
}

async function makeDocx(content: string) {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`);
  zip.file("_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`);
  const paragraphs = lines(content).map((line) => `<w:p><w:r><w:t xml:space="preserve">${xml(line || " ")}</w:t></w:r></w:p>`).join("");
  zip.file("word/document.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>`);
  return Buffer.from(await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" }));
}

async function makeXlsx(content: string) {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`);
  zip.file("_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`);
  zip.file("xl/workbook.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="AgentDesk Result" sheetId="1" r:id="rId1"/></sheets></workbook>`);
  zip.file("xl/_rels/workbook.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`);
  const rows = lines(content).map((line, index) => `<row r="${index + 1}"><c r="A${index + 1}" t="inlineStr"><is><t xml:space="preserve">${xml(line || " ")}</t></is></c></row>`).join("");
  zip.file("xl/worksheets/sheet1.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows}</sheetData></worksheet>`);
  return Buffer.from(await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" }));
}

function wrapText(content: string, width = 82) {
  const output: string[] = [];
  for (const paragraph of lines(content)) {
    if (!paragraph) { output.push(""); continue; }
    let current = "";
    for (const word of paragraph.split(/\s+/)) {
      if (current && `${current} ${word}`.length > width) { output.push(current); current = word; }
      else current = current ? `${current} ${word}` : word;
    }
    output.push(current);
  }
  return output;
}

function pdfLiteral(value: string) {
  return value.replace(/[^\x20-\x7e]/g, " ").replace(/([\\()])/g, "\\$1");
}

async function makePdf(content: string) {
  const sharp = await loadSharp();
  const pages: string[][] = [];
  const wrapped = wrapText(content);
  for (let index = 0; index < Math.max(1, wrapped.length); index += 45) pages.push(wrapped.slice(index, index + 45));
  const objects: Buffer[] = [];
  const pageIds: number[] = [];
  const push = (body: Buffer | string) => { objects.push(Buffer.isBuffer(body) ? body : Buffer.from(body, "binary")); return objects.length; };
  push("<< /Type /Catalog /Pages 2 0 R >>");
  push("");
  for (const pageLines of pages) {
    const svgLines = pageLines.map((line, index) => `<text x="72" y="${110 + index * 31}" font-size="20" fill="#111827">${xml(line || " ")}</text>`).join("");
    const svg = `<svg width="1240" height="1754" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="white"/><g font-family="Arial, 'Noto Sans', sans-serif">${svgLines}</g></svg>`;
    const { data, info } = await sharp(Buffer.from(svg)).flatten({ background: "white" }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const compressed = deflateSync(data);
    const imageId = push(Buffer.concat([Buffer.from(`<< /Type /XObject /Subtype /Image /Width ${info.width} /Height ${info.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /Length ${compressed.length} >>\nstream\n`, "binary"), compressed, Buffer.from("\nendstream", "binary")]));
    const hiddenText = pdfLiteral(pageLines.join(" "));
    const stream = `q 595 0 0 842 0 0 cm /Im1 Do Q\nBT /F1 8 Tf 3 Tr 30 810 Td (${hiddenText}) Tj ET`;
    const contentId = push(`<< /Length ${Buffer.byteLength(stream, "binary")} >>\nstream\n${stream}\nendstream`);
    const pageId = push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /XObject << /Im1 ${imageId} 0 R >> /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> >> >> /Contents ${contentId} 0 R >>`);
    pageIds.push(pageId);
  }
  objects[1] = Buffer.from(`<< /Type /Pages /Count ${pageIds.length} /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] >>`, "binary");
  const chunks: Buffer[] = [Buffer.from("%PDF-1.7\n%\xE2\xE3\xCF\xD3\n", "binary")];
  const offsets = [0];
  let offset = chunks[0].length;
  objects.forEach((body, index) => { offsets.push(offset); const object = Buffer.concat([Buffer.from(`${index + 1} 0 obj\n`, "binary"), body, Buffer.from("\nendobj\n", "binary")]); chunks.push(object); offset += object.length; });
  const xref = offset;
  chunks.push(Buffer.from(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map((value) => `${String(value).padStart(10, "0")} 00000 n `).join("\n")}\ntrailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`, "binary"));
  return Buffer.concat(chunks);
}

export async function createTextArtifact(content: string, format: ExportFormat, title: string) {
  const clean = content.replace(/\u0000/g, "").trim();
  if (!clean) throw new Error("There is no result to export.");
  if (clean.length > 100_000) throw new Error("The result is too large to export safely.");
  let bytes: Buffer;
  if (format === "txt") bytes = Buffer.from(clean, "utf8");
  else if (format === "csv") bytes = Buffer.from(`result\r\n${lines(clean).map(csvCell).join("\r\n")}\r\n`, "utf8");
  else if (format === "docx") bytes = await makeDocx(clean);
  else if (format === "xlsx") bytes = await makeXlsx(clean);
  else bytes = await makePdf(clean);
  if (bytes.byteLength > 10 * 1024 * 1024) throw new Error("The generated file exceeds the 10 MB limit.");
  const name = `${safeBaseName(title)}.${format}`;
  return { id: randomUUID(), bytes, name, mimeType: MIME[format], sha256: createHash("sha256").update(bytes).digest("hex") };
}

export async function editImage(bytes: Uint8Array, operation: ImageEditOperation, sourceMime: string) {
  const sharp = await loadSharp();
  let pipeline = sharp(bytes, { failOn: "error", limitInputPixels: 40_000_000 }).rotate();
  if (operation.type === "rotate") pipeline = pipeline.rotate(operation.degrees);
  else if (operation.type === "grayscale") pipeline = pipeline.grayscale();
  else if (operation.type === "monochrome") {
    const color = operation.color === "white" ? { r: 255, g: 255, b: 255 } : { r: 0, g: 0, b: 0 };
    pipeline = pipeline.ensureAlpha().tint(color);
  }
  else if (operation.type === "enhance") pipeline = pipeline.normalize().sharpen({ sigma: 1 });
  else if (operation.type === "remove-background") {
    // Safe deterministic fallback for logos on a near-white background. This
    // preserves every source pixel and only derives alpha from luminance.
    pipeline = pipeline.ensureAlpha().removeAlpha().joinChannel(
      await sharp(bytes, { failOn: "error", limitInputPixels: 40_000_000 })
        .rotate().grayscale().linear(-4, 1020).toBuffer()
    );
  }
  else if (operation.type === "flip") pipeline = operation.direction === "horizontal" ? pipeline.flop() : pipeline.flip();
  else pipeline = pipeline.resize({ width: operation.width, height: operation.height, fit: "inside", withoutEnlargement: true });
  const format = operation.type === "remove-background" ? "png" : sourceMime === "image/jpeg" ? "jpeg" : sourceMime === "image/webp" ? "webp" : "png";
  const output = await pipeline.toFormat(format, format === "jpeg" ? { quality: 90 } : format === "webp" ? { quality: 90 } : {}).toBuffer();
  if (output.byteLength > 10 * 1024 * 1024) throw new Error("The edited image exceeds the 10 MB limit.");
  return { bytes: output, mimeType: format === "jpeg" ? "image/jpeg" : format === "webp" ? "image/webp" : "image/png", sha256: createHash("sha256").update(output).digest("hex") };
}

export function classifyImageRequest(value: string, hasImage: boolean): ImageRequest {
  const text = value.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
  if (!text) return { kind: "none" };
  if (hasImage) {
    if (/\b(make|turn|change|convert).{0,24}\bblack\b|تور(?:ه| یې| يې)?\s*(?:کړ|کوه)|سیاه\s*(?:کن|بساز)/i.test(text)) return { kind: "edit", operation: { type: "monochrome", color: "black" } };
    if (/\b(make|turn|change|convert).{0,24}\bwhite\b|سپین(?:ه| یې| يې)?\s*(?:کړ|کوه)|سفید\s*(?:کن|بساز)/i.test(text)) return { kind: "edit", operation: { type: "monochrome", color: "white" } };
    if (/\b(grayscale|grey ?scale|black and white)\b/i.test(text)) return { kind: "edit", operation: { type: "grayscale" } };
    if (/\b(remove|transparent).{0,18}\bbackground\b|background.{0,18}\b(remove|transparent)\b|شالید.{0,12}(لرې|حذف)|پس ?زمینه.{0,12}(حذف|شفاف)/i.test(text)) return { kind: "edit", operation: { type: "remove-background" } };
    if (/\b(enhance|improve|refine|clean|sharpen|high[- ]?quality|higher resolution)\b|کیفیت.{0,12}(لوړ|ښه)|کیفیت.{0,12}(بهتر|بالا)/i.test(text)) return { kind: "edit", operation: { type: "enhance" } };
    if (/\b(redesign|restyle|replace|add|remove object|change shape|new concept)\b/i.test(text)) return { kind: "unsupported-edit" };
  }
  if (!hasImage && /\b(generate|create|design|make|draw)\b.{0,80}\b(logo|image|banner|poster|graphic)\b|\b(logo|image|banner|poster)\b.{0,40}\b(generate|create|design|make|draw)\b/i.test(text)) {
    const format = /\blogo\b/i.test(text) ? "logo" : /\bbanner\b/i.test(text) ? "banner" : /\bposter\b/i.test(text) ? "poster" : "image";
    return { kind: "generate", format };
  }
  return { kind: "none" };
}

export async function createTemplateImage(prompt: string, format: "logo" | "banner" | "poster" | "image") {
  const sharp = await loadSharp();
  const dimensions = format === "banner" ? { width: 1200, height: 630 } : format === "poster" ? { width: 1080, height: 1350 } : { width: 1024, height: 1024 };
  const label = prompt.replace(/\b(generate|create|design|make|draw)\b/gi, "").replace(/\s+/g, " ").trim().slice(0, 100) || "AgentDesk Design";
  const safe = xml(label);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${dimensions.width}" height="${dimensions.height}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#0f172a"/><stop offset="1" stop-color="#2563eb"/></linearGradient></defs><rect width="100%" height="100%" rx="48" fill="url(#g)"/><circle cx="${dimensions.width / 2}" cy="${dimensions.height * .38}" r="${Math.min(dimensions.width, dimensions.height) * .16}" fill="#fff" opacity=".12"/><text x="50%" y="52%" text-anchor="middle" font-family="Arial, sans-serif" font-size="${Math.round(Math.min(dimensions.width, dimensions.height) * .065)}" font-weight="700" fill="white">${safe}</text><text x="50%" y="61%" text-anchor="middle" font-family="Arial, sans-serif" font-size="24" fill="#bfdbfe">Template-based ${format} • AgentDesk AI</text></svg>`;
  const bytes = await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toBuffer();
  return { bytes, mimeType: "image/png", sha256: createHash("sha256").update(bytes).digest("hex"), name: `agentdesk-${format}-${randomUUID().slice(0, 8)}.png` };
}

export function parseImageEdit(value: unknown): ImageEditOperation | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  if (item.type === "grayscale") return { type: "grayscale" };
  if (item.type === "monochrome" && (item.color === "black" || item.color === "white")) return { type: "monochrome", color: item.color };
  if (item.type === "enhance") return { type: "enhance" };
  if (item.type === "remove-background") return { type: "remove-background" };
  if (item.type === "rotate" && [90, 180, 270].includes(Number(item.degrees))) return { type: "rotate", degrees: Number(item.degrees) as 90 | 180 | 270 };
  if (item.type === "flip" && (item.direction === "horizontal" || item.direction === "vertical")) return { type: "flip", direction: item.direction };
  if (item.type === "resize" && Number.isSafeInteger(item.width) && Number(item.width) >= 64 && Number(item.width) <= 4096 && (item.height === undefined || (Number.isSafeInteger(item.height) && Number(item.height) >= 64 && Number(item.height) <= 4096))) return { type: "resize", width: Number(item.width), height: item.height === undefined ? undefined : Number(item.height) };
  return null;
}
