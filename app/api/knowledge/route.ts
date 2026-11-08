import { NextResponse } from "next/server";
import { accountApi } from "@/lib/account-api";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const reply = (data: Record<string, unknown>, status = 200) =>
  NextResponse.json(data, { status, headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });

function clean(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export async function PATCH(request: Request) {
  const auth = await accountApi(request);
  if (!auth) return reply({ error: "Unauthorized" }, 401);
  const body = await request.json().catch(() => null);
  const id = clean(body?.id, 36), title = clean(body?.title, 200), content = clean(body?.content, 200000);
  if (!UUID.test(id) || !title || !content) return reply({ error: "Invalid knowledge source." }, 400);
  const { data, error } = await auth.admin.from("knowledge_sources")
    .update({ title, content }).eq("id", id).eq("user_id", auth.user.id)
    .select("id,title,content,created_at").maybeSingle();
  if (error) return reply({ error: "Could not update this source." }, 503);
  return data ? reply({ source: data }) : reply({ error: "Source not found." }, 404);
}

export async function DELETE(request: Request) {
  const auth = await accountApi(request);
  if (!auth) return reply({ error: "Unauthorized" }, 401);
  const id = new URL(request.url).searchParams.get("id") || "";
  if (!UUID.test(id)) return reply({ error: "Invalid knowledge source." }, 400);
  const { data, error } = await auth.admin.from("knowledge_sources")
    .delete().eq("id", id).eq("user_id", auth.user.id).select("id").maybeSingle();
  if (error) return reply({ error: "Could not delete this source." }, 503);
  return data ? reply({ deleted: true }) : reply({ error: "Source not found." }, 404);
}
