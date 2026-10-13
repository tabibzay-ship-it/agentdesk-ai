
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

type Conversation = {
  id: string;
  customer_name: string | null;
  customer_email: string | null;
  visitor_id: string | null;
  created_at: string;
};

type Message = {
  id: string;
  role: string;
  content: string;
  created_at: string;
};

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Unknown date"
    : date.toLocaleString();
}

export default function ConversationsPage() {
  const router = useRouter();

  const [search, setSearch] = useState("");
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedConversation, setSelectedConversation] =
    useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [error, setError] = useState("");

  const messageRequest = useRef(0);

  const loadMessages = useCallback(
    async (conversationId: string) => {
      const requestNumber = ++messageRequest.current;

      setMessagesLoading(true);
      setMessages([]);
      setError("");

      try {
        const {
          data: { user },
          error: authError,
        } = await supabase.auth.getUser();

        if (requestNumber !== messageRequest.current) return;

        if (authError || !user) {
          setConversations([]);
          setSelectedConversation(null);
          router.replace("/login");
          return;
        }

        const { data, error: messagesError } = await supabase
          .from("messages")
          .select(`
            id,
            role,
            content,
            created_at,
            conversations!inner(user_id)
          `)
          .eq("conversation_id", conversationId)
          .eq("conversations.user_id", user.id)
          .order("created_at", { ascending: true });

        if (requestNumber !== messageRequest.current) return;

        if (messagesError) {
          console.error("Messages load error:", messagesError);
          setError("Could not load messages.");
          return;
        }

        setMessages((data ?? []) as Message[]);
      } catch (err) {
        if (requestNumber !== messageRequest.current) return;
        console.error("Messages request failed:", err);
        setError("Could not load messages.");
      } finally {
        if (requestNumber === messageRequest.current) {
          setMessagesLoading(false);
        }
      }
    },
    [router]
  );

  useEffect(() => {
    let active = true;

    async function loadConversations() {
      setLoading(true);
      setError("");

      try {
        const {
          data: { user },
          error: userError,
        } = await supabase.auth.getUser();

        if (!active) return;

        if (userError || !user) {
          router.replace("/login");
          return;
        }

        const { data, error: conversationsError } = await supabase
          .from("conversations")
          .select(`
            id,
            customer_name,
            customer_email,
            visitor_id,
            created_at
          `)
          .eq("user_id", user.id)
          .order("created_at", { ascending: false });

        if (!active) return;

        if (conversationsError) {
          console.error("Conversations load error:", conversationsError);
          setError("Could not load conversations.");
          return;
        }

        const loaded = (data ?? []) as Conversation[];
        setConversations(loaded);

        if (loaded.length > 0) {
          setSelectedConversation(loaded[0]);
          await loadMessages(loaded[0].id);
        } else {
          setSelectedConversation(null);
          setMessages([]);
        }
      } catch (err) {
        if (!active) return;
        console.error("Conversations request failed:", err);
        setError("Could not load conversations.");
      } finally {
        if (active) setLoading(false);
      }
    }

    void loadConversations();

    return () => {
      active = false;
      messageRequest.current += 1;
    };
  }, [loadMessages, router]);

  function handleConversationClick(conversation: Conversation) {
    if (selectedConversation?.id === conversation.id) return;

    setSelectedConversation(conversation);
    void loadMessages(conversation.id);
  }

  const query = search.trim().toLowerCase();

  const filteredConversations = conversations.filter((conversation) =>
    [
      conversation.customer_name,
      conversation.customer_email,
      conversation.visitor_id,
    ].some((value) => (value ?? "").toLowerCase().includes(query))
  );

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-950 text-white">
        <div className="text-center">
          <div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-4 border-slate-700 border-t-blue-500" />
          <p className="text-sm text-slate-400">
            Loading conversations...
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-white">
      <header className="border-b border-slate-200 bg-white px-5 py-6 dark:border-slate-800 dark:bg-slate-950 lg:px-10">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4">
          <div>
            <p className="mb-2 text-xs font-bold uppercase tracking-widest text-blue-600 dark:text-blue-400">
              AgentDesk AI Premium
            </p>
            <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
              Conversations
            </h1>
            <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
              View conversations between customers and your AI agent.
            </p>
          </div>

          <button
            type="button"
            onClick={() => router.push("/dashboard")}
            className="rounded-xl border border-slate-200 bg-white px-5 py-3 text-sm font-semibold transition hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:hover:bg-slate-800"
          >
            ← Dashboard
          </button>
        </div>
      </header>

      <div className="mx-auto max-w-7xl p-4 sm:p-6 lg:p-8">
        {error && (
          <div
            role="alert"
            className="mb-5 rounded-xl border border-red-300 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300"
          >
            {error}
          </div>
        )}

        <div className="grid min-h-[650px] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900 lg:grid-cols-[350px_minmax(0,1fr)]">
          <aside className="border-b border-slate-200 dark:border-slate-800 lg:border-b-0 lg:border-r">
            <div className="border-b border-slate-200 p-5 dark:border-slate-800">
              <div className="flex items-center justify-between gap-3">
                <h2 className="font-bold">All Conversations</h2>
                <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-bold text-blue-600 dark:bg-blue-500/10 dark:text-blue-400">
                  {conversations.length}
                </span>
              </div>

              <label
                htmlFor="conversation-search"
                className="sr-only"
              >
                Search conversations
              </label>

              <input
                id="conversation-search"
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search conversations..."
                className="mt-4 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition placeholder:text-slate-400 focus:border-blue-500 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
              />

              <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
                Showing {filteredConversations.length} of{" "}
                {conversations.length}
              </p>
            </div>

            <div className="max-h-[340px] overflow-y-auto lg:max-h-[680px]">
              {filteredConversations.length === 0 ? (
                <div className="px-6 py-14 text-center">
                  <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-blue-50 text-2xl dark:bg-blue-500/10">
                    💬
                  </div>

                  <p className="mt-4 font-semibold">
                    {conversations.length === 0
                      ? "No conversations yet"
                      : "No matching conversations"}
                  </p>

                  <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
                    {conversations.length === 0
                      ? "Customer conversations will appear here."
                      : "Try a different search term."}
                  </p>
                </div>
              ) : (
                filteredConversations.map((conversation) => {
                  const selected =
                    selectedConversation?.id === conversation.id;

                  const customerName =
                    conversation.customer_name || "Website Visitor";

                  return (
                    <button
                      key={conversation.id}
                      type="button"
                      onClick={() => handleConversationClick(conversation)}
                      aria-pressed={selected}
                      className={`w-full border-b border-slate-100 p-5 text-left transition dark:border-slate-800 ${
                        selected
                          ? "bg-blue-50 dark:bg-blue-500/10"
                          : "hover:bg-slate-50 dark:hover:bg-slate-800"
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-blue-600 font-bold text-white">
                          {customerName.charAt(0).toUpperCase()}
                        </div>

                        <div className="min-w-0 flex-1">
                          <p className="truncate font-semibold">
                            {customerName}
                          </p>

                          <p className="mt-1 truncate text-xs text-slate-500 dark:text-slate-400">
                            {conversation.customer_email ||
                              "Website customer"}
                          </p>

                          <p className="mt-3 text-xs text-slate-400">
                            {formatDate(conversation.created_at)}
                          </p>
                        </div>

                        {selected && (
                          <span
                            aria-hidden="true"
                            className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-blue-500"
                          />
                        )}
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </aside>

          <section className="flex min-h-[520px] min-w-0 flex-col bg-slate-50/70 dark:bg-slate-950/60">
            {!selectedConversation ? (
              <div className="flex flex-1 items-center justify-center p-8 text-center">
                <div>
                  <div className="mx-auto grid h-20 w-20 place-items-center rounded-3xl bg-white text-3xl shadow-sm dark:bg-slate-800">
                    💬
                  </div>

                  <h2 className="mt-5 text-xl font-bold">
                    Select a conversation
                  </h2>

                  <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
                    Choose a conversation to view its messages.
                  </p>
                </div>
              </div>
            ) : (
              <>
                <div className="border-b border-slate-200 bg-white px-5 py-5 dark:border-slate-800 dark:bg-slate-900 sm:px-7">
                  <div className="flex items-center gap-3">
                    <div className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-blue-600 font-bold text-white">
                      {(selectedConversation.customer_name ||
                        "Website Visitor")
                        .charAt(0)
                        .toUpperCase()}
                    </div>

                    <div className="min-w-0">
                      <h2 className="truncate font-bold">
                        {selectedConversation.customer_name ||
                          "Website Visitor"}
                      </h2>

                      <p className="mt-1 text-xs text-emerald-600 dark:text-emerald-400">
                        ● Customer Conversation
                      </p>
                    </div>
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto p-4 sm:p-6">
                  {messagesLoading ? (
                    <div
                      role="status"
                      className="flex items-center justify-center gap-3 py-16 text-sm text-slate-500 dark:text-slate-400"
                    >
                      <div className="h-5 w-5 animate-spin rounded-full border-2 border-slate-300 border-t-blue-500" />
                      Loading messages...
                    </div>
                  ) : messages.length === 0 ? (
                    <div className="py-16 text-center text-sm text-slate-500 dark:text-slate-400">
                      No messages found.
                    </div>
                  ) : (
                    <div className="mx-auto max-w-4xl space-y-5">
                      {messages.map((message) => {
                        const isAI = message.role === "assistant";

                        return (
                          <div
                            key={message.id}
                            className={`flex ${
                              isAI
                                ? "justify-start"
                                : "justify-end"
                            }`}
                          >
                            <div
                              className={`max-w-[90%] rounded-2xl px-5 py-4 shadow-sm sm:max-w-[80%] ${
                                isAI
                                  ? "rounded-bl-md border border-slate-200 bg-white text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                                  : "rounded-br-md bg-blue-600 text-white"
                              }`}
                            >
                              <p className="mb-2 text-xs font-bold opacity-70">
                                {isAI ? "AI Assistant" : "Customer"}
                              </p>

                              <p className="whitespace-pre-wrap break-words text-sm leading-7">
                                {message.content}
                              </p>

                              <p className="mt-3 text-[11px] opacity-60">
                                {formatDate(message.created_at)}
                              </p>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                <div className="border-t border-slate-200 bg-white px-5 py-4 dark:border-slate-800 dark:bg-slate-900">
                  <p className="text-center text-xs text-slate-500 dark:text-slate-400">
                    This conversation was handled by AgentDesk AI.
                  </p>
                </div>
              </>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}
