import "server-only";

import { createTextArtifact, EXPORT_FORMATS, type ExportFormat } from "@/lib/chat-artifacts";
import { attachmentDto, CHAT_ATTACHMENT_BUCKET, MAX_ACCOUNT_STORAGE_BYTES } from "@/lib/chat-attachments";
import { authenticateChatRequest, chatJson, UUID_RE } from "@/lib/chat-server";
import { getTrustedApplicationOrigin, parseRequestOrigin } from "@/lib/origin-security";
import { BodyError, isVisitorId, readJsonObject } from "@/lib/request-security";

function sameApplicationOrigin(request: Request) {
  const supplied = parseRequestOrigin(request.headers.get("origin"));
  const trusted = getTrustedApplicationOrigin(request);
  return supplied !== null && trusted !== null && supplied.origin === trusted.origin;
}

export async function POST(request: Request) {
  try {
    if (!sameApplicationOrigin(request)) return chatJson({ error: "This export request came from an untrusted origin." }, 403);
    const auth = await authenticateChatRequest(request);
    if ("response" in auth) return auth.response;
    const body = await readJsonObject(request, 8_192);
    const messageId = body.messageId;
    const format = body.format;
    if (typeof messageId !== "string" || !UUID_RE.test(messageId) || typeof format !== "string" || !EXPORT_FORMATS.includes(format as ExportFormat)) {
      return chatJson({ error: "Choose a valid AI response and export format." }, 400);
    }
    const { data: message, error: messageError } = await auth.admin.from("messages").select("id,conversation_id,role,content").eq("id", messageId).eq("role", "assistant").maybeSingle();
    if (messageError || !message) return chatJson({ error: "AI response not found." }, 404);
    const { data: conversation, error: conversationError } = await auth.admin.from("conversations").select("id,user_id,visitor_id").eq("id", message.conversation_id).eq("user_id", auth.user.id).maybeSingle();
    if (conversationError || !conversation || !isVisitorId(conversation.visitor_id)) return chatJson({ error: "AI response not found." }, 404);
    const { data: allowed, error: rateError } = await auth.admin.rpc("check_chat_rate_limit", { p_agent_id: auth.user.id, p_visitor_id: "__artifact_export__", p_limit: 10, p_window_seconds: 60 });
    if (rateError) return chatJson({ error: "Could not check the export rate limit." }, 503);
    if (allowed !== true) return chatJson({ error: "Too many exports. Please wait a minute." }, 429);
    const { data: storedFiles, error: quotaError } = await auth.admin.from("chat_attachments").select("size_bytes").eq("user_id", auth.user.id).limit(5_000);
    if (quotaError) return chatJson({ error: "Could not check the storage quota." }, 503);
    const storedBytes = (storedFiles ?? []).reduce((total, row) => total + Number(row.size_bytes || 0), 0);
    const artifact = await createTextArtifact(String(message.content), format as ExportFormat, "agentdesk-ai-result");
    if (storedBytes + artifact.bytes.byteLength > MAX_ACCOUNT_STORAGE_BYTES) return chatJson({ error: "Your secure attachment storage limit has been reached." }, 413);
    const storagePath = `${auth.user.id}/${conversation.visitor_id}/${artifact.id}.${format}`;
    const { error: uploadError } = await auth.admin.storage.from(CHAT_ATTACHMENT_BUCKET).upload(storagePath, artifact.bytes, { contentType: artifact.mimeType, upsert: false, cacheControl: "3600" });
    if (uploadError) return chatJson({ error: "The exported file could not be stored." }, 503);
    const { data: row, error: insertError } = await auth.admin.from("chat_attachments").insert({
      id: artifact.id, user_id: auth.user.id, agent_id: auth.user.id, conversation_id: conversation.id, message_id: message.id,
      visitor_id: conversation.visitor_id, storage_path: storagePath, original_name: artifact.name, mime_type: artifact.mimeType,
      size_bytes: artifact.bytes.byteLength, sha256: artifact.sha256, kind: "document", processing_status: "ready", extracted_text: String(message.content).slice(0, 16_000),
    }).select("id,original_name,mime_type,size_bytes,kind,processing_status").single();
    if (insertError) {
      await auth.admin.storage.from(CHAT_ATTACHMENT_BUCKET).remove([storagePath]);
      return chatJson({ error: "The exported file could not be recorded." }, 503);
    }
    return chatJson({ attachment: attachmentDto(row) }, 201);
  } catch (error) {
    if (error instanceof BodyError) return chatJson({ error: error.message, code: error.code }, error.status);
    return chatJson({ error: error instanceof Error ? error.message : "The result could not be exported." }, 500);
  }
}
