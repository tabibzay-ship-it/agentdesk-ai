import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

// =========================================
// CORS
// =========================================

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function jsonResponse(
  data: Record<string, unknown>,
  status = 200
) {
  return NextResponse.json(data, {
    status,
    headers: corsHeaders,
  });
}

// =========================================
// OPTIONS /api/widget-settings
// =========================================

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: corsHeaders,
  });
}

// =========================================
// Supabase Server Client
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
  try {
    const { searchParams } =
      new URL(request.url);

    const agentId =
      searchParams.get("agentId");

    // =========================================
    // Validate Agent ID
    // =========================================

    if (!agentId) {
      return jsonResponse(
        {
          error: "Agent ID is required.",
        },
        400
      );
    }

    // =========================================
    // Get Widget Settings
    // =========================================

    const {
      data: settings,
      error,
    } = await supabaseAdmin
      .from("widget_settings")
      .select(
        `
        agent_name,
        welcome_message,
        primary_color
        `
      )
      .eq("user_id", agentId)
      .maybeSingle();

    if (error) {
      console.error(
        "Widget settings error:",
        error
      );

      return jsonResponse(
        {
          error:
            "Could not load widget settings.",
        },
        500
      );
    }

    // =========================================
    // Return Defaults If No Settings Exist
    // =========================================

    if (!settings) {
      return jsonResponse({
        agentName:
          "AI Support Assistant",

        welcomeMessage:
          "Hi! 👋 How can I help you today?",

        primaryColor:
          "#2563eb",
      });
    }

    // =========================================
    // Return Saved Settings
    // =========================================

    return jsonResponse({
      agentName:
        settings.agent_name ||
        "AI Support Assistant",

      welcomeMessage:
        settings.welcome_message ||
        "Hi! 👋 How can I help you today?",

      primaryColor:
        settings.primary_color ||
        "#2563eb",
    });
  } catch (error) {
    console.error(
      "Widget settings API error:",
      error
    );

    return jsonResponse(
      {
        error:
          "Could not load widget settings.",
      },
      500
    );
  }
}