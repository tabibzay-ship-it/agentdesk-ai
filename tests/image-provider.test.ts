import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import { createImageProvider } from "../lib/image-provider";

async function pngBase64(color: string) {
  return (await sharp({ create: { width: 32, height: 24, channels: 4, background: color } }).png().toBuffer()).toString("base64");
}

test("mocked image provider generates a verified PNG with bounded settings", async () => {
  let request: Record<string, unknown> | undefined;
  const client = { images: { async generate(input: Record<string, unknown>) { request = input; return { data: [{ b64_json: await pngBase64("#2563eb") }] }; }, async edit() { throw new Error("unused"); } } };
  const result = await createImageProvider(client as never).generate("Create a professional logo", "11111111-1111-4111-8111-111111111111");
  assert.equal((await sharp(result.bytes).metadata()).format, "png");
  assert.equal(request?.n, 1);
  assert.equal(request?.size, "1024x1024");
  assert.equal(request?.output_format, "png");
  assert.match(String(request?.user), /^[a-f0-9]{64}$/);
  assert.doesNotMatch(JSON.stringify(request), /11111111-1111/);
});

test("mocked reference edit sends the source file and strict identity instruction", async () => {
  let request: Record<string, unknown> | undefined;
  const source = await sharp({ create: { width: 40, height: 30, channels: 4, background: "#ef4444" } }).png().toBuffer();
  const client = { images: { async generate() { throw new Error("unused"); }, async edit(input: Record<string, unknown>) { request = input; return { data: [{ b64_json: await pngBase64("#111827") }] }; } } };
  const result = await createImageProvider(client as never).edit(source, "image/png", "Keep the same logo but refine it", "22222222-2222-4222-8222-222222222222");
  assert.equal((await sharp(result.bytes).metadata()).format, "png");
  assert.match(String(request?.prompt), /Preserve its subject, composition, typography, proportions, and recognizable identity/);
  assert.ok(request?.image);
  assert.equal(request?.n, 1);
});

test("provider rejects empty and non-image output", async () => {
  const client = { images: { async generate() { return { data: [{ b64_json: Buffer.from("not an image").toString("base64") }] }; }, async edit() { throw new Error("unused"); } } };
  await assert.rejects(() => createImageProvider(client as never).generate("logo", "user"), /invalid image/i);
});
