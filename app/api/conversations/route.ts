import "server-only";

import { CHAT_ATTACHMENT_BUCKET } from "@/lib/chat-attachments";
import { authenticateChatRequest, chatJson, UUID_RE } from "@/lib/chat-server";

const PAGE_SIZE = 25;

function cleanTitle(value: unknown) {
  if (typeof value !== "string") return null;
  const title = value.trim().replace(/\s+/g, " ");
  return title.length >= 1 && title.length <= 120 && !title.includes("\0") ? title : null;
}

export async function GET(request: Request) {
  const auth = await authenticateChatRequest(request);
  if ("response" in auth) return auth.response;
  const url = new URL(request.url);
  const id = url.searchParams.get("id");

  if (id) {
    if (!UUID_RE.test(id)) return chatJson({ error: "Conversation not found." }, 404);
    const { data: conversation, error: conversationError } = await auth.admin
      .from("conversations")
      .select("id,title,customer_name,customer_email,visitor_id,created_at,updated_at")
      .eq("id", id).eq("user_id", auth.user.id).maybeSingle();
    if (conversationError) return chatJson({ error: "Conversation could not be loaded." }, 503);
    if (!conversation) return chatJson({ error: "Conversation not found." }, 404);
    const [{ data: messages, error: messageError }, { data: attachments, error: attachmentError }] = await Promise.all([
      auth.admin.from("messages").select("id,role,content,created_at").eq("conversation_id", id).order("created_at", { ascending: true }).order("id", { ascending: true }).limit(500),
      auth.admin.from("chat_attachments").select("id,message_id,original_name,mime_type,size_bytes,kind,processing_status").eq("user_id", auth.user.id).eq("conversation_id", id).not("message_id", "is", null),
    ]);
    if (messageError || attachmentError) return chatJson({ error: "Conversation messages could not be loaded." }, 503);
    return chatJson({ conversation, messages: messages ?? [], attachments: attachments ?? [] });
  }

  const offsetValue = Number(url.searchParams.get("offset") || "0");
  const offset = Number.isSafeInteger(offsetValue) && offsetValue >= 0 && offsetValue <= 10_000 ? offsetValue : 0;
  const { data, error } = await auth.admin.from("conversations")
    .select("id,title,customer_name,customer_email,visitor_id,created_at,updated_at")
    .eq("user_id", auth.user.id)
    .order("updated_at", { ascending: false })
    .order("id", { ascending: false })
    .range(offset, offset + PAGE_SIZE);
  if (error) return chatJson({ error: "Conversations could not be loaded." }, 503);
  const rows = data ?? [];
  return chatJson({ conversations: rows.slice(0, PAGE_SIZE), hasMore: rows.length > PAGE_SIZE, nextOffset: offset + Math.min(rows.length, PAGE_SIZE) });
}

export async function PATCH(request: Request) {
  const auth = await authenticateChatRequest(request);
  if ("response" in auth) return auth.response;
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return chatJson({ error: "Invalid request." }, 400); }
  const id = typeof body.id === "string" && UUID_RE.test(body.id) ? body.id : null;
  const title = cleanTitle(body.title);
  if (!id || !title) return chatJson({ error: "Enter a title between 1 and 120 characters." }, 400);
  const { data, error } = await auth.admin.from("conversations")
    .update({ title, updated_at: new Date().toISOString() })
    .eq("id", id).eq("user_id", auth.user.id)
    .select("id,title,updated_at").maybeSingle();
  if (error) return chatJson({ error: "Conversation could not be renamed." }, 503);
  return data ? chatJson({ conversation: data }) : chatJson({ error: "Conversation not found." }, 404);
}

export async function DELETE(request: Request) {
  const auth = await authenticateChatRequest(request);
  if ("response" in auth) return auth.response;
  const id = new URL(request.url).searchParams.get("id");
  if (!id || !UUID_RE.test(id)) return chatJson({ error: "Conversation not found." }, 404);
  const { data: owned } = await auth.admin.from("conversations").select("id").eq("id", id).eq("user_id", auth.user.id).maybeSingle();
  if (!owned) return chatJson({ error: "Conversation not found." }, 404);
  const { data: files, error: fileError } = await auth.admin.from("chat_attachments").select("storage_path").eq("conversation_id", id).eq("user_id", auth.user.id);
  if (fileError) return chatJson({ error: "Conversation could not be deleted safely." }, 503);
  const { error } = await auth.admin.from("conversations").delete().eq("id", id).eq("user_id", auth.user.id);
  if (error) return chatJson({ error: "Conversation could not be deleted." }, 503);
  const paths = (files ?? []).map((file) => file.storage_path).filter((path): path is string => typeof path === "string");
  if (paths.length) await auth.admin.storage.from(CHAT_ATTACHMENT_BUCKET).remove(paths);
  return chatJson({ deleted: true });
}
