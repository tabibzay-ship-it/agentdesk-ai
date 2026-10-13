"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../../lib/supabase";
import { AuthPreferences, useAuthLocale } from "@/components/auth-preferences";

export default function WidgetPage() {
  const router = useRouter();
  const { locale, setLocale, rtl } = useAuthLocale();

  const [agentName, setAgentName] = useState("AI Support Assistant");
  const [welcomeMessage, setWelcomeMessage] = useState(
    "Hi! 👋 How can I help you today?"
  );
  const [primaryColor, setPrimaryColor] = useState("#2563eb");
  const [position, setPosition] = useState("right");
  const [size, setSize] = useState("standard");
  const [widgetTheme, setWidgetTheme] = useState("system");
  const [publicAgentId, setPublicAgentId] = useState("");

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    async function loadSettings() {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError || !user) {
        router.replace("/login");
        return;
      }

      const { data, error: settingsError } = await supabase
        .from("widget_settings")
        .select("*")
        .eq("user_id", user.id)
        .maybeSingle();

      if (
        settingsError &&
        settingsError.code !== "PGRST116"
      ) {
        setError("Could not load widget settings. Please try again.");
      }

      if (data) {
        setAgentName(data.agent_name ?? "AI Support Assistant");

        setWelcomeMessage(
          data.welcome_message ??
            "Hi! 👋 How can I help you today?"
        );

        setPrimaryColor(typeof data.primary_color === "string" && /^#[0-9a-f]{6}$/i.test(data.primary_color) ? data.primary_color : "#2563eb");
        setPosition(["left","right"].includes(data.position) ? data.position : "right");
        setSize(["compact","standard","large"].includes(data.size) ? data.size : "standard");
        setWidgetTheme(["light","dark","system"].includes(data.theme) ? data.theme : "system");
      }

      const { data: agent } = await supabase.from("agent_settings").select("public_agent_id").eq("user_id", user.id).maybeSingle();
      setPublicAgentId(agent?.public_agent_id ?? "");

      setLoading(false);
    }

    loadSettings();
  }, [router]);

  async function handleSubmit(
    e: FormEvent<HTMLFormElement>
  ) {
    e.preventDefault();

    setSaving(true);
    setMessage("");
    setError("");

    if (!agentName.trim() || agentName.trim().length > 100 || !welcomeMessage.trim() ||
        welcomeMessage.trim().length > 1000 || !/^#[0-9a-f]{6}$/i.test(primaryColor)) {
      setError("Use an agent name up to 100 characters, a welcome message up to 1,000 characters, and a six-digit hex color such as #2563eb.");
      setSaving(false);
      return;
    }

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      setSaving(false);
      router.replace("/login");
      return;
    }

    const settings = {
      user_id: user.id,
      agent_name: agentName.trim(),
      welcome_message: welcomeMessage.trim(),
      primary_color: primaryColor,
      position,
      size,
      theme: widgetTheme,
      locale,
    };

    const { data: existing, error: checkError } =
      await supabase
        .from("widget_settings")
        .select("id")
        .eq("user_id", user.id)
        .maybeSingle();

    if (checkError) {
      setError("Could not load widget settings. Please try again.");
      setSaving(false);
      return;
    }

    let saveError = null;

    if (existing) {
      const result = await supabase
        .from("widget_settings")
        .update(settings)
        .eq("user_id", user.id);

      saveError = result.error;
    } else {
      const result = await supabase
        .from("widget_settings")
        .insert(settings);

      saveError = result.error;
    }

    if (saveError) {
      setError("Could not save widget settings. Please try again.");
      setSaving(false);
      return;
    }

    setMessage("Widget settings saved successfully!");
    setSaving(false);
  }

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-950 text-white">
        <p className="text-slate-400">
          Loading widget settings...
        </p>
      </main>
    );
  }

  return (
    <main dir={rtl ? "rtl" : "ltr"} className="min-h-screen bg-[var(--premium-bg)] text-[var(--premium-text)]">
      <div className="mx-auto max-w-7xl px-6 py-10">

        <button
          type="button"
          onClick={() => router.push("/dashboard")}
          className="mb-8 text-sm font-medium text-blue-400 hover:text-blue-300"
        >
          ← Back to Dashboard
        </button>

        <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
          <div>
          <h1 className="text-3xl font-bold">
            Customize Chat Widget
          </h1>

          <p className="mt-2 text-slate-400">
            Customize how your AI support assistant
            looks to your customers.
          </p>
          </div>
          <AuthPreferences locale={locale} onLocaleChange={setLocale} />
        </div>

        <div className="grid gap-8 lg:grid-cols-2">

          {/* Settings */}
          <div className="rounded-2xl border border-[var(--premium-border)] bg-[var(--premium-surface)] p-6 md:p-8">

            <h2 className="text-xl font-semibold">
              Widget Settings
            </h2>

            <p className="mt-2 text-sm text-slate-400">
              Change your AI agent name, welcome message
              and primary color.
            </p>

            {error && (
              <div className="mt-6 rounded-xl border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-400">
                {error}
              </div>
            )}

            {message && (
              <div className="mt-6 rounded-xl border border-green-500/40 bg-green-500/10 p-4 text-sm text-green-400">
                {message}
              </div>
            )}

            <form
              onSubmit={handleSubmit}
              className="mt-8 space-y-6"
            >

              {/* Agent name */}
              <div>
                <label className="mb-2 block text-sm font-medium">
                  Agent Name
                </label>

                <input
                  type="text"
                  required
                  maxLength={100}
                  value={agentName}
                  onChange={(e) =>
                    setAgentName(e.target.value)
                  }
                  placeholder="AI Support Assistant"
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 outline-none transition focus:border-blue-500"
                />
              </div>

              {/* Welcome message */}
              <div>
                <label className="mb-2 block text-sm font-medium">
                  Welcome Message
                </label>

                <textarea
                  required
                  maxLength={1000}
                  value={welcomeMessage}
                  onChange={(e) =>
                    setWelcomeMessage(e.target.value)
                  }
                  rows={4}
                  placeholder="Hi! How can I help you today?"
                  className="w-full resize-none rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 outline-none transition focus:border-blue-500"
                />
              </div>

              {/* Color */}
              <div>
                <label className="mb-2 block text-sm font-medium">
                  Primary Color
                </label>

                <div className="flex items-center gap-4">

                  <input
                    type="color"
                    value={primaryColor}
                    onChange={(e) =>
                      setPrimaryColor(e.target.value)
                    }
                    className="h-12 w-16 cursor-pointer rounded-lg border border-slate-700 bg-slate-950 p-1"
                  />

                  <input
                    type="text"
                    value={primaryColor}
                    onChange={(e) =>
                      setPrimaryColor(e.target.value)
                    }
                    className="flex-1 rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 uppercase outline-none focus:border-blue-500"
                  />

                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-3">
                <label className="text-sm font-medium">Position<select value={position} onChange={e=>setPosition(e.target.value)} className="mt-2 min-h-11 w-full rounded-xl border border-[var(--premium-border)] bg-[var(--premium-surface)] px-3"><option value="right">Right</option><option value="left">Left</option></select></label>
                <label className="text-sm font-medium">Size<select value={size} onChange={e=>setSize(e.target.value)} className="mt-2 min-h-11 w-full rounded-xl border border-[var(--premium-border)] bg-[var(--premium-surface)] px-3"><option value="compact">Compact</option><option value="standard">Standard</option><option value="large">Large</option></select></label>
                <label className="text-sm font-medium">Widget theme<select value={widgetTheme} onChange={e=>setWidgetTheme(e.target.value)} className="mt-2 min-h-11 w-full rounded-xl border border-[var(--premium-border)] bg-[var(--premium-surface)] px-3"><option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option></select></label>
              </div>

              {publicAgentId && <div className="rounded-xl border border-[var(--premium-border)] p-4"><p className="text-sm font-semibold">Installation script</p><code className="mt-2 block overflow-x-auto whitespace-nowrap rounded-lg bg-slate-950 p-3 text-xs text-slate-100">{`<script src="${typeof window!=="undefined"?window.location.origin:""}/widget.js" data-agent-id="${publicAgentId}" async></script>`}</code><button type="button" onClick={()=>void navigator.clipboard.writeText(`<script src="${window.location.origin}/widget.js" data-agent-id="${publicAgentId}" async></script>`)} className="mt-3 min-h-11 rounded-xl border px-4 text-sm font-bold">Copy script</button><button type="button" onClick={()=>router.push("/agent")} className="ms-2 min-h-11 rounded-xl border px-4 text-sm font-bold">Domain allowlist</button></div>}

              <button
                type="submit"
                disabled={saving}
                className="w-full rounded-xl bg-blue-600 px-5 py-3 font-semibold transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {saving
                  ? "Saving..."
                  : "Save Widget Settings"}
              </button>

            </form>
          </div>

          {/* Live Preview */}
          <div className="rounded-2xl border border-[var(--premium-border)] bg-[var(--premium-surface)] p-6 md:p-8">

            <div className="mb-6">
              <h2 className="text-xl font-semibold">
                Live Preview
              </h2>

              <p className="mt-2 text-sm text-slate-400">
                Preview how your chat widget will look.
              </p>
            </div>

            <div className="flex min-h-[480px] items-end justify-end rounded-2xl border border-slate-800 bg-slate-950 p-6">

              <div className="w-full max-w-sm overflow-hidden rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl">

                {/* Widget header */}
                <div
                  className="p-5"
                  style={{
                    backgroundColor: primaryColor,
                  }}
                >
                  <div className="flex items-center gap-3">

                    <div className="flex h-11 w-11 items-center justify-center rounded-full bg-white/20 font-bold text-white">
                      AI
                    </div>

                    <div>
                      <p className="font-semibold text-white">
                        {agentName || "AI Support Assistant"}
                      </p>

                      <p className="text-xs text-white/80">
                        ● Online
                      </p>
                    </div>

                  </div>
                </div>

                {/* Messages */}
                <div className="p-5">

                  <div className="max-w-[85%] rounded-2xl bg-slate-800 p-4 text-sm leading-6">
                    {welcomeMessage ||
                      "Hi! 👋 How can I help you today?"}
                  </div>

                  <div className="mt-8 flex gap-2">

                    <input
                      disabled
                      placeholder="Type your message..."
                      className="min-w-0 flex-1 rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm outline-none"
                    />

                    <button
                      type="button"
                      disabled
                      style={{
                        backgroundColor: primaryColor,
                      }}
                      className="rounded-xl px-4 font-semibold text-white"
                    >
                      Send
                    </button>

                  </div>
                </div>

              </div>
            </div>

          </div>
        </div>
      </div>
    </main>
  );
}
