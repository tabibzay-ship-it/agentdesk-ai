import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

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
      return NextResponse.json(
        {
          error: "Agent ID is required.",
        },
        {
          status: 400,
        }
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

      return NextResponse.json(
        {
          error:
            "Could not load widget settings.",
        },
        {
          status: 500,
        }
      );
    }

    // =========================================
    // Return Defaults If No Settings Exist
    // =========================================

    if (!settings) {
      return NextResponse.json({
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

    return NextResponse.json({
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

    return NextResponse.json(
      {
        error:
          "Could not load widget settings.",
      },
      {
        status: 500,
      }
    );
  }
}