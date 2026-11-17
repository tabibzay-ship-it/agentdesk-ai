import "server-only";

import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

export type AdminAuth = { admin: SupabaseClient; user: User; requestId: string };

export function adminJson(data: Record<string, unknown>, status = 200) {
  return NextResponse.json(data, {
    status,
    headers: {
      "Cache-Control": "private, no-store, max-age=0",
      "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "no-referrer",
    },
  });
}

export function createAdminClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Administration service is not configured.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export async function writeAdminAudit(
  admin: SupabaseClient,
  userId: string,
  action: string,
  requestId: string,
  outcome: "allowed" | "denied" | "failed" = "allowed",
  metadata: Record<string, string | number | boolean> = {}
) {
  const { error } = await admin.from("admin_audit_events").insert({
    admin_user_id: userId,
    action,
    outcome,
    request_id: requestId,
    metadata,
  });
  if (error) throw new Error("Administrator audit logging failed.");
}

export async function authenticateAdminRequest(
  request: Request,
  admin = createAdminClient()
): Promise<AdminAuth | { response: NextResponse }> {
  const requestId = crypto.randomUUID();
  const token = /^Bearer\s+(\S+)$/i.exec(request.headers.get("authorization") || "")?.[1];
  if (!token) return { response: adminJson({ error: "Administrator sign-in required.", code: "UNAUTHORIZED" }, 401) };

  const [{ data: userData, error: userError }, { data: claimData, error: claimError }] = await Promise.all([
    admin.auth.getUser(token),
    admin.auth.getClaims(token),
  ]);
  const user = userData.user;
  if (userError || claimError || !user || !claimData || claimData.claims.sub !== user.id) {
    return { response: adminJson({ error: "Administrator session expired.", code: "UNAUTHORIZED" }, 401) };
  }

  const { data: role, error: roleError } = await admin.from("super_admins")
    .select("user_id,is_active,mfa_required")
    .eq("user_id", user.id)
    .eq("is_active", true)
    .maybeSingle();
  if (roleError) return { response: adminJson({ error: "Administrator access is not configured.", code: "ADMIN_MIGRATION_REQUIRED" }, 503) };
  if (!role) return { response: adminJson({ error: "Access denied.", code: "FORBIDDEN" }, 403) };

  const verifiedTotp = user.factors?.some((factor) => factor.factor_type === "totp" && factor.status === "verified") === true;
  if (!verifiedTotp) return { response: adminJson({ error: "Multi-factor enrollment is required.", code: "MFA_SETUP_REQUIRED" }, 403) };
  if (role.mfa_required && claimData.claims.aal !== "aal2") {
    return { response: adminJson({ error: "Multi-factor verification is required.", code: "MFA_REQUIRED" }, 403) };
  }
  return { admin, user, requestId };
}
