import { createHash } from "node:crypto";
import OpenAI, { toFile } from "openai";
import sharp from "sharp";

export type ProviderImage = {
  bytes: Buffer;
  mimeType: "image/png";
  sha256: string;
  model: string;
  provider: "openai";
};

type ImageClient = Pick<OpenAI, "images">;
const IMAGE_MODEL = process.env.AGENTDESK_IMAGE_MODEL || "gpt-image-1.5";

function safetyIdentifier(userId: string) {
  return createHash("sha256").update(`agentdesk:${userId}`).digest("hex").slice(0, 64);
}

async function verifiedPng(base64: string | undefined) {
  if (!base64) throw new Error("The image provider returned no image data.");
  const bytes = Buffer.from(base64, "base64");
  if (!bytes.length || bytes.byteLength > 10 * 1024 * 1024) throw new Error("The image provider returned an invalid image size.");
  let metadata;
  try {
    metadata = await sharp(bytes, { failOn: "error", limitInputPixels: 40_000_000 }).metadata();
  } catch {
    throw new Error("The image provider returned an invalid image.");
  }
  if (!metadata.width || !metadata.height || !["png", "jpeg", "webp"].includes(metadata.format || "")) throw new Error("The image provider returned an invalid image.");
  const png = metadata.format === "png" ? bytes : await sharp(bytes).png().toBuffer();
  return { bytes: png, mimeType: "image/png" as const, sha256: createHash("sha256").update(png).digest("hex") };
}

export function imageProviderEnabled() {
  return process.env.AGENTDESK_EXTERNAL_AI_DISABLED !== "true" &&
    process.env.AGENTDESK_IMAGE_PROVIDER === "openai" &&
    Boolean(process.env.OPENAI_API_KEY);
}

export function createImageProvider(client: ImageClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 90_000, maxRetries: 0 })) {
  return {
    model: IMAGE_MODEL,
    async generate(prompt: string, userId: string): Promise<ProviderImage> {
      if (process.env.AGENTDESK_EXTERNAL_AI_DISABLED === "true") throw new Error("External AI is disabled in this environment.");
      const response = await client.images.generate({
        model: IMAGE_MODEL,
        prompt: prompt.slice(0, 4_000),
        n: 1,
        size: "1024x1024",
        quality: "medium",
        output_format: "png",
        // The installed SDK predates the documented safety_identifier field;
        // send the same one-way identifier through its supported user alias.
        user: safetyIdentifier(userId),
      });
      return { ...(await verifiedPng(response.data?.[0]?.b64_json)), model: IMAGE_MODEL, provider: "openai" };
    },
    async edit(source: Uint8Array, sourceMime: string, prompt: string, userId: string): Promise<ProviderImage> {
      if (process.env.AGENTDESK_EXTERNAL_AI_DISABLED === "true") throw new Error("External AI is disabled in this environment.");
      const response = await client.images.edit({
        model: IMAGE_MODEL,
        image: await toFile(Buffer.from(source), "source.png", { type: sourceMime }),
        prompt: `Use the supplied image as the primary reference. Preserve its subject, composition, typography, proportions, and recognizable identity unless the user explicitly requests otherwise. Apply only this requested change: ${prompt.slice(0, 3_500)}`,
        n: 1,
        size: "1024x1024",
        quality: "medium",
        output_format: "png",
        user: safetyIdentifier(userId),
      });
      return { ...(await verifiedPng(response.data?.[0]?.b64_json)), model: IMAGE_MODEL, provider: "openai" };
    },
  };
}
