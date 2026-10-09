import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import {
  buildCorsHeaders,
  getCorsOrigin,
  isRequestOriginAllowed,
  parseRequestOrigin,
} from "@/lib/origin-security";

// =========================================
// CORS
// =========================================

function createJsonResponse(
  data: Record<string, unknown>,
  status = 200,
  allowedOrigin: string | null = null
) {
  return NextResponse.json(data, {
    status,
    headers: buildCorsHeaders(
      allowedOrigin,
      "GET, OPTIONS"
    ),
  });
}

// =========================================
// OPTIONS /api/widget-settings
// =========================================

export async function OPTIONS(request: Request) {
  const originHeader = request.headers.get("origin");
  const requestOrigin =
    parseRequestOrigin(originHeader);

  if (
    originHeader !== null &&
    !requestOrigin
  ) {
    return createJsonResponse(
      {
        error: "Invalid request origin.",
        code: "INVALID_ORIGIN",
      },
      403
    );
  }

  return new Response(null, {
    status: 204,
    headers: buildCorsHeaders(
      getCorsOrigin(originHeader, requestOrigin),
      "GET, OPTIONS"
    ),
  });
}

// =========================================
// SUPABASE ADMIN
// =========================================

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  }
);

// =========================================
// GET /api/widget-settings
// =========================================

export async function GET(request: Request) {
  const originHeader = request.headers.get("origin");
  const requestOrigin = parseRequestOrigin(originHeader);

  if (
    originHeader !== null &&
    !requestOrigin
  ) {
    return createJsonResponse(
      {
        error: "Invalid request origin.",
        code: "INVALID_ORIGIN",
      },
      403
    );
  }

  const corsOrigin = getCorsOrigin(
    originHeader,
    requestOrigin
  );
  const jsonResponse = (
    data: Record<string, unknown>,
    status = 200
  ) => createJsonResponse(data, status, corsOrigin);

  try {
    const { searchParams } =
      new URL(request.url);

    const publicAgentId =
      searchParams.get("agentId");

    // =====================================
    // VALIDATE PUBLIC AGENT ID
    // =====================================

    if (!publicAgentId) {
      return jsonResponse(
        {
          error: "Agent ID is required.",
        },
        400
      );
    }

    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

    if (!uuidRegex.test(publicAgentId)) {
      return jsonResponse(
        {
          error: "Invalid Agent ID.",
        },
        400
      );
    }

    // =====================================
    // RESOLVE PUBLIC AGENT ID
    // Public Agent ID -> Internal User ID
    // =====================================

    const {
      data: agentSettings,
      error: agentError,
    } = await supabaseAdmin
      .from("agent_settings")
      .select(
        `
        user_id,
        public_agent_id,
        is_active,
        allowed_domains
        `
      )
      .eq(
        "public_agent_id",
        publicAgentId
      )
      .maybeSingle();

    if (agentError) {
      console.error("Public Agent ID lookup failed.");

      return jsonResponse(
        {
          error:
            "Could not load AI Agent.",
        },
        500
      );
    }

    if (!agentSettings?.user_id) {
      return jsonResponse(
        {
          error: "AI Agent not found.",
        },
        404
      );
    }

    if (
      !isRequestOriginAllowed(
        request,
        requestOrigin,
        agentSettings.allowed_domains
      )
    ) {
      return createJsonResponse(
        {
          error:
            "This website is not allowed to use this AI Agent.",
          code: "ORIGIN_NOT_ALLOWED",
        },
        403
      );
    }

    const userId =
      agentSettings.user_id;

    // =====================================
    // GET WIDGET SETTINGS
    // =====================================

    const {
      data: settings,
      error: settingsError,
    } = await supabaseAdmin
      .from("widget_settings")
      .select(
        `
        agent_name,
        welcome_message,
        primary_color
        `
      )
      .eq("user_id", userId)
      .maybeSingle();

    if (settingsError) {
      console.error("Widget settings lookup failed.");

      return jsonResponse(
        {
          error:
            "Could not load widget settings.",
        },
        500
      );
    }

    // =====================================
    // RETURN DEFAULTS IF NO SETTINGS EXIST
    // =====================================

    if (!settings) {
      return jsonResponse({
        agentName:
          "AI Support Assistant",

        welcomeMessage:
          "Hi! 👋 How can I help you today?",

        primaryColor:
          "#2563eb",

        isActive:
          agentSettings.is_active === true,
      });
    }

    // =====================================
    // RETURN SAVED SETTINGS
    // =====================================

    return jsonResponse({
      agentName:
        (typeof settings.agent_name === "string" && settings.agent_name.slice(0, 100)) ||
        "AI Support Assistant",

      welcomeMessage:
        (typeof settings.welcome_message === "string" && settings.welcome_message.slice(0, 1000)) ||
        "Hi! 👋 How can I help you today?",

      primaryColor:
        (typeof settings.primary_color === "string" && /^#[0-9a-f]{6}$/i.test(settings.primary_color) && settings.primary_color) ||
        "#2563eb",

      isActive:
        agentSettings.is_active === true,
    });
  } catch {
    console.error("Widget settings request failed.");

    return jsonResponse(
      {
        error:
          "Could not load widget settings.",
      },
      500
    );
  }
}
