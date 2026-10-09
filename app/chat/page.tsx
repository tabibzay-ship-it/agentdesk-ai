"use client";

import {
  FormEvent,
  useEffect,
  useRef,
  useState,
} from "react";

import { useRouter } from "next/navigation";
import { supabase } from "../../lib/supabase";

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

type UsageInfo = {
  plan: string;
  used: number;
  limit: number;
  remaining: number;
};

export default function ChatPage() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);

  const [userId, setUserId] = useState("");
  const [publicAgentId, setPublicAgentId] =
    useState("");

  const [agentName, setAgentName] =
    useState("AI Support Assistant");

  const [welcomeMessage, setWelcomeMessage] =
    useState(
      "Hi! 👋 How can I help you today?"
    );

  const [agentOnline, setAgentOnline] =
    useState(true);

  const [message, setMessage] = useState("");

  const [messages, setMessages] = useState<
    ChatMessage[]
  >([]);

  const [usage, setUsage] =
    useState<UsageInfo | null>(null);

  const [error, setError] = useState("");

  const bottomRef =
    useRef<HTMLDivElement | null>(null);

  // =========================================
  // LOAD CHAT
  // =========================================

  useEffect(() => {
    async function loadChat() {
      try {
        const {
          data: { user },
          error: userError,
        } = await supabase.auth.getUser();

        if (userError || !user) {
          router.replace("/login");
          return;
        }

        setUserId(user.id);

        // =====================================
        // LOAD WIDGET SETTINGS
        // =====================================

        const {
          data: widget,
          error: widgetError,
        } = await supabase
          .from("widget_settings")
          .select(
            `
            agent_name,
            welcome_message
            `
          )
          .eq("user_id", user.id)
          .maybeSingle();

        if (widgetError) {
          console.error(
            "Widget settings error:",
            widgetError
          );
        }

        if (widget) {
          setAgentName(
            widget.agent_name ||
              "AI Support Assistant"
          );

          setWelcomeMessage(
            widget.welcome_message ||
              "Hi! 👋 How can I help you today?"
          );
        }

        // =====================================
        // LOAD AGENT SETTINGS + PUBLIC ID
        // =====================================

        const {
          data: agentSettings,
          error: agentError,
        } = await supabase
          .from("agent_settings")
          .select(
            `
            is_active,
            public_agent_id
            `
          )
          .eq("user_id", user.id)
          .maybeSingle();

        if (agentError) {
          console.error(
            "Agent settings error:",
            agentError
          );

          setError(
            "Could not load AI Agent settings."
          );
        }

        if (agentSettings) {
          setAgentOnline(
            agentSettings.is_active === true
          );

          if (
            agentSettings.public_agent_id
          ) {
            setPublicAgentId(
              agentSettings.public_agent_id
            );
          } else {
            setError(
              "Public Agent ID is not available."
            );
          }
        } else {
          setError(
            "AI Agent settings were not found."
          );
        }

        // =====================================
        // LOAD USAGE
        // =====================================

        const {
          data: usageData,
          error: usageError,
        } = await supabase
          .from("usage_limits")
          .select(
            `
            plan,
            monthly_limit,
            messages_used
            `
          )
          .eq("user_id", user.id)
          .maybeSingle();

        if (usageError) {
          console.error(
            "Usage load error:",
            usageError
          );
        }

        if (usageData) {
          setUsage({
            plan: usageData.plan,
            used: usageData.messages_used,
            limit: usageData.monthly_limit,
            remaining: Math.max(
              usageData.monthly_limit -
                usageData.messages_used,
              0
            ),
          });
        }
      } catch (loadError) {
        console.error(
          "Chat loading error:",
          loadError
        );

        setError(
          "Could not load the Test Chat."
        );
      } finally {
        setLoading(false);
      }
    }

    loadChat();
  }, [router]);

  // =========================================
  // AUTO SCROLL
  // =========================================

  useEffect(() => {
    bottomRef.current?.scrollIntoView({
      behavior: "smooth",
    });
  }, [messages, sending]);

  // =========================================
  // CREATE TEST VISITOR ID
  // =========================================

  function getVisitorId() {
    const storageKey =
      `agentdesk-dashboard-test-visitor:${userId}:${publicAgentId}`;

    let visitorId =
      localStorage.getItem(storageKey);

    if (!visitorId || !/^dashboard-test-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(visitorId)) {
      visitorId =
        "dashboard-test-" +
        crypto.randomUUID();

      localStorage.setItem(
        storageKey,
        visitorId
      );
    }

    return visitorId;
  }

  // =========================================
  // SEND MESSAGE
  // =========================================

  async function handleSend(
    event: FormEvent
  ) {
    event.preventDefault();

    const cleanMessage = message.trim();

    if (
      !cleanMessage ||
      sending ||
      !userId ||
      !publicAgentId
    ) {
      if (!publicAgentId) {
        setError(
          "Public Agent ID is not available."
        );
      }

      return;
    }

    if (!agentOnline) {
      setError(
        "Your AI Agent is currently offline."
      );
      return;
    }

    if (
      usage &&
      usage.remaining <= 0
    ) {
      setError(
        "Monthly AI message limit reached."
      );
      return;
    }

    const customerMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: cleanMessage,
    };

    setMessages((current) => [
      ...current,
      customerMessage,
    ]);

    setMessage("");
    setError("");
    setSending(true);

    try {
      const response = await fetch(
        "/api/chat",
        {
          method: "POST",

          headers: {
            "Content-Type":
              "application/json",
          },

          body: JSON.stringify({
            message: cleanMessage,
            agentId: publicAgentId,
            visitorId: getVisitorId(),
          }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        if (data.limitReached) {
          setUsage({
            plan:
              data.plan ||
              usage?.plan ||
              "free",

            used:
              data.used ??
              usage?.used ??
              0,

            limit:
              data.limit ??
              usage?.limit ??
              100,

            remaining: 0,
          });

          throw new Error(
            "Monthly AI message limit reached."
          );
        }

        if (data.offline) {
          setAgentOnline(false);

          throw new Error(
            "Your AI Agent is currently offline."
          );
        }

        if (data.rateLimited) {
          throw new Error(
            "Too many messages. Please wait a minute and try again."
          );
        }

        throw new Error(
          data.error ||
            "AI response failed."
        );
      }

      const aiMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: data.reply,
      };

      setMessages((current) => [
        ...current,
        aiMessage,
      ]);

      if (data.usage) {
        setUsage({
          plan:
            data.usage.plan ||
            "free",

          used:
            data.usage.used ?? 0,

          limit:
            data.usage.limit ?? 100,

          remaining:
            data.usage.remaining ?? 0,
        });
      }
    } catch (sendError) {
      console.error(
        "Send message error:",
        sendError
      );

      setError(
        sendError instanceof Error
          ? sendError.message
          : "Something went wrong."
      );
    } finally {
      setSending(false);
    }
  }

  // =========================================
  // CLEAR LOCAL CHAT
  // =========================================

  function clearChat() {
    if (sending) return;
    setMessages([]);
    setError("");

    localStorage.removeItem(
      `agentdesk-dashboard-test-visitor:${userId}:${publicAgentId}`
    );
  }

  // =========================================
  // LOADING
  // =========================================

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-950 text-white">
        <p className="text-slate-400">
          Loading Test Chat...
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

        {/* SIDEBAR */}

        <aside className="hidden w-64 border-r border-slate-800 bg-slate-900 p-5 md:block">
          <div className="mb-10 text-2xl font-bold">
            AgentDesk{" "}
            <span className="text-blue-500">
              AI
            </span>
          </div>

          <nav className="space-y-2">
            <button
              type="button"
              onClick={() =>
                router.push("/dashboard")
              }
              className="w-full rounded-xl px-4 py-3 text-left text-slate-400 transition hover:bg-slate-800 hover:text-white"
            >
              Dashboard
            </button>

            <button
              type="button"
              onClick={() =>
                router.push("/agent")
              }
              className="w-full rounded-xl px-4 py-3 text-left text-slate-400 transition hover:bg-slate-800 hover:text-white"
            >
              AI Agent
            </button>

            <button
              type="button"
              onClick={() =>
                router.push("/knowledge")
              }
              className="w-full rounded-xl px-4 py-3 text-left text-slate-400 transition hover:bg-slate-800 hover:text-white"
            >
              Knowledge Base
            </button>

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

            <button
              type="button"
              className="w-full rounded-xl bg-blue-600 px-4 py-3 text-left font-medium"
            >
              💬 Test Chat
            </button>

            <button
              type="button"
              onClick={() =>
                router.push("/widget")
              }
              className="w-full rounded-xl px-4 py-3 text-left text-slate-400 transition hover:bg-slate-800 hover:text-white"
            >
              Website Widget
            </button>

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

        {/* MAIN CONTENT */}

        <section className="flex min-w-0 flex-1 flex-col">

          {/* HEADER */}

          <header className="flex items-center justify-between border-b border-slate-800 px-5 py-5 lg:px-10">
            <div>
              <h1 className="text-xl font-semibold">
                Test Chat
              </h1>

              <p className="mt-1 text-sm text-slate-500">
                Test your AI support agent.
              </p>
            </div>

            <button
              type="button"
              onClick={() =>
                router.push("/dashboard")
              }
              className="rounded-lg border border-slate-700 px-4 py-2 text-sm transition hover:bg-slate-800"
            >
              Back to Dashboard
            </button>
          </header>

          {/* CONTENT */}

          <div className="flex flex-1 justify-center p-4 md:p-6 lg:p-10">
            <div className="flex w-full max-w-4xl flex-col">

              {/* USAGE */}

              <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-800 bg-slate-900 px-5 py-4">
                <div>
                  <p className="text-sm font-medium">
                    Monthly AI Usage
                  </p>

                  <p className="mt-1 text-xs text-slate-500">
                    Each successful AI reply uses
                    one message.
                  </p>
                </div>

                <div className="text-right">
                  <p className="font-semibold">
                    {usage
                      ? `${usage.used} / ${usage.limit}`
                      : "0 / 100"}
                  </p>

                  <p className="text-xs text-slate-500">
                    {usage
                      ? `${usage.remaining} remaining`
                      : "100 remaining"}
                  </p>
                </div>
              </div>

              {/* CHAT BOARD */}

              <div className="flex min-h-[650px] flex-1 flex-col overflow-hidden rounded-2xl border border-slate-800 bg-slate-900 shadow-2xl">

                {/* CHAT HEADER */}

                <div className="flex items-center justify-between border-b border-slate-800 px-5 py-4">
                  <div className="flex items-center gap-3">
                    <div className="flex h-11 w-11 items-center justify-center rounded-full bg-blue-600 font-bold">
                      AI
                    </div>

                    <div>
                      <h2 className="font-semibold">
                        {agentName}
                      </h2>

                      <p
                        className={`text-xs ${
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
                    onClick={clearChat}
                    disabled={sending}
                    className="rounded-lg border border-slate-700 px-3 py-2 text-xs text-slate-300 transition hover:bg-slate-800"
                  >
                    Clear Chat
                  </button>
                </div>

                {/* MESSAGES */}

                <div className="flex-1 overflow-y-auto p-5">
                  <div className="space-y-4">

                    <div className="flex justify-start">
                      <div className="max-w-[80%] rounded-2xl rounded-tl-md bg-slate-800 px-4 py-3 text-sm leading-6">
                        {welcomeMessage}
                      </div>
                    </div>

                    {messages.map(
                      (chatMessage) => (
                        <div
                          key={chatMessage.id}
                          className={`flex ${
                            chatMessage.role ===
                            "user"
                              ? "justify-end"
                              : "justify-start"
                          }`}
                        >
                          <div
                            className={`max-w-[80%] whitespace-pre-wrap rounded-2xl px-4 py-3 text-sm leading-6 ${
                              chatMessage.role ===
                              "user"
                                ? "rounded-tr-md bg-blue-600 text-white"
                                : "rounded-tl-md bg-slate-800 text-slate-100"
                            }`}
                          >
                            {
                              chatMessage.content
                            }
                          </div>
                        </div>
                      )
                    )}

                    {sending && (
                      <div className="flex justify-start">
                        <div className="rounded-2xl rounded-tl-md bg-slate-800 px-4 py-3 text-sm text-slate-400">
                          AI is typing...
                        </div>
                      </div>
                    )}

                    <div ref={bottomRef} />
                  </div>
                </div>

                {/* ERROR */}

                {error && (
                  <div className="border-t border-red-900/50 bg-red-950/30 px-5 py-3 text-sm text-red-400">
                    {error}
                  </div>
                )}

                {/* INPUT */}

                <form
                  onSubmit={handleSend}
                  className="border-t border-slate-800 p-4"
                >
                  <div className="flex gap-3">
                    <input
                      type="text"
                      value={message}
                      onChange={(event) =>
                        setMessage(
                          event.target.value
                        )
                      }
                      maxLength={2000}
                      disabled={
                        sending ||
                        !agentOnline ||
                        !publicAgentId
                      }
                      placeholder={
                        !publicAgentId
                          ? "Public Agent ID unavailable"
                          : agentOnline
                            ? "Type your message..."
                            : "AI Agent is offline"
                      }
                      className="min-w-0 flex-1 rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm text-white outline-none transition placeholder:text-slate-600 focus:border-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
                    />

                    <button
                      type="submit"
                      disabled={
                        sending ||
                        !message.trim() ||
                        !agentOnline ||
                        !publicAgentId
                      }
                      className="rounded-xl bg-blue-600 px-6 py-3 text-sm font-semibold transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {sending
                        ? "Sending..."
                        : "Send"}
                    </button>
                  </div>

                  <p className="mt-2 text-xs text-slate-600">
                    Maximum 2,000 characters
                  </p>
                </form>
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
