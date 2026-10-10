import "server-only";

import { attachmentDto } from "@/lib/chat-attachments";
import { authenticateChatRequest, chatJson, UUID_RE } from "@/lib/chat-server";
import { isVisitorId } from "@/lib/request-security";

export async function GET(request: Request) {
  const auth = await authenticateChatRequest(request);
  if ("response" in auth) return auth.response;
  const url = new URL(request.url);
  const agentId = url.searchParams.get("agentId");
  const visitorId = url.searchParams.get("visitorId");
  if (!agentId || !UUID_RE.test(agentId) || !visitorId || !isVisitorId(visitorId)) return chatJson({ error: "Invalid chat identity." }, 400);
  const { data: agent } = await auth.admin.from("agent_settings").select("user_id").eq("public_agent_id", agentId).eq("user_id", auth.user.id).maybeSingle();
  if (!agent) return chatJson({ error: "Chat not found." }, 404);
  const { data: conversation } = await auth.admin.from("conversations").select("id").eq("user_id", auth.user.id).eq("visitor_id", visitorId).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (!conversation) return chatJson({ messages: [] });
  const [{ data: messages, error }, { data: attachments }] = await Promise.all([
    auth.admin.from("messages").select("id,role,content,created_at").eq("conversation_id", conversation.id).order("created_at", { ascending: true }).limit(100),
    auth.admin.from("chat_attachments").select("id,message_id,original_name,mime_type,size_bytes,kind,processing_status").eq("user_id", auth.user.id).eq("conversation_id", conversation.id).not("message_id", "is", null),
  ]);
  if (error) return chatJson({ error: "Conversation history could not be loaded." }, 503);
  return chatJson({ messages: (messages ?? []).map((message) => ({
    id: message.id, role: message.role, content: message.content, createdAt: message.created_at,
    attachments: (attachments ?? []).filter((item) => item.message_id === message.id).map((item) => attachmentDto(item)),
  })) });
}
