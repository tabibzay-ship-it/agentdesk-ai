"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

export default function AgentPage() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  const [isActive, setIsActive] = useState(true);
  const [tone, setTone] = useState("professional");
  const [customInstructions, setCustomInstructions] = useState("");

  useEffect(() => {
    loadAgentSettings();
  }, []);

  async function loadAgentSettings() {
    setLoading(true);

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      router.push("/login");
      return;
    }

    const { data, error } = await supabase
      .from("agent_settings")
      .select("is_active, tone, custom_instructions")
      .eq("user_id", user.id)
      .maybeSingle();

    if (error) {
      console.error("Load agent settings error:", error);
      setMessage("Could not load AI Agent settings.");
      setLoading(false);
      return;
    }

    if (data) {
      setIsActive(data.is_active ?? true);
      setTone(data.tone || "professional");
      setCustomInstructions(data.custom_instructions || "");
    }

    setLoading(false);
  }

  async function saveSettings() {
    setSaving(true);
    setMessage("");

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      router.push("/login");
      return;
    }

    const { error } = await supabase
      .from("agent_settings")
      .upsert(
        {
          user_id: user.id,
          is_active: isActive,
          tone,
          custom_instructions: customInstructions.trim(),
          updated_at: new Date().toISOString(),
        },
        {
          onConflict: "user_id",
        }
      );

    if (error) {
      console.error("Save agent settings error:", error);
      setMessage("Could not save settings.");
      setSaving(false);
      return;
    }

    setMessage("AI Agent settings saved successfully.");
    setSaving(false);
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-slate-950 flex items-center justify-center text-white">
        <p className="text-slate-400">Loading AI Agent...</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <div className="max-w-5xl mx-auto px-6 py-10">
        <div className="flex items-center justify-between mb-10">
          <div>
            <p className="text-blue-400 font-semibold mb-2">
              AgentDesk AI
            </p>

            <h1 className="text-3xl font-bold">
              AI Agent
            </h1>

            <p className="text-slate-400 mt-2">
              Control how your AI customer support agent behaves.
            </p>
          </div>

          <button
            onClick={() => router.push("/dashboard")}
            className="px-5 py-2.5 rounded-xl border border-slate-700 bg-slate-900 hover:bg-slate-800 transition"
          >
            Back to Dashboard
          </button>
        </div>

        <div className="space-y-6">
          {/* Agent Status */}
          <section className="rounded-2xl border border-slate-800 bg-slate-900 p-6">
            <div className="flex items-center justify-between gap-5">
              <div>
                <h2 className="text-lg font-semibold">
                  Agent Status
                </h2>

                <p className="text-sm text-slate-400 mt-1">
                  Turn your AI customer support agent on or off.
                </p>
              </div>

              <button
                type="button"
                onClick={() => setIsActive(!isActive)}
                className={`relative w-14 h-8 rounded-full transition ${
                  isActive
                    ? "bg-blue-600"
                    : "bg-slate-700"
                }`}
              >
                <span
                  className={`absolute top-1 w-6 h-6 rounded-full bg-white transition-all ${
                    isActive
                      ? "left-7"
                      : "left-1"
                  }`}
                />
              </button>
            </div>

            <div className="mt-4">
              <span
                className={`inline-flex px-3 py-1 rounded-full text-sm font-medium ${
                  isActive
                    ? "bg-emerald-500/10 text-emerald-400"
                    : "bg-red-500/10 text-red-400"
                }`}
              >
                {isActive ? "Online" : "Offline"}
              </span>
            </div>
          </section>

          {/* Tone */}
          <section className="rounded-2xl border border-slate-800 bg-slate-900 p-6">
            <h2 className="text-lg font-semibold">
              Response Tone
            </h2>

            <p className="text-sm text-slate-400 mt-1 mb-5">
              Choose how the AI should communicate with customers.
            </p>

            <div className="grid md:grid-cols-3 gap-4">
              {[
                {
                  value: "professional",
                  title: "Professional",
                  description:
                    "Clear, respectful and business-focused.",
                },
                {
                  value: "friendly",
                  title: "Friendly",
                  description:
                    "Warm, helpful and conversational.",
                },
                {
                  value: "concise",
                  title: "Concise",
                  description:
                    "Short and direct customer support answers.",
                },
              ].map((item) => (
                <button
                  key={item.value}
                  type="button"
                  onClick={() => setTone(item.value)}
                  className={`text-left rounded-xl border p-5 transition ${
                    tone === item.value
                      ? "border-blue-500 bg-blue-500/10"
                      : "border-slate-700 bg-slate-950 hover:border-slate-600"
                  }`}
                >
                  <h3 className="font-semibold">
                    {item.title}
                  </h3>

                  <p className="text-sm text-slate-400 mt-2">
                    {item.description}
                  </p>
                </button>
              ))}
            </div>
          </section>

          {/* Custom Instructions */}
          <section className="rounded-2xl border border-slate-800 bg-slate-900 p-6">
            <h2 className="text-lg font-semibold">
              Custom Instructions
            </h2>

            <p className="text-sm text-slate-400 mt-1 mb-4">
              Add special instructions for how your AI Agent should
              respond to customers.
            </p>

            <textarea
              value={customInstructions}
              onChange={(e) =>
                setCustomInstructions(e.target.value)
              }
              maxLength={2000}
              rows={8}
              placeholder="Example: Always greet customers politely. Keep answers short. If you do not know an answer, ask the customer to contact our support team."
              className="w-full resize-none rounded-xl border border-slate-700 bg-slate-950 px-4 py-4 text-white outline-none focus:border-blue-500"
            />

            <div className="flex justify-end mt-2">
              <span className="text-xs text-slate-500">
                {customInstructions.length}/2000
              </span>
            </div>
          </section>

          {/* Save */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              {message && (
                <p
                  className={`text-sm ${
                    message.includes("successfully")
                      ? "text-emerald-400"
                      : "text-red-400"
                  }`}
                >
                  {message}
                </p>
              )}
            </div>

            <button
              onClick={saveSettings}
              disabled={saving}
              className="px-6 py-3 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-50 font-semibold transition"
            >
              {saving ? "Saving..." : "Save AI Agent"}
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}