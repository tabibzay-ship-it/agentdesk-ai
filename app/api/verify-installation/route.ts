import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { getTrustedApplicationOrigin, isRequestOriginAllowed, parseRequestOrigin } from "@/lib/origin-security";
import { BodyError, readJsonObject } from "@/lib/request-security";
import {
  fetchInstallationPage,
  hasInstallationScript,
  InstallationVerificationError,
  normalizeInstallationUrl,
} from "@/lib/installation-verification";

export const runtime = "nodejs";

function json(data: Record<string, unknown>, status = 200) {
  return NextResponse.json(data, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
}

export async function GET(request: Request) {
  const origin = getTrustedApplicationOrigin(request);
  if (!origin) return json({ error: "The installation service is not configured. Please contact support.", code: "SERVICE_NOT_CONFIGURED" }, 503);
  return json({ widgetUrl: new URL("/widget.js", origin.origin).href });
}

export async function POST(request: Request) {
  const token = /^Bearer\s+(\S+)$/i.exec(request.headers.get("authorization") || "")?.[1];
  if (!token) return json({ verified: false, error: "Please sign in to verify installation." }, 401);

  try {
    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } }
    );
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
    if (authError || !user) return json({ verified: false, error: "Your session has expired. Please sign in again." }, 401);

    let body: Record<string, unknown>;
    try { body = await readJsonObject(request, 4096); } catch (error) {
      if (error instanceof BodyError) {
        return json({ verified: false, error: error.message, code: error.code }, error.status);
      }
      return json({ verified: false, error: "Invalid request body." }, 400);
    }
    if (typeof body.websiteUrl !== "string" || !body.websiteUrl.trim()) {
      return json({ verified: false, error: "Website URL is required." }, 400);
    }

    const websiteUrl = normalizeInstallationUrl(body.websiteUrl);
    const applicationOrigin = getTrustedApplicationOrigin(request);
    if (!applicationOrigin) return json({ verified: false, code: "SERVICE_NOT_CONFIGURED", error: "The installation service is not configured. Please contact support." }, 503);
    const { data: agent, error: agentError } = await supabaseAdmin
      .from("agent_settings").select("public_agent_id, allowed_domains").eq("user_id", user.id).maybeSingle();
    if (agentError) return json({ verified: false, error: "Could not load Agent settings." }, 500);
    if (!agent?.public_agent_id) return json({ verified: false, error: "Public Agent ID is not available. Please check Agent settings." }, 400);

    const { data: rateAllowed, error: rateError } = await supabaseAdmin.rpc("check_chat_rate_limit", {
      p_agent_id: user.id, p_visitor_id: "__installation__", p_limit: 5, p_window_seconds: 60,
    });
    if (rateError) return json({ verified: false, error: "Could not check verification limits. Please try again." }, 503);
    if (rateAllowed !== true) return json({ verified: false, code: "RATE_LIMITED", error: "Too many verification attempts. Please wait a minute and try again." }, 429);

    // Reuse the widget/chat allowlist policy for the initial URL and every redirect.
    const isAllowed = (url: URL) => isRequestOriginAllowed(request, parseRequestOrigin(url.origin), agent.allowed_domains);
    const page = await fetchInstallationPage(websiteUrl, { allowLocalhost: process.env.NODE_ENV !== "production", isAllowed });
    const expectedWidgetUrl = new URL("/widget.js", applicationOrigin.origin);
    if (!hasInstallationScript(page.html, page.url, expectedWidgetUrl, agent.public_agent_id)) {
      // A failed check of another URL must not erase a previously saved installation.
      return json({ verified: false, code: "WIDGET_NOT_FOUND", error: "Your AgentDesk widget script and Public Agent ID were not found together in the page HTML. Paste the installation code directly into the published page and try again." }, 422);
    }

    const status = { is_installed: true, updated_at: new Date().toISOString() };
    const { data: saved, error: updateError } = await supabaseAdmin
      .from("widget_settings").update(status).eq("user_id", user.id).select("is_installed").maybeSingle();
    if (updateError) return json({ verified: false, error: "Widget detected, but installation status could not be saved. Please try again." }, 500);

    // A new account may not have saved widget customization yet.
    if (!saved) {
      const { data: inserted, error: insertError } = await supabaseAdmin.from("widget_settings").insert({
        user_id: user.id,
        agent_name: "AI Support Assistant",
        welcome_message: "Hi! 👋 How can I help you today?",
        primary_color: "#2563eb",
        ...status,
      }).select("is_installed").single();
      if (insertError || inserted?.is_installed !== true) return json({ verified: false, error: "Widget detected, but installation status could not be saved. Please try again." }, 500);
    } else if (saved.is_installed !== true) {
      return json({ verified: false, error: "Widget detected, but installation status could not be saved. Please try again." }, 500);
    }
    return json({ verified: true, website: page.url.href });
  } catch (error) {
    if (error instanceof InstallationVerificationError) {
      return json({ verified: false, code: error.code, error: error.message }, error.code === "ORIGIN_NOT_ALLOWED" ? 403 : 400);
    }
    // Do not log user tokens, database errors, URL credentials, or server secrets.
    return json({ verified: false, error: "Installation verification failed. Please try again." }, 500);
  }
}
