import "server-only";

import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

export function chatJson(data: Record<string, unknown>, status = 200) {
  return NextResponse.json(data, { status, headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
}

export function createChatAdminClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Chat storage is not configured.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export async function authenticateChatRequest(request: Request, admin = createChatAdminClient()): Promise<
  { admin: SupabaseClient; user: User } | { response: NextResponse }
> {
  const token = /^Bearer\s+(\S+)$/i.exec(request.headers.get("authorization") || "")?.[1];
  if (!token) return { response: chatJson({ error: "Please sign in to use attachments.", code: "UNAUTHORIZED" }, 401) };
  const { data: { user }, error } = await admin.auth.getUser(token);
  if (error || !user) return { response: chatJson({ error: "Your session has expired.", code: "UNAUTHORIZED" }, 401) };
  return { admin, user };
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
