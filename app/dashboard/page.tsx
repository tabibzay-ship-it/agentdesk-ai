"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../../lib/supabase";

export default function DashboardPage() {
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(true);

  const [businessCompleted, setBusinessCompleted] =
    useState(false);

  const [knowledgeCompleted, setKnowledgeCompleted] =
    useState(false);

  const [widgetCompleted, setWidgetCompleted] =
    useState(false);

  const [installCompleted, setInstallCompleted] =
    useState(false);

  const [knowledgeCount, setKnowledgeCount] =
    useState(0);

  const [conversationCount, setConversationCount] =
    useState(0);

  const [aiResponseCount, setAiResponseCount] =
    useState(0);

  const [agentOnline, setAgentOnline] =
    useState(true);

  const [agentName, setAgentName] =
    useState("AI Support Assistant");

  const [welcomeMessage, setWelcomeMessage] =
    useState(
      "Hi! 👋 How can I help you today?"
    );

  // =========================================
  // LOAD DASHBOARD
  // =========================================

  useEffect(() => {
    async function loadDashboard() {
      try {
        // =====================================
        // GET LOGGED-IN USER
        // =====================================

        const {
          data: { user },
          error: userError,
        } = await supabase.auth.getUser();

        if (userError || !user) {
          router.replace("/login");
          return;
        }

        // =====================================
        // USER INFORMATION
        // =====================================

        setEmail(user.email ?? "");

        setName(
          user.user_metadata?.full_name ??
            user.email?.split("@")[0] ??
            "User"
        );

        // =====================================
        // STEP 1 - BUSINESS INFORMATION
        // =====================================

        const {
          data: business,
          error: businessError,
        } = await supabase
          .from("business_profiles")
          .select("id")
          .eq("user_id", user.id)
          .limit(1);

        if (!businessError) {
          setBusinessCompleted(
            !!business && business.length > 0
          );
        } else {
          console.error(
            "Business information error:",
            businessError
          );
        }

        // =====================================
        // STEP 2 - KNOWLEDGE BASE
        // =====================================

        const {
          count: knowledgeTotal,
          error: knowledgeError,
        } = await supabase
          .from("knowledge_sources")
          .select("*", {
            count: "exact",
            head: true,
          })
          .eq("user_id", user.id);

        if (!knowledgeError) {
          const total =
            knowledgeTotal ?? 0;

          setKnowledgeCount(total);

          setKnowledgeCompleted(
            total > 0
          );
        } else {
          console.error(
            "Knowledge count error:",
            knowledgeError
          );
        }

        // =====================================
        // CONVERSATIONS COUNT
        // =====================================

        const {
          count: conversationsTotal,
          error: conversationsError,
        } = await supabase
          .from("conversations")
          .select("*", {
            count: "exact",
            head: true,
          })
          .eq("user_id", user.id);

        if (!conversationsError) {
          setConversationCount(
            conversationsTotal ?? 0
          );
        } else {
          console.error(
            "Conversations count error:",
            conversationsError
          );
        }

        // =====================================
        // AI RESPONSES COUNT
        // =====================================

        const {
          count: responsesTotal,
          error: responsesError,
        } = await supabase
          .from("messages")
          .select(
            `
            *,
            conversations!inner(user_id)
            `,
            {
              count: "exact",
              head: true,
            }
          )
          .eq("role", "assistant")
          .eq(
            "conversations.user_id",
            user.id
          );

        if (!responsesError) {
          setAiResponseCount(
            responsesTotal ?? 0
          );
        } else {
          console.error(
            "AI responses count error:",
            responsesError
          );
        }

        // =====================================
        // STEP 3 + STEP 4
        // WIDGET SETTINGS
        // =====================================

        const {
          data: widget,
          error: widgetError,
        } = await supabase
          .from("widget_settings")
          .select(
            `
            id,
            agent_name,
            welcome_message,
            is_installed
            `
          )
          .eq("user_id", user.id)
          .maybeSingle();

        if (!widgetError && widget) {
          // Step 3
          setWidgetCompleted(true);

          // Step 4
          setInstallCompleted(
            widget.is_installed === true
          );

          // Preview settings
          setAgentName(
            widget.agent_name ||
              "AI Support Assistant"
          );

          setWelcomeMessage(
            widget.welcome_message ||
              "Hi! 👋 How can I help you today?"
          );
        } else if (widgetError) {
          console.error(
            "Widget settings error:",
            widgetError
          );
        }

        // =====================================
        // AGENT STATUS
        // =====================================

        const {
          data: agentSettings,
          error: agentError,
        } = await supabase
          .from("agent_settings")
          .select("is_active")
          .eq("user_id", user.id)
          .maybeSingle();

        if (
          !agentError &&
          agentSettings
        ) {
          setAgentOnline(
            agentSettings.is_active === true
          );
        } else if (agentError) {
          console.error(
            "Agent status error:",
            agentError
          );
        }
      } catch (error) {
        console.error(
          "Dashboard loading error:",
          error
        );
      } finally {
        setLoading(false);
      }
    }

    loadDashboard();
  }, [router]);

  // =========================================
  // LOGOUT
  // =========================================

  async function handleLogout() {
    await supabase.auth.signOut();

    router.replace("/login");
  }

  // =========================================
  // LOADING
  // =========================================

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-950 text-white">
        <p className="text-slate-400">
          Loading AgentDesk AI...
        </p>
      </main>
    );
  }

  // =========================================
  // PAGE
  // =========================================

  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <div className="flex min-h-screen">

        {/* =====================================
            SIDEBAR
        ====================================== */}

        <aside className="hidden w-64 border-r border-slate-800 bg-slate-900 p-5 md:block">

          <div className="mb-10 text-2xl font-bold">
            AgentDesk{" "}
            <span className="text-blue-500">
              AI
            </span>
          </div>

          <nav className="space-y-2">

            {/* Dashboard */}

            <button
              type="button"
              className="w-full rounded-xl bg-blue-600 px-4 py-3 text-left font-medium"
            >
              Dashboard
            </button>

            {/* AI Agent */}

            <button
              type="button"
              onClick={() =>
                router.push("/agent")
              }
              className="w-full rounded-xl px-4 py-3 text-left text-slate-400 transition hover:bg-slate-800 hover:text-white"
            >
              AI Agent
            </button>

            {/* Knowledge Base */}

            <button
              type="button"
              onClick={() =>
                router.push("/knowledge")
              }
              className="w-full rounded-xl px-4 py-3 text-left text-slate-400 transition hover:bg-slate-800 hover:text-white"
            >
              Knowledge Base
            </button>

            {/* Conversations */}

            <button
              type="button"
              onClick={() =>
                router.push(
                  "/conversations"
                )
              }
              className="w-full rounded-xl px-4 py-3 text-left text-slate-400 transition hover:bg-slate-800 hover:text-white"
            >
              Conversations
            </button>

            {/* Test Chat */}

            <button
              type="button"
              onClick={() =>
                router.push("/chat")
              }
              className="w-full rounded-xl px-4 py-3 text-left text-slate-400 transition hover:bg-slate-800 hover:text-white"
            >
              💬 Test Chat
            </button>

            {/* Website Widget */}

            <button
              type="button"
              onClick={() =>
                router.push("/widget")
              }
              className="w-full rounded-xl px-4 py-3 text-left text-slate-400 transition hover:bg-slate-800 hover:text-white"
            >
              Website Widget
            </button>

            {/* Settings */}

            <button
              type="button"
              onClick={() =>
                router.push("/settings")
              }
              className="w-full rounded-xl px-4 py-3 text-left text-slate-400 transition hover:bg-slate-800 hover:text-white"
            >
              Settings
            </button>

          </nav>
        </aside>

        {/* =====================================
            MAIN CONTENT
        ====================================== */}

        <section className="flex-1">

          {/* HEADER */}

          <header className="flex items-center justify-between border-b border-slate-800 px-6 py-5 lg:px-10">

            <div>
              <h1 className="text-xl font-semibold">
                Dashboard
              </h1>

              <p className="text-sm text-slate-500">
                Manage your AI customer support.
              </p>
            </div>

            <div className="flex items-center gap-4">

              <div className="hidden text-right sm:block">
                <p className="text-sm font-medium">
                  {name}
                </p>

                <p className="text-xs text-slate-500">
                  {email}
                </p>
              </div>

              <button
                type="button"
                onClick={handleLogout}
                className="rounded-lg border border-slate-700 px-4 py-2 text-sm transition hover:bg-slate-800"
              >
                Sign Out
              </button>

            </div>
          </header>

          <div className="p-6 lg:p-10">

            {/* =====================================
                WELCOME
            ====================================== */}

            <div className="mb-8">

              <h2 className="text-3xl font-bold">
                Welcome, {name} 👋
              </h2>

              <p className="mt-2 text-slate-400">
                Here&apos;s what&apos;s happening
                with your AI support agent.
              </p>

            </div>

            {/* =====================================
                STATISTICS
            ====================================== */}

            <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">

              {/* Conversations */}

              <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6">

                <p className="text-sm text-slate-400">
                  Conversations
                </p>

                <p className="mt-3 text-3xl font-bold">
                  {conversationCount}
                </p>

                <p className="mt-2 text-xs text-slate-500">
                  Total conversations
                </p>

              </div>

              {/* AI Responses */}

              <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6">

                <p className="text-sm text-slate-400">
                  AI Responses
                </p>

                <p className="mt-3 text-3xl font-bold">
                  {aiResponseCount}
                </p>

                <p className="mt-2 text-xs text-slate-500">
                  Messages answered by AI
                </p>

              </div>

              {/* Knowledge Sources */}

              <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6">

                <p className="text-sm text-slate-400">
                  Knowledge Sources
                </p>

                <p className="mt-3 text-3xl font-bold">
                  {knowledgeCount}
                </p>

                <p className="mt-2 text-xs text-slate-500">
                  Training sources
                </p>

              </div>

              {/* Agent Status */}

              <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6">

                <p className="text-sm text-slate-400">
                  Agent Status
                </p>

                <div className="mt-3 flex items-center gap-2">

                  <span
                    className={`h-3 w-3 rounded-full ${
                      agentOnline
                        ? "bg-green-500"
                        : "bg-red-500"
                    }`}
                  />

                  <p
                    className={`text-xl font-bold ${
                      agentOnline
                        ? "text-white"
                        : "text-red-400"
                    }`}
                  >
                    {agentOnline
                      ? "Online"
                      : "Offline"}
                  </p>

                </div>

                <p className="mt-2 text-xs text-slate-500">
                  {agentOnline
                    ? "AI agent is ready"
                    : "AI agent is disabled"}
                </p>

              </div>
            </div>

            {/* =====================================
                SETUP + AGENT PREVIEW
            ====================================== */}

            <div className="mt-8 grid gap-6 lg:grid-cols-2">

              {/* SETUP CARD */}

              <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6">

                <h3 className="text-xl font-semibold">
                  Set up your AI Agent
                </h3>

                <p className="mt-2 text-sm text-slate-400">
                  Complete these steps to launch
                  your customer support agent.
                </p>

                <div className="mt-6 space-y-4">

                  {/* STEP 1 */}

                  <div className="flex items-center justify-between gap-4 rounded-xl bg-slate-950 p-4">

                    <span>
                      1. Add business information
                    </span>

                    <button
                      type="button"
                      onClick={() =>
                        router.push("/business")
                      }
                      className={
                        businessCompleted
                          ? "font-medium text-green-400 transition hover:text-green-300"
                          : "font-medium text-blue-400 transition hover:text-blue-300"
                      }
                    >
                      {businessCompleted
                        ? "Completed ✓"
                        : "Start"}
                    </button>

                  </div>

                  {/* STEP 2 */}

                  <div className="flex items-center justify-between gap-4 rounded-xl bg-slate-950 p-4">

                    <span>
                      2. Add knowledge
                    </span>

                    <button
                      type="button"
                      onClick={() =>
                        router.push(
                          "/knowledge"
                        )
                      }
                      className={
                        knowledgeCompleted
                          ? "font-medium text-green-400 transition hover:text-green-300"
                          : "font-medium text-blue-400 transition hover:text-blue-300"
                      }
                    >
                      {knowledgeCompleted
                        ? "Completed ✓"
                        : "Start"}
                    </button>

                  </div>

                  {/* STEP 3 */}

                  <div className="flex items-center justify-between gap-4 rounded-xl bg-slate-950 p-4">

                    <span>
                      3. Customize chat widget
                    </span>

                    <button
                      type="button"
                      onClick={() =>
                        router.push("/widget")
                      }
                      className={
                        widgetCompleted
                          ? "font-medium text-green-400 transition hover:text-green-300"
                          : "font-medium text-blue-400 transition hover:text-blue-300"
                      }
                    >
                      {widgetCompleted
                        ? "Completed ✓"
                        : "Start"}
                    </button>

                  </div>

                  {/* STEP 4 */}

                  <div className="flex items-center justify-between gap-4 rounded-xl bg-slate-950 p-4">

                    <span>
                      4. Install on your website
                    </span>

                    <button
                      type="button"
                      onClick={() =>
                        router.push("/install")
                      }
                      className={
                        installCompleted
                          ? "font-medium text-green-400 transition hover:text-green-300"
                          : "font-medium text-blue-400 transition hover:text-blue-300"
                      }
                    >
                      {installCompleted
                        ? "Completed ✓"
                        : "Pending"}
                    </button>

                  </div>

                </div>
              </div>

              {/* =====================================
                  AGENT PREVIEW
              ====================================== */}

              <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6">

                <div className="flex items-center justify-between gap-4">

                  <div className="flex items-center gap-3">

                    <div className="flex h-11 w-11 items-center justify-center rounded-full bg-blue-600 font-bold">
                      AI
                    </div>

                    <div>
                      <h3 className="font-semibold">
                        {agentName}
                      </h3>

                      <p
                        className={`text-sm ${
                          agentOnline
                            ? "text-green-400"
                            : "text-red-400"
                        }`}
                      >
                        {agentOnline
                          ? "● Online"
                          : "● Offline"}
                      </p>
                    </div>

                  </div>

                  <button
                    type="button"
                    onClick={() =>
                      router.push("/chat")
                    }
                    className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold transition hover:bg-blue-500"
                  >
                    Open Chat
                  </button>

                </div>

                <div className="mt-6 rounded-xl bg-slate-950 p-5">

                  <div className="max-w-xs rounded-xl bg-slate-800 p-4 text-sm">
                    {welcomeMessage}
                  </div>

                  <div className="mt-5 flex gap-2">

                    <input
                      readOnly
                      onClick={() =>
                        router.push("/chat")
                      }
                      placeholder="Click here to open Test Chat..."
                      className="min-w-0 flex-1 cursor-pointer rounded-xl border border-slate-800 bg-slate-900 px-4 py-3 text-sm outline-none"
                    />

                    <button
                      type="button"
                      onClick={() =>
                        router.push("/chat")
                      }
                      className="rounded-xl bg-blue-600 px-5 text-sm font-semibold transition hover:bg-blue-500"
                    >
                      Chat
                    </button>

                  </div>

                </div>
              </div>

            </div>
          </div>
        </section>
      </div>
    </main>
  );
}