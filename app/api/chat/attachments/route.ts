import "server-only";

import { isVisitorId } from "@/lib/request-security";
import { attachmentDto, CHAT_ATTACHMENT_BUCKET, MAX_ACCOUNT_STORAGE_BYTES, MAX_ATTACHMENTS_PER_MESSAGE, validateAndProcessFile } from "@/lib/chat-attachments";
import { authenticateChatRequest, chatJson, UUID_RE } from "@/lib/chat-server";

export async function POST(request: Request) {
  try {
    const auth = await authenticateChatRequest(request);
    if ("response" in auth) return auth.response;
    if (!/^multipart\/form-data(?:;|$)/i.test(request.headers.get("content-type") || "")) return chatJson({ error: "A multipart file upload is required." }, 415);
    const declared = Number(request.headers.get("content-length") || 0);
    if (declared > 12 * 1024 * 1024) return chatJson({ error: "Upload is too large." }, 413);
    if (!request.body) return chatJson({ error: "Choose a file to upload." }, 400);
    const reader = request.body.getReader(); const chunks:Uint8Array[]=[]; let received=0;
    while(true){const {done,value}=await reader.read();if(done)break;received+=value.byteLength;if(received>12*1024*1024){await reader.cancel();return chatJson({error:"Upload is too large."},413);}chunks.push(value);}
    const uploadBody=new Uint8Array(received);let offset=0;for(const chunk of chunks){uploadBody.set(chunk,offset);offset+=chunk.byteLength;}
    const form = await new Request(request.url,{method:"POST",headers:{"content-type":request.headers.get("content-type")!},body:uploadBody}).formData();
    const file = form.get("file");
    const agentId = form.get("agentId");
    const visitorId = form.get("visitorId");
    if (!(file instanceof File)) return chatJson({ error: "Choose a file to upload." }, 400);
    if (typeof agentId !== "string" || !UUID_RE.test(agentId) || typeof visitorId !== "string" || !isVisitorId(visitorId)) return chatJson({ error: "Invalid chat identity." }, 400);

    const { data: agent, error: agentError } = await auth.admin.from("agent_settings").select("user_id,public_agent_id,is_active").eq("public_agent_id", agentId).eq("user_id", auth.user.id).maybeSingle();
    if (agentError || !agent || agent.is_active !== true) return chatJson({ error: "You cannot upload files to this AI agent." }, 403);
    const [{ data: accountAllowed, error: accountRateError }, { data: visitorAllowed, error: visitorRateError }] = await Promise.all([
      auth.admin.rpc("check_chat_rate_limit", { p_agent_id: auth.user.id, p_visitor_id: "__attachment_upload__", p_limit: 20, p_window_seconds: 60 }),
      auth.admin.rpc("check_chat_rate_limit", { p_agent_id: auth.user.id, p_visitor_id: `${visitorId}:upload`, p_limit: 8, p_window_seconds: 60 }),
    ]);
    if (accountRateError || visitorRateError) return chatJson({ error: "Could not check the upload rate limit." }, 503);
    if (accountAllowed !== true || visitorAllowed !== true) return chatJson({ error: "Too many uploads. Please wait a minute.", rateLimited: true }, 429);
    const { count, error: countError } = await auth.admin.from("chat_attachments").select("id", { count: "exact", head: true }).eq("user_id", auth.user.id).eq("visitor_id", visitorId).is("message_id", null);
    if (countError) return chatJson({ error: "Attachment storage is not ready. Apply the local attachment migration first." }, 503);
    if ((count ?? 0) >= MAX_ATTACHMENTS_PER_MESSAGE) return chatJson({ error: `You can attach up to ${MAX_ATTACHMENTS_PER_MESSAGE} files per message.` }, 400);

    const { data: storedFiles, error: quotaError } = await auth.admin.from("chat_attachments").select("size_bytes").eq("user_id", auth.user.id).limit(5_000);
    if (quotaError) return chatJson({ error: "Could not check the storage quota." }, 503);
    const storedBytes = (storedFiles ?? []).reduce((total, row) => total + Number(row.size_bytes || 0), 0);
    if (storedBytes + file.size > MAX_ACCOUNT_STORAGE_BYTES) return chatJson({ error: "Your secure attachment storage limit has been reached." }, 413);

    const processed = await validateAndProcessFile(file);
    const storagePath = `${auth.user.id}/${visitorId}/${processed.storageName}`;
    const bytes = new Uint8Array(await file.arrayBuffer());
    const { error: uploadError } = await auth.admin.storage.from(CHAT_ATTACHMENT_BUCKET).upload(storagePath, bytes, { contentType: processed.mimeType, upsert: false, cacheControl: "3600" });
    if (uploadError) return chatJson({ error: "The private file upload failed." }, 503);
    const { data: row, error: insertError } = await auth.admin.from("chat_attachments").insert({
      id: processed.id, user_id: auth.user.id, agent_id: auth.user.id, visitor_id: visitorId,
      storage_path: storagePath, original_name: processed.originalName, mime_type: processed.mimeType,
      size_bytes: processed.sizeBytes, sha256: processed.sha256, kind: processed.kind,
      processing_status: processed.processingStatus, extracted_text: processed.extractedText,
    }).select("id,original_name,mime_type,size_bytes,kind,processing_status").single();
    if (insertError) {
      await auth.admin.storage.from(CHAT_ATTACHMENT_BUCKET).remove([storagePath]);
      return chatJson({ error: "The uploaded file could not be recorded." }, 503);
    }
    return chatJson({ attachment: attachmentDto(row) }, 201);
  } catch (error) {
    const message = error instanceof Error ? error.message : "The file could not be processed.";
    return chatJson({ error: message }, /not supported|invalid|must|too large|readable text|macros/i.test(message) ? 400 : 500);
  }
}
