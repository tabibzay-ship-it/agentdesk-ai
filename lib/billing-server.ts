import "server-only";

import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

export function billingJson(data: Record<string, unknown>, status = 200) {
  return NextResponse.json(data, {
    status,
    headers: {
      "Cache-Control": "private, no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export function createBillingAdminClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) throw new Error("Billing service is not configured.");
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function authenticateBillingRequest(
  request: Request,
  admin = createBillingAdminClient()
): Promise<{ admin: SupabaseClient; user: User } | { response: NextResponse }> {
  const token = /^Bearer\s+(\S+)$/i.exec(request.headers.get("authorization") || "")?.[1];
  if (!token) {
    return { response: billingJson({ error: "Please sign in to manage billing.", code: "UNAUTHORIZED" }, 401) };
  }
  const { data: { user }, error } = await admin.auth.getUser(token);
  if (error || !user) {
    return { response: billingJson({ error: "Your session has expired. Please sign in again.", code: "UNAUTHORIZED" }, 401) };
  }
  return { admin, user };
}
