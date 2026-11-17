import { NextResponse } from "next/server";
import { accountApi } from "@/lib/account-api";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const reply = (body: Record<string, unknown>, status = 200) => NextResponse.json(body, {
  status,
  headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" },
});

async function ownsLead(auth: NonNullable<Awaited<ReturnType<typeof accountApi>>>, leadId: string) {
  const { data } = await auth.admin.from("leads").select("id").eq("id", leadId)
    .eq("user_id", auth.user.id).maybeSingle();
  return Boolean(data);
}

export async function GET(request: Request) {
  const auth = await accountApi(request);
  if (!auth) return reply({ error: "Unauthorized" }, 401);
  const leadId = new URL(request.url).searchParams.get("leadId") ?? "";
  if (!UUID.test(leadId) || !(await ownsLead(auth, leadId))) return reply({ error: "Lead not found." }, 404);
  const { data, error } = await auth.admin.from("lead_follow_ups").select("id,lead_id,due_at,note,completed_at,created_at")
    .eq("user_id", auth.user.id).eq("lead_id", leadId).order("due_at", { ascending: true }).limit(100);
  return error ? reply({ error: "Could not load follow-ups." }, 503) : reply({ rows: data ?? [] });
}

export async function POST(request: Request) {
  const auth = await accountApi(request);
  if (!auth) return reply({ error: "Unauthorized" }, 401);
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const leadId = typeof body?.leadId === "string" ? body.leadId : "";
  const note = typeof body?.note === "string" ? body.note.trim().slice(0, 1000) : "";
  const due = new Date(String(body?.dueAt ?? ""));
  if (!UUID.test(leadId) || !note || Number.isNaN(due.valueOf())) return reply({ error: "Invalid follow-up." }, 400);
  if (!(await ownsLead(auth, leadId))) return reply({ error: "Lead not found." }, 404);
  const { data, error } = await auth.admin.from("lead_follow_ups").insert({
    user_id: auth.user.id, lead_id: leadId, due_at: due.toISOString(), note,
  }).select("id,lead_id,due_at,note,completed_at,created_at").single();
  return error ? reply({ error: "Could not create follow-up." }, 503) : reply({ followUp: data }, 201);
}

export async function PATCH(request: Request) {
  const auth = await accountApi(request);
  if (!auth) return reply({ error: "Unauthorized" }, 401);
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const id = typeof body?.id === "string" ? body.id : "";
  if (!UUID.test(id) || typeof body?.completed !== "boolean") return reply({ error: "Invalid follow-up." }, 400);
  const { data, error } = await auth.admin.from("lead_follow_ups")
    .update({ completed_at: body.completed ? new Date().toISOString() : null })
    .eq("id", id).eq("user_id", auth.user.id).select("id,completed_at").maybeSingle();
  if (error) return reply({ error: "Could not update follow-up." }, 503);
  return data ? reply({ followUp: data }) : reply({ error: "Follow-up not found." }, 404);
}
