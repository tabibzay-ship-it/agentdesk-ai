
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { isBoundedText } from "@/lib/client-security";
import { AuthPreferences, useAuthLocale } from "@/components/auth-preferences";

type Tone = "professional" | "friendly" | "concise";

function normalizeAllowedDomains(value: string) {
  const entries = value
    .split(/[\n,]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);

  const domains = new Set<string>();

  if (entries.length > 100 || value.length > 30000) {
    return {
      domains: [] as string[],
      error: "Use no more than 100 allowed domains.",
    };
  }

  for (const entry of entries) {
    try {
      const hasProtocol = /^[a-z][a-z\d+.-]*:\/\//i.test(entry);
      const url = new URL(
        hasProtocol ? entry : `https://${entry}`
      );

      if (
        (url.protocol !== "http:" && url.protocol !== "https:") ||
        url.username ||
        url.password
      ) {
        throw new Error("Invalid domain");
      }

      const hostname = url.hostname
        .toLowerCase()
        .replace(/\.+$/, "");

      if (
        !hostname ||
        hostname.length > 253 ||
        hostname.includes("*")
      ) {
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

const toneOptions: {
  value: Tone;
  title: string;
  description: string;
}[] = [
  {
    value: "professional",
    title: "Professional",
    description: "Clear, respectful and business-focused.",
  },
  {
    value: "friendly",
    title: "Friendly",
    description: "Warm, helpful and conversational.",
  },
  {
    value: "concise",
    title: "Concise",
    description: "Short and direct customer support answers.",
  },
];

export default function AgentPage() {
  const router = useRouter();
  const { locale, setLocale, rtl } = useAuthLocale();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  const [isActive, setIsActive] = useState(true);
  const [tone, setTone] = useState("professional");
  const [customInstructions, setCustomInstructions] =
    useState("");
  const [allowedDomainsText, setAllowedDomainsText] =
    useState("");
  const [businessName, setBusinessName] = useState("");
  const [businessDescription, setBusinessDescription] = useState("");
  const [agentName, setAgentName] = useState("");
  const [welcomeMessage, setWelcomeMessage] = useState("");

  useEffect(() => {
    let active = true;

    async function loadAgentSettings() {
      try {
        const {
          data: { user },
          error: authError,
        } = await supabase.auth.getUser();

        if (!active) return;

        if (authError || !user) {
          router.replace("/login");
          return;
        }

        const [agentResult, businessResult, widgetResult] = await Promise.all([
          supabase.from("agent_settings").select("is_active, tone, custom_instructions, allowed_domains").eq("user_id", user.id).maybeSingle(),
          supabase.from("business_profiles").select("business_name, description").eq("user_id", user.id).maybeSingle(),
          supabase.from("widget_settings").select("agent_name, welcome_message").eq("user_id", user.id).maybeSingle(),
        ]);

        if (!active) return;

        if (agentResult.error || businessResult.error || widgetResult.error) {
          console.error("Load agent settings error.");
          setMessage("Could not load AI Agent settings.");
          return;
        }

        const data = agentResult.data;
        if (data) {
          setIsActive(data.is_active ?? true);
          setTone(data.tone || "professional");
          setCustomInstructions(
            data.custom_instructions || ""
          );
          setAllowedDomainsText(
            Array.isArray(data.allowed_domains)
              ? data.allowed_domains.join("\n")
              : ""
          );
        }
        if (businessResult.data) {
          setBusinessName(businessResult.data.business_name || "");
          setBusinessDescription(businessResult.data.description || "");
        }
        if (widgetResult.data) {
          setAgentName(widgetResult.data.agent_name || "");
          setWelcomeMessage(widgetResult.data.welcome_message || "");
        }
      } catch (error) {
        console.error("Load agent settings error:", error);

        if (active) {
          setMessage("Could not load AI Agent settings.");
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    void loadAgentSettings();

    return () => {
      active = false;
    };
  }, [router]);

  async function saveSettings() {
    if (saving) return;

    setSaving(true);
    setMessage("");

    try {
      if (
        !businessName.trim() ||
        !agentName.trim() ||
        !isBoundedText(customInstructions.trim(), 2000) ||
        !isBoundedText(businessName.trim(), 200) ||
        !isBoundedText(businessDescription.trim(), 5000) ||
        !isBoundedText(agentName.trim(), 200) ||
        !isBoundedText(welcomeMessage.trim(), 2000) ||
        !["professional", "friendly", "concise"].includes(tone)
      ) {
        setMessage(
          "Use a supported response tone and instructions up to 2000 characters."
        );
        return;
      }

      const normalizedDomains =
        normalizeAllowedDomains(allowedDomainsText);

      if (normalizedDomains.error) {
        setMessage(normalizedDomains.error);
        return;
      }

      const {
        data: { user },
        error: authError,
      } = await supabase.auth.getUser();

      if (authError || !user) {
        router.push("/login");
        return;
      }

      const [agentSave, businessSave, widgetSave] = await Promise.all([
        supabase.from("agent_settings").upsert(
          {
            user_id: user.id,
            is_active: isActive,
            tone,
            custom_instructions:
              customInstructions.trim(),
            allowed_domains: normalizedDomains.domains,
            updated_at: new Date().toISOString(),
          },
          {
            onConflict: "user_id",
          }
        ),
        supabase.from("business_profiles").upsert({ user_id: user.id, business_name: businessName.trim(), description: businessDescription.trim() }, { onConflict: "user_id" }),
        supabase.from("widget_settings").upsert({ user_id: user.id, agent_name: agentName.trim(), welcome_message: welcomeMessage.trim() }, { onConflict: "user_id" }),
      ]);

      if (agentSave.error || businessSave.error || widgetSave.error) {
        console.error("Save agent settings error.");
        setMessage("Could not save settings.");
        return;
      }

      setMessage("AI Agent settings saved successfully.");
    } catch (error) {
      console.error("Save agent settings error:", error);
      setMessage("Could not save settings.");
    } finally {
      setSaving(false);
    }
  }

  const cardClass =
    "rounded-2xl border border-[var(--premium-border)] bg-[var(--premium-surface)] p-6 shadow-sm";

  const mutedClass =
    "text-sm text-[var(--premium-text-muted)]";

  const inputClass =
    "w-full rounded-xl border border-[var(--premium-border)] bg-[var(--premium-surface-muted)] px-4 py-4 text-[var(--premium-text)] outline-none transition-colors placeholder:text-[var(--premium-text-muted)] focus:border-blue-500 focus:ring-2 focus:ring-blue-500/15";

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[var(--background)] text-[var(--foreground)]">
        <p role="status" className={mutedClass}>
          Loading AI Agent...
        </p>
      </main>
    );
  }

  return (
    <main dir={rtl ? "rtl" : "ltr"} className="min-h-screen bg-[var(--background)] text-[var(--foreground)]">
      <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6">

        {/* Header */}
        <header className="mb-10 flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="mb-2 font-semibold text-[var(--premium-primary)]">
              AgentDesk AI
            </p>

            <h1 className="text-3xl font-bold">
              AI Agent
            </h1>

            <p className={`mt-2 ${mutedClass}`}>
              Control how your AI customer support agent behaves.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3"><AuthPreferences locale={locale} onLocaleChange={setLocale} /><button
            type="button"
            onClick={() => router.push("/dashboard")}
            className="rounded-xl border border-[var(--premium-border)] bg-[var(--premium-surface)] px-5 py-2.5 font-semibold text-[var(--premium-text)] transition-colors hover:bg-[var(--premium-surface-muted)]"
          >
            Back to Dashboard
          </button></div>
        </header>

        <div className="space-y-6">

          <section className={cardClass}>
            <h2 className="text-lg font-semibold">Business and welcome experience</h2>
            <p className={`mb-5 mt-1 ${mutedClass}`}>These details give the agent identity and shape the first customer message.</p>
            <div className="grid gap-5 sm:grid-cols-2">
              <div><label htmlFor="business-name" className="mb-2 block text-sm font-medium">Business name</label><input id="business-name" value={businessName} onChange={(event)=>setBusinessName(event.target.value)} maxLength={200} required className={inputClass}/></div>
              <div><label htmlFor="agent-name" className="mb-2 block text-sm font-medium">Agent name</label><input id="agent-name" value={agentName} onChange={(event)=>setAgentName(event.target.value)} maxLength={200} required className={inputClass}/></div>
            </div>
            <label htmlFor="business-description" className="mb-2 mt-5 block text-sm font-medium">Business description</label><textarea id="business-description" value={businessDescription} onChange={(event)=>setBusinessDescription(event.target.value)} maxLength={5000} rows={4} className={`${inputClass} resize-y`}/>
            <label htmlFor="welcome-message" className="mb-2 mt-5 block text-sm font-medium">Welcome message</label><textarea id="welcome-message" value={welcomeMessage} onChange={(event)=>setWelcomeMessage(event.target.value)} maxLength={2000} rows={3} required className={`${inputClass} resize-y`}/>
          </section>

          {/* Agent Status */}
          <section className={cardClass}>
            <div className="flex items-center justify-between gap-5">
              <div>
                <h2 className="text-lg font-semibold">
                  Agent Status
                </h2>

                <p className={`mt-1 ${mutedClass}`}>
                  Turn your AI customer support agent on or off.
                </p>
              </div>

              <button
                type="button"
                role="switch"
                aria-label="AI Agent status"
                aria-checked={isActive}
                onClick={() => setIsActive((current) => !current)}
                className={`relative h-8 w-14 shrink-0 rounded-full transition-colors ${
                  isActive
                    ? "bg-blue-600"
                    : "bg-slate-500"
                }`}
              >
                <span
                  className={`absolute top-1 h-6 w-6 rounded-full bg-white shadow-sm transition-all ${
                    isActive ? "left-7" : "left-1"
                  }`}
                />
              </button>
            </div>

            <div className="mt-4">
              <span
                className={`inline-flex rounded-full px-3 py-1 text-sm font-medium ${
                  isActive
                    ? "bg-emerald-500/10 text-emerald-600"
                    : "bg-red-500/10 text-red-500"
                }`}
              >
                {isActive ? "● Online" : "● Offline"}
              </span>
            </div>
          </section>

          {/* Response Tone */}
          <section className={cardClass}>
            <h2 className="text-lg font-semibold">
              Response Tone
            </h2>

            <p className={`mb-5 mt-1 ${mutedClass}`}>
              Choose how the AI should communicate with customers.
            </p>

            <div
              role="group"
              aria-label="Response tone"
              className="grid gap-4 md:grid-cols-3"
            >
              {toneOptions.map((item) => (
                <button
                  key={item.value}
                  type="button"
                  aria-pressed={tone === item.value}
                  onClick={() => setTone(item.value)}
                  className={`rounded-xl border p-5 text-left transition-colors ${
                    tone === item.value
                      ? "border-blue-500 bg-blue-500/10 ring-1 ring-blue-500/30"
                      : "border-[var(--premium-border)] bg-[var(--premium-surface-muted)] hover:border-blue-400"
                  }`}
                >
                  <h3 className="font-semibold text-[var(--premium-text)]">
                    {item.title}
                  </h3>

                  <p className={`mt-2 ${mutedClass}`}>
                    {item.description}
                  </p>

                  {tone === item.value && (
                    <span className="mt-4 inline-block text-xs font-semibold text-[var(--premium-primary)]">
                      ✓ Selected
                    </span>
                  )}
                </button>
              ))}
            </div>
          </section>

          {/* Custom Instructions */}
          <section className={cardClass}>
            <h2 className="text-lg font-semibold">
              Custom Instructions
            </h2>

            <p className={`mb-4 mt-1 ${mutedClass}`}>
              Add special instructions for how your AI Agent
              should respond to customers.
            </p>

            <label
              htmlFor="custom-instructions"
              className="sr-only"
            >
              Custom Instructions
            </label>

            <textarea
              id="custom-instructions"
              value={customInstructions}
              onChange={(event) =>
                setCustomInstructions(event.target.value)
              }
              maxLength={2000}
              rows={8}
              placeholder="Example: Always greet customers politely. Keep answers short. If you do not know an answer, ask the customer to contact our support team."
              className={`${inputClass} resize-y`}
            />

            <div className="mt-2 flex justify-end">
              <span className="text-xs text-[var(--premium-text-muted)]">
                {customInstructions.length}/2000
              </span>
            </div>
          </section>

          {/* Domain Allowlist */}
          <section
            id="domain-security"
            className={`${cardClass} scroll-mt-8`}
          >
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h2 className="text-lg font-semibold">
                  Domain Allowlist / Widget Security
                </h2>

                <p className={`mt-1 max-w-2xl leading-6 ${mutedClass}`}>
                  Choose the exact website hostnames allowed
                  to load and use this agent. Add subdomains
                  such as www separately.
                </p>
              </div>

              <span
                className={`inline-flex w-fit shrink-0 rounded-full px-3 py-1 text-xs font-semibold ${
                  allowedDomainsText.trim()
                    ? "bg-emerald-500/10 text-emerald-600"
                    : "bg-amber-500/10 text-amber-600"
                }`}
              >
                {allowedDomainsText.trim()
                  ? "Restricted"
                  : "Public rollout mode"}
              </span>
            </div>

            <label
              htmlFor="allowed-domains"
              className="mt-5 block text-sm font-medium text-[var(--premium-text)]"
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
              placeholder={
                "example.com\nwww.example.com\nshop.example.com"
              }
              className={`${inputClass} mt-2 resize-y font-mono text-sm`}
            />

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <p className="rounded-xl border border-[var(--premium-border)] bg-[var(--premium-surface-muted)] p-4 text-sm leading-6 text-[var(--premium-text-muted)]">
                You may paste bare domains or full URLs.
                Protocols, paths, ports and trailing dots
                are normalized when you save.
              </p>

              <p className="rounded-xl border border-[var(--premium-border)] bg-[var(--premium-surface-muted)] p-4 text-sm leading-6 text-[var(--premium-text-muted)]">
                Leaving this empty preserves public access
                during rollout. Add at least one domain
                to enable enforcement.
              </p>
            </div>
          </section>

          {/* Save Settings */}
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div aria-live="polite">
              {message && (
                <p
                  role="status"
                  className={`text-sm font-medium ${
                    message.includes("successfully")
                      ? "text-emerald-600"
                      : "text-red-500"
                  }`}
                >
                  {message}
                </p>
              )}
            </div>

            <button
              type="button"
              onClick={saveSettings}
              disabled={saving}
              className="rounded-xl bg-blue-600 px-6 py-3 font-semibold text-white shadow-sm transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? "Saving..." : "Save AI Agent"}
            </button>
          </div>

        </div>
      </div>
    </main>
  );
}
