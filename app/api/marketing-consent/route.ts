import { NextResponse } from "next/server";
import { accountApi } from "@/lib/account-api";
import { BodyError, readJsonObject } from "@/lib/request-security";

const reply = (data: Record<string, unknown>, status = 200) => NextResponse.json(data, {
  status,
  headers: { "Cache-Control": "private, no-store, max-age=0", "X-Content-Type-Options": "nosniff" },
});

export async function GET(request: Request) {
  const auth = await accountApi(request);
  if (!auth) return reply({ error: "Unauthorized" }, 401);
  const { data, error } = await auth.admin.from("marketing_preferences")
    .select("consented,policy_version,source,updated_at")
    .eq("user_id", auth.user.id).maybeSingle();
  if (error) return reply({ error: "Marketing preferences are not available yet.", code: "MIGRATION_REQUIRED" }, 503);
  return reply({ preference: data ?? { consented: false, policy_version: "2026-10", source: "registration", updated_at: null } });
}

export async function POST(request: Request) {
  const auth = await accountApi(request);
  if (!auth) return reply({ error: "Unauthorized" }, 401);
  let body: Record<string, unknown>;
  try { body = await readJsonObject(request, 1024); }
  catch (error) {
    if (error instanceof BodyError) return reply({ error: error.message }, error.status);
    return reply({ error: "Invalid request." }, 400);
  }
  if (typeof body.consented !== "boolean") return reply({ error: "Choose a valid marketing preference." }, 400);
  const { data, error } = await auth.admin.rpc("set_marketing_consent", {
    p_user_id: auth.user.id,
    p_consented: body.consented,
    p_policy_version: "2026-10",
  });
  if (error) return reply({ error: "The preference could not be saved.", code: "MIGRATION_REQUIRED" }, 503);
  return reply({ preference: data });
}
