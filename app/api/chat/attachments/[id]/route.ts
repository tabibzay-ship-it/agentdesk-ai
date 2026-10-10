import "server-only";

import { CHAT_ATTACHMENT_BUCKET } from "@/lib/chat-attachments";
import { authenticateChatRequest, chatJson, UUID_RE } from "@/lib/chat-server";

async function ownedAttachment(request: Request, id: string) {
  const auth = await authenticateChatRequest(request);
  if ("response" in auth) return auth;
  if (!UUID_RE.test(id)) return { response: chatJson({ error: "Attachment not found." }, 404) };
  const { data, error } = await auth.admin.from("chat_attachments").select("id,storage_path,original_name,mime_type,message_id").eq("id", id).eq("user_id", auth.user.id).maybeSingle();
  if (error || !data) return { response: chatJson({ error: "Attachment not found." }, 404) };
  return { ...auth, attachment: data };
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const result = await ownedAttachment(request, id);
  if ("response" in result) return result.response;
  const { data, error } = await result.admin.storage.from(CHAT_ATTACHMENT_BUCKET).download(result.attachment.storage_path);
  if (error || !data) return chatJson({ error: "Attachment data is unavailable." }, 404);
  const inline = /^image\/(?:jpeg|png|webp)$/.test(result.attachment.mime_type);
  const safeName = String(result.attachment.original_name).replace(/["\r\n]/g, "_");
  return new Response(data, { headers: {
    "Content-Type": result.attachment.mime_type, "Content-Length": String(data.size),
    "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${safeName}"`,
    "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; sandbox",
  } });
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const result = await ownedAttachment(request, id);
  if ("response" in result) return result.response;
  if (result.attachment.message_id) return chatJson({ error: "Sent attachments cannot be removed from conversation history." }, 409);
  const { error: storageError } = await result.admin.storage.from(CHAT_ATTACHMENT_BUCKET).remove([result.attachment.storage_path]);
  if (storageError) return chatJson({ error: "Attachment removal failed." }, 503);
  const { error } = await result.admin.from("chat_attachments").delete().eq("id", id).eq("user_id", result.user.id).is("message_id", null);
  return error ? chatJson({ error: "Attachment metadata removal failed." }, 503) : chatJson({ removed: true });
}
