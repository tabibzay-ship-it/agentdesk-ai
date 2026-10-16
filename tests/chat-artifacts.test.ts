import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { createCanvas } from "@napi-rs/canvas";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { classifyImageRequest, createTemplateImage, createTextArtifact, editImage, parseImageEdit } from "../lib/chat-artifacts";
import { validateAndProcessFile } from "../lib/chat-attachments";

const result = "AgentDesk revision one\nSecond row contains verified content.";

test("exports contain the actual result and supported files can be re-uploaded", async () => {
  for (const format of ["txt", "csv", "docx", "xlsx", "pdf"] as const) {
    const artifact = await createTextArtifact(result, format, "Revision");
    assert.ok(artifact.bytes.byteLength > 0);
    assert.match(artifact.sha256, /^[0-9a-f]{64}$/);
    const body = new Uint8Array(artifact.bytes).slice().buffer as ArrayBuffer;
    const parsed = await validateAndProcessFile(new File([body], artifact.name, { type: artifact.mimeType }));
    assert.match(parsed.extractedText ?? "", /AgentDesk revision one/);
  }
});

test("Unicode PDF export renders visible Pashto, Dari, and English content", async () => {
  const unicode = "پښتو: د ازموینې سند\nدری: سند آزمایشی\nEnglish: verified Unicode export";
  const artifact = await createTextArtifact(unicode, "pdf", "Unicode verification");
  const loadingTask = getDocument({ data: new Uint8Array(artifact.bytes) });
  const document = await loadingTask.promise;
  try {
    const page = await document.getPage(1);
    const viewport = page.getViewport({ scale: 1 });
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    await page.render({ canvas: canvas as never, canvasContext: canvas.getContext("2d") as never, viewport }).promise;
    const pixels = await sharp(canvas.toBuffer("image/png")).grayscale().raw().toBuffer();
    const visibleInk = pixels.reduce((count, value) => count + (value < 235 ? 1 : 0), 0);
    assert.ok(visibleInk > 500, `Expected visible Unicode content, found ${visibleInk} dark pixels.`);
  } finally {
    await loadingTask.destroy();
  }
});

test("image edits produce real decodable outputs without enlarging beyond limits", async () => {
  const source = await sharp({ create: { width: 120, height: 80, channels: 3, background: "#2563eb" } }).png().toBuffer();
  const grayscale = await editImage(source, { type: "grayscale" }, "image/png");
  const { data: pixels } = await sharp(grayscale.bytes).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  assert.equal(pixels[0], pixels[1]);
  assert.equal(pixels[1], pixels[2]);
  const resized = await editImage(source, { type: "resize", width: 64 }, "image/png");
  const resizedInfo = await sharp(resized.bytes).metadata();
  assert.equal(resizedInfo.width, 64);
  assert.equal(resizedInfo.height, 43);
});

test("image edit instructions are narrowly validated", () => {
  assert.deepEqual(parseImageEdit({ type: "rotate", degrees: 90 }), { type: "rotate", degrees: 90 });
  assert.deepEqual(parseImageEdit({ type: "flip", direction: "horizontal" }), { type: "flip", direction: "horizontal" });
  assert.equal(parseImageEdit({ type: "resize", width: 9000 }), null);
  assert.equal(parseImageEdit({ type: "execute", command: "anything" }), null);
});

test("chat image intent separates generation, safe edits, and unsupported redesigns", () => {
  assert.deepEqual(classifyImageRequest("Generate a logo for a coffee shop", false), { kind: "generate", format: "logo" });
  assert.deepEqual(classifyImageRequest("Create a topic-based image", false), { kind: "generate", format: "image" });
  assert.deepEqual(classifyImageRequest("Design a banner for launch", false), { kind: "generate", format: "banner" });
  assert.deepEqual(classifyImageRequest("Make it black", true), { kind: "edit", operation: { type: "monochrome", color: "black" } });
  assert.deepEqual(classifyImageRequest("Improve this in high quality", true), { kind: "edit", operation: { type: "enhance" } });
  assert.deepEqual(classifyImageRequest("Remove background", true), { kind: "edit", operation: { type: "remove-background" } });
  assert.equal(classifyImageRequest("Redesign but keep the same concept", true).kind, "unsupported-edit");
  assert.equal(classifyImageRequest("What is in this image?", true).kind, "none");
});

test("template generation returns a real relevant PNG and identifies itself as a template", async () => {
  const generated = await createTemplateImage("Generate a logo for Kabul Coffee", "logo");
  const metadata = await sharp(generated.bytes).metadata();
  assert.equal(metadata.format, "png");
  assert.equal(metadata.width, 1024);
  assert.equal(metadata.height, 1024);
  assert.match(generated.name, /^agentdesk-logo-/);
});

test("identity-preserving edits keep source dimensions and transparency", async () => {
  const source = await sharp({ create: { width: 80, height: 60, channels: 4, background: { r: 220, g: 40, b: 80, alpha: 0.65 } } }).png().toBuffer();
  for (const operation of [{ type: "monochrome", color: "black" }, { type: "enhance" }, { type: "remove-background" }] as const) {
    const result = await editImage(source, operation, "image/png");
    const metadata = await sharp(result.bytes).metadata();
    assert.equal(metadata.width, 80);
    assert.equal(metadata.height, 60);
    assert.equal(metadata.format, "png");
  }
});
