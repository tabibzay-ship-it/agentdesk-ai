import "server-only";

import { randomUUID } from "node:crypto";
import { editImage, parseImageEdit } from "@/lib/chat-artifacts";
import { attachmentDto, CHAT_ATTACHMENT_BUCKET, MAX_ACCOUNT_STORAGE_BYTES } from "@/lib/chat-attachments";
import { authenticateChatRequest, chatJson, UUID_RE } from "@/lib/chat-server";
import { getTrustedApplicationOrigin, parseRequestOrigin } from "@/lib/origin-security";
import { BodyError, isVisitorId, readJsonObject } from "@/lib/request-security";

function sameApplicationOrigin(request: Request) {
  const supplied = parseRequestOrigin(request.headers.get("origin"));
  const trusted = getTrustedApplicationOrigin(request);
  return supplied !== null && trusted !== null && supplied.origin === trusted.origin;
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    if (!sameApplicationOrigin(request)) return chatJson({ error: "This image edit came from an untrusted origin." }, 403);
    const auth = await authenticateChatRequest(request);
    if ("response" in auth) return auth.response;
    const { id } = await context.params;
    if (!UUID_RE.test(id)) return chatJson({ error: "Image not found." }, 404);
    const operation = parseImageEdit((await readJsonObject(request, 4_096)).operation);
    if (!operation) return chatJson({ error: "Choose a supported image edit." }, 400);
    const { data: source, error: sourceError } = await auth.admin.from("chat_attachments").select("id,user_id,conversation_id,message_id,visitor_id,storage_path,original_name,mime_type,kind").eq("id", id).eq("user_id", auth.user.id).eq("kind", "image").maybeSingle();
    if (sourceError || !source || !source.conversation_id || !source.message_id || !isVisitorId(source.visitor_id)) return chatJson({ error: "Image not found." }, 404);
    const { data: conversation } = await auth.admin.from("conversations").select("id").eq("id", source.conversation_id).eq("user_id", auth.user.id).maybeSingle();
    if (!conversation) return chatJson({ error: "Image not found." }, 404);
    const { data: allowed, error: rateError } = await auth.admin.rpc("check_chat_rate_limit", { p_agent_id: auth.user.id, p_visitor_id: "__image_edit__", p_limit: 8, p_window_seconds: 60 });
    if (rateError) return chatJson({ error: "Could not check the image-edit rate limit." }, 503);
    if (allowed !== true) return chatJson({ error: "Too many image edits. Please wait a minute." }, 429);
    const [{ data: blob, error: downloadError }, { data: storedFiles, error: quotaError }] = await Promise.all([
      auth.admin.storage.from(CHAT_ATTACHMENT_BUCKET).download(source.storage_path),
      auth.admin.from("chat_attachments").select("size_bytes").eq("user_id", auth.user.id).limit(5_000),
    ]);
    if (downloadError || !blob) return chatJson({ error: "The source image could not be read." }, 503);
    if (quotaError) return chatJson({ error: "Could not check the storage quota." }, 503);
    const edited = await editImage(new Uint8Array(await blob.arrayBuffer()), operation, source.mime_type);
    const storedBytes = (storedFiles ?? []).reduce((total, row) => total + Number(row.size_bytes || 0), 0);
    if (storedBytes + edited.bytes.byteLength > MAX_ACCOUNT_STORAGE_BYTES) return chatJson({ error: "Your secure attachment storage limit has been reached." }, 413);
    const resultId = randomUUID();
    const extension = edited.mimeType === "image/jpeg" ? "jpg" : edited.mimeType === "image/webp" ? "webp" : "png";
    const storagePath = `${auth.user.id}/${source.visitor_id}/${resultId}.${extension}`;
    const label = operation.type === "rotate" ? `rotated ${operation.degrees}°` : operation.type === "resize" ? `resized to ${operation.width}${operation.height ? `×${operation.height}` : "px wide"}` : operation.type === "flip" ? `${operation.direction} flip` : operation.type === "monochrome" ? `${operation.color} recolor` : operation.type === "remove-background" ? "near-white background removal" : operation.type;
    const { error: uploadError } = await auth.admin.storage.from(CHAT_ATTACHMENT_BUCKET).upload(storagePath, edited.bytes, { contentType: edited.mimeType, upsert: false, cacheControl: "3600" });
    if (uploadError) return chatJson({ error: "The edited image could not be stored." }, 503);
    const { data: assistant, error: messageError } = await auth.admin.from("messages").insert({ conversation_id: source.conversation_id, role: "assistant", content: `Image edit completed (${label}). This is a deterministic file edit, not AI image generation.` }).select("id,role,content,created_at").single();
    if (messageError) { await auth.admin.storage.from(CHAT_ATTACHMENT_BUCKET).remove([storagePath]); return chatJson({ error: "The image edit could not be added to the conversation." }, 503); }
    const base = String(source.original_name).replace(/\.[^.]+$/, "").slice(0, 120);
    const { data: row, error: insertError } = await auth.admin.from("chat_attachments").insert({
      id: resultId, user_id: auth.user.id, agent_id: auth.user.id, conversation_id: source.conversation_id, message_id: assistant.id,
      visitor_id: source.visitor_id, storage_path: storagePath, original_name: `${base}-${operation.type}.${extension}`,
      mime_type: edited.mimeType, size_bytes: edited.bytes.byteLength, sha256: edited.sha256, kind: "image", processing_status: "ready", extracted_text: null,
    }).select("id,original_name,mime_type,size_bytes,kind,processing_status").single();
    if (insertError) {
      await Promise.all([auth.admin.storage.from(CHAT_ATTACHMENT_BUCKET).remove([storagePath]), auth.admin.from("messages").delete().eq("id", assistant.id).eq("conversation_id", source.conversation_id)]);
      return chatJson({ error: "The edited image could not be recorded." }, 503);
    }
    return chatJson({ message: { id: assistant.id, role: assistant.role, content: assistant.content, createdAt: assistant.created_at, attachments: [attachmentDto(row)] } }, 201);
  } catch (error) {
    if (error instanceof BodyError) return chatJson({ error: error.message, code: error.code }, error.status);
    return chatJson({ error: error instanceof Error ? error.message : "The image could not be edited." }, 500);
  }
}
