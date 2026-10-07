"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../../lib/supabase";

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

export default function ConversationsPage() {
  const router = useRouter();

  const [conversations, setConversations] =
    useState<Conversation[]>([]);

  const [selectedConversation, setSelectedConversation] =
    useState<Conversation | null>(null);

  const [messages, setMessages] =
    useState<Message[]>([]);

  const [loading, setLoading] =
    useState(true);

  const [messagesLoading, setMessagesLoading] =
    useState(false);

  const [error, setError] =
    useState("");

  const loadMessages = useCallback(async (
    conversationId: string
  ) => {
    setMessagesLoading(true);
    setError("");

    const {
      data,
      error: messagesError,
    } = await supabase
      .from("messages")
      .select(
        `
        id,
        role,
        content,
        created_at
        `
      )
      .eq(
        "conversation_id",
        conversationId
      )
      .order("created_at", {
        ascending: true,
      });

    if (messagesError) {
      console.error(
        "Messages load error:",
        messagesError
      );

      setError(
        "Could not load messages."
      );

      setMessages([]);
      setMessagesLoading(false);
      return;
    }

    setMessages(
      (data ?? []) as Message[]
    );

    setMessagesLoading(false);
  }, []);

  // =========================================
  // Load Conversations
  // =========================================

  useEffect(() => {
    async function loadConversations() {
      setLoading(true);
      setError("");

      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError || !user) {
        router.replace("/login");
        return;
      }

      const {
        data,
        error: conversationsError,
      } = await supabase
        .from("conversations")
        .select(
          `
          id,
          customer_name,
          customer_email,
          visitor_id,
          created_at
          `
        )
        .eq("user_id", user.id)
        .order("created_at", {
          ascending: false,
        });

      if (conversationsError) {
        console.error(
          "Conversations load error:",
          conversationsError
        );

        setError(
          "Could not load conversations."
        );

        setLoading(false);
        return;
      }

      const loadedConversations =
        (data ?? []) as Conversation[];

      setConversations(
        loadedConversations
      );

      // Automatically open first conversation
      if (
        loadedConversations.length > 0
      ) {
        setSelectedConversation(
          loadedConversations[0]
        );

        await loadMessages(
          loadedConversations[0].id
        );
      }

      setLoading(false);
    }

    loadConversations();
  }, [loadMessages, router]);

  // =========================================
  // Select Conversation
  // =========================================

  async function handleConversationClick(
    conversation: Conversation
  ) {
    setSelectedConversation(
      conversation
    );

    await loadMessages(
      conversation.id
    );
  }

  // =========================================
  // Format Date
  // =========================================

  function formatDate(
    date: string
  ) {
    return new Date(
      date
    ).toLocaleString();
  }

  // =========================================
  // Loading Screen
  // =========================================

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-950 text-white">
        <p className="text-slate-400">
          Loading conversations...
        </p>
      </main>
    );
  }

  // =========================================
  // Page
  // =========================================

  return (
    <main className="min-h-screen bg-slate-950 text-white">

      {/* =====================================
          HEADER
      ====================================== */}

      <header className="flex items-center justify-between border-b border-slate-800 bg-slate-950 px-6 py-5 lg:px-10">

        <div>
          <h1 className="text-2xl font-bold">
            Conversations
          </h1>

          <p className="mt-1 text-sm text-slate-400">
            View conversations between
            customers and your AI agent.
          </p>
        </div>

        <button
          type="button"
          onClick={() =>
            router.push("/dashboard")
          }
          className="rounded-xl border border-slate-700 px-4 py-2 text-sm transition hover:bg-slate-800"
        >
          ← Dashboard
        </button>

      </header>

      {/* =====================================
          ERROR
      ====================================== */}

      {error && (
        <div className="mx-6 mt-6 rounded-xl border border-red-900 bg-red-950/40 p-4 text-sm text-red-300 lg:mx-10">
          {error}
        </div>
      )}

      {/* =====================================
          MAIN
      ====================================== */}

      <div className="grid min-h-[calc(100vh-90px)] lg:grid-cols-[350px_1fr]">

        {/* =====================================
            CONVERSATIONS LIST
        ====================================== */}

        <aside className="border-r border-slate-800 bg-slate-900">

          <div className="border-b border-slate-800 p-5">

            <p className="text-sm font-medium text-slate-300">
              All Conversations
            </p>

            <p className="mt-1 text-xs text-slate-500">
              {conversations.length} total
            </p>

          </div>

          <div className="max-h-[calc(100vh-170px)] overflow-y-auto">

            {conversations.length === 0 ? (

              <div className="p-6 text-center">

                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-slate-800 text-xl">
                  💬
                </div>

                <p className="mt-4 font-medium">
                  No conversations yet
                </p>

                <p className="mt-2 text-sm text-slate-500">
                  Customer conversations
                  will appear here.
                </p>

              </div>

            ) : (

              conversations.map(
                (conversation) => {

                  const selected =
                    selectedConversation?.id ===
                    conversation.id;

                  return (
                    <button
                      key={
                        conversation.id
                      }
                      type="button"
                      onClick={() =>
                        handleConversationClick(
                          conversation
                        )
                      }
                      className={`w-full border-b border-slate-800 p-5 text-left transition ${
                        selected
                          ? "bg-blue-600/15"
                          : "hover:bg-slate-800"
                      }`}
                    >

                      <div className="flex items-center gap-3">

                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blue-600 font-semibold">
                          {conversation
                            .customer_name
                            ?.charAt(0)
                            .toUpperCase() ||
                            "V"}
                        </div>

                        <div className="min-w-0">

                          <p className="truncate font-medium">
                            {conversation.customer_name ||
                              "Website Visitor"}
                          </p>

                          <p className="mt-1 truncate text-xs text-slate-500">
                            {conversation.customer_email ||
                              "Website customer"}
                          </p>

                        </div>

                      </div>

                      <p className="mt-3 text-xs text-slate-500">
                        {formatDate(
                          conversation.created_at
                        )}
                      </p>

                    </button>
                  );
                }
              )

            )}

          </div>

        </aside>

        {/* =====================================
            CHAT AREA
        ====================================== */}

        <section className="flex min-h-[600px] flex-col bg-slate-950">

          {!selectedConversation ? (

            <div className="flex flex-1 items-center justify-center p-8 text-center">

              <div>

                <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-slate-900 text-2xl">
                  💬
                </div>

                <h2 className="mt-5 text-xl font-semibold">
                  Select a conversation
                </h2>

                <p className="mt-2 text-sm text-slate-500">
                  Choose a conversation
                  to view its messages.
                </p>

              </div>

            </div>

          ) : (

            <>

              {/* Chat Header */}

              <div className="border-b border-slate-800 bg-slate-900/50 px-6 py-5">

                <div className="flex items-center gap-3">

                  <div className="flex h-11 w-11 items-center justify-center rounded-full bg-blue-600 font-bold">
                    {selectedConversation
                      .customer_name
                      ?.charAt(0)
                      .toUpperCase() ||
                      "V"}
                  </div>

                  <div>

                    <h2 className="font-semibold">
                      {selectedConversation.customer_name ||
                        "Website Visitor"}
                    </h2>

                    <p className="mt-1 text-xs text-green-400">
                      ● Customer Conversation
                    </p>

                  </div>

                </div>

              </div>

              {/* Messages */}

              <div className="flex-1 overflow-y-auto p-6 lg:p-8">

                {messagesLoading ? (

                  <p className="text-center text-sm text-slate-500">
                    Loading messages...
                  </p>

                ) : messages.length === 0 ? (

                  <p className="text-center text-sm text-slate-500">
                    No messages found.
                  </p>

                ) : (

                  <div className="mx-auto max-w-4xl space-y-5">

                    {messages.map(
                      (message) => {

                        const isAI =
                          message.role ===
                          "assistant";

                        return (
                          <div
                            key={
                              message.id
                            }
                            className={`flex ${
                              isAI
                                ? "justify-start"
                                : "justify-end"
                            }`}
                          >

                            <div
                              className={`max-w-[80%] rounded-2xl px-5 py-4 ${
                                isAI
                                  ? "rounded-bl-md bg-slate-800 text-slate-100"
                                  : "rounded-br-md bg-blue-600 text-white"
                              }`}
                            >

                              <div className="mb-2 text-xs font-semibold opacity-70">
                                {isAI
                                  ? "AI Assistant"
                                  : "Customer"}
                              </div>

                              <p className="whitespace-pre-wrap text-sm leading-6">
                                {
                                  message.content
                                }
                              </p>

                              <p className="mt-3 text-[11px] opacity-50">
                                {formatDate(
                                  message.created_at
                                )}
                              </p>

                            </div>

                          </div>
                        );
                      }
                    )}

                  </div>

                )}

              </div>

              {/* Bottom Information */}

              <div className="border-t border-slate-800 bg-slate-900/40 px-6 py-4">

                <p className="text-center text-xs text-slate-500">
                  This conversation was handled
                  by AgentDesk AI.
                </p>

              </div>

            </>

          )}

        </section>

      </div>

    </main>
  );
}
