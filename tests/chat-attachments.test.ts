import test from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import { MAX_ATTACHMENT_BYTES, validateAndProcessFile } from "../lib/chat-attachments";

function file(bytes: Uint8Array | string, name: string, type: string) {
  const body = typeof bytes === "string" ? bytes : bytes.slice().buffer as ArrayBuffer;
  return new File([body], name, { type });
}

async function officeFile(name: string, requiredPath: string, xml: string, extra?: Record<string, string>) {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", "<Types/>");
  zip.file(requiredPath, xml);
  for (const [path, value] of Object.entries(extra ?? {})) zip.file(path, value);
  return file(await zip.generateAsync({ type: "uint8array" }), name, "application/zip");
}

test("validates real image signatures", async () => {
  const png = new Uint8Array([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,0,0,0,0]);
  const result = await validateAndProcessFile(file(png, "photo.png", "image/png"));
  assert.equal(result.kind, "image");
  await assert.rejects(() => validateAndProcessFile(file("not a png", "fake.png", "image/png")), /signature/i);
});

test("extracts UTF-8 TXT and CSV", async () => {
  assert.match((await validateAndProcessFile(file("Hello attachment", "notes.txt", "text/plain"))).extractedText ?? "", /Hello/);
  assert.match((await validateAndProcessFile(file("name,value\nAgentDesk,1", "data.csv", "text/csv"))).extractedText ?? "", /AgentDesk/);
});

test("extracts DOCX, XLSX, and PPTX XML while rejecting macros", async () => {
  const docx = await officeFile("sample.docx", "word/document.xml", "<w:document><w:p><w:t>DOCX context</w:t></w:p></w:document>");
  const xlsx = await officeFile("sample.xlsx", "xl/workbook.xml", "<workbook/>", { "xl/worksheets/sheet1.xml": "<row><c><v>XLSX context</v></c></row>" });
  const pptx = await officeFile("sample.pptx", "ppt/presentation.xml", "<p:presentation/>", { "ppt/slides/slide1.xml": "<a:p><a:t>PPTX context</a:t></a:p>" });
  assert.match((await validateAndProcessFile(docx)).extractedText ?? "", /DOCX context/);
  assert.match((await validateAndProcessFile(xlsx)).extractedText ?? "", /XLSX context/);
  assert.match((await validateAndProcessFile(pptx)).extractedText ?? "", /PPTX context/);
  const macro = await officeFile("unsafe.docx", "word/document.xml", "<w:t>text</w:t>", { "word/vbaProject.bin": "unsafe" });
  await assert.rejects(() => validateAndProcessFile(macro), /macros|executable/i);
});

test("accepts a structurally valid PDF and extracts its text", async () => {
  const body = "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 144]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj\n4 0 obj<</Length 44>>stream\nBT /F1 18 Tf 20 100 Td (PDF context) Tj ET\nendstream endobj\n5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF";
  const result = await validateAndProcessFile(file(body, "sample.pdf", "application/pdf"));
  assert.match(result.extractedText ?? "", /PDF context/);
  assert.equal(result.sizeBytes, Buffer.byteLength(body));
  assert.match(result.sha256, /^[0-9a-f]{64}$/);
});

test("rejects unsupported, oversized, path-like, and binary text files", async () => {
  await assert.rejects(() => validateAndProcessFile(file("x", "script.exe", "application/octet-stream")), /not supported/i);
  await assert.rejects(() => validateAndProcessFile(file("x", "../notes.txt", "text/plain")), /file name/i);
  await assert.rejects(() => validateAndProcessFile(file(new Uint8Array([65,0,66]), "binary.txt", "text/plain")), /binary/i);
  await assert.rejects(() => validateAndProcessFile(file(new Uint8Array(MAX_ATTACHMENT_BYTES + 1), "large.txt", "text/plain")), /smaller/i);
});
