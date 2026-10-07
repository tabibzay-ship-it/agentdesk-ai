"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { isBoundedText } from "@/lib/client-security";

function normalizeAllowedDomains(value: string) {
  const entries = value
    .split(/[\n,]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
  const domains = new Set<string>();

  if (entries.length > 100 || value.length > 30000) {
    return { domains: [] as string[], error: "Use no more than 100 allowed domains." };
  }

  for (const entry of entries) {
    try {
      const hasProtocol =
        /^[a-z][a-z\d+.-]*:\/\//i.test(entry);
      const url = new URL(
        hasProtocol ? entry : `https://${entry}`
      );

      if (
        (url.protocol !== "http:" &&
          url.protocol !== "https:") ||
        url.username ||
        url.password
      ) {
        throw new Error("Invalid domain");
      }

      const hostname = url.hostname
        .toLowerCase()
        .replace(/\.+$/, "");

      if (!hostname || hostname.length > 253 || hostname.includes("*")) {
        throw new Error("Invalid domain");
      }

      domains.add(hostname);
    } catch {
      return {
        domains: [] as string[],
        error: `Invalid allowed domain: ${entry}`,
      };
    }
  }

  return {
    domains: Array.from(domains),
    error: "",
  };
}

export default function AgentPage() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  const [isActive, setIsActive] = useState(true);
  const [tone, setTone] = useState("professional");
  const [customInstructions, setCustomInstructions] = useState("");
  const [allowedDomainsText, setAllowedDomainsText] = useState("");

  useEffect(() => {
    async function loadAgentSettings() {
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      router.replace("/login");
      return;
    }

    const { data, error } = await supabase
      .from("agent_settings")
      .select(
        "is_active, tone, custom_instructions, allowed_domains"
      )
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
      setAllowedDomainsText(
        Array.isArray(data.allowed_domains)
          ? data.allowed_domains.join("\n")
          : ""
      );
    }

      setLoading(false);
    }

    void loadAgentSettings();
  }, [router]);

  async function saveSettings() {
    if (saving) return;
    setSaving(true);
    setMessage("");

    if (!isBoundedText(customInstructions.trim(), 2000) ||
        !["professional", "friendly", "concise"].includes(tone)) {
      setMessage("Use a supported response tone and instructions up to 2000 characters.");
      setSaving(false);
      return;
    }

    const normalizedDomains =
      normalizeAllowedDomains(allowedDomainsText);

    if (normalizedDomains.error) {
      setMessage(normalizedDomains.error);
      setSaving(false);
      return;
    }

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      setSaving(false);
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
          allowed_domains: normalizedDomains.domains,
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

          {/* Domain Allowlist */}
          <section
            id="domain-security"
            className="scroll-mt-8 rounded-2xl border border-slate-800 bg-slate-900 p-6"
          >
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h2 className="text-lg font-semibold">
                  Domain Allowlist / Widget Security
                </h2>

                <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-400">
                  Choose the exact website hostnames allowed to load and use
                  this agent. Add subdomains such as www separately.
                </p>
              </div>

              <span
                className={`inline-flex w-fit rounded-full px-3 py-1 text-xs font-semibold ${
                  allowedDomainsText.trim()
                    ? "bg-emerald-500/10 text-emerald-400"
                    : "bg-amber-500/10 text-amber-300"
                }`}
              >
                {allowedDomainsText.trim()
                  ? "Restricted"
                  : "Public rollout mode"}
              </span>
            </div>

            <label
              htmlFor="allowed-domains"
              className="mt-5 block text-sm font-medium text-slate-200"
            >
              Allowed domains
            </label>

            <textarea
              id="allowed-domains"
              value={allowedDomainsText}
              onChange={(event) =>
                setAllowedDomainsText(event.target.value)
              }
              rows={5}
              maxLength={30000}
              spellCheck={false}
              placeholder={"example.com\nwww.example.com\nshop.example.com"}
              className="mt-2 w-full resize-y rounded-xl border border-slate-700 bg-slate-950 px-4 py-4 font-mono text-sm text-white outline-none focus:border-blue-500"
            />

            <div className="mt-4 grid gap-3 text-sm text-slate-400 sm:grid-cols-2">
              <p className="rounded-xl bg-slate-950 p-3">
                You may paste bare domains or full URLs. Protocols, paths,
                ports and trailing dots are normalized when you save.
              </p>

              <p className="rounded-xl bg-slate-950 p-3">
                Leaving this empty preserves public access during rollout.
                Add at least one domain to enable enforcement.
              </p>
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
