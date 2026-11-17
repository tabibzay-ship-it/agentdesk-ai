
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import ThemeSwitcher from "@/components/theme-switcher";
import MarketingPreferences from "@/components/marketing-preferences";
import { SocialIdentityLinking } from "@/components/social-identity-linking";

export default function SettingsPage() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState("");
  const [userId, setUserId] = useState("");

  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState("");

  useEffect(() => {
    let active = true;

    async function loadAccount() {
      try {
        const {
          data: { user },
          error,
        } = await supabase.auth.getUser();

        if (!active) return;

        if (error || !user) {
          router.replace("/login");
          return;
        }

        setEmail(user.email || "");
        setUserId(user.id);
      } catch {
        if (active) router.replace("/login");
      } finally {
        if (active) setLoading(false);
      }
    }

    void loadAccount();

    return () => {
      active = false;
    };
  }, [router]);

  async function signOut() {
    if (signingOut) return;

    setSignOutError("");
    setSigningOut(true);

    try {
      const { error } = await supabase.auth.signOut({
        scope: "global",
      });

      if (error) {
        setSignOutError(
          "Could not sign out. Please try again."
        );
        return;
      }

      router.replace("/login");
    } catch {
      setSignOutError(
        "Could not sign out. Please try again."
      );
    } finally {
      setSigningOut(false);
    }
  }

  const cardClass =
    "rounded-2xl border border-[var(--premium-border)] bg-[var(--premium-surface)] p-6 shadow-sm";

  const secondaryButton =
    "rounded-xl border border-[var(--premium-border)] bg-[var(--premium-surface-muted)] px-5 py-2.5 font-semibold text-[var(--premium-text)] transition-colors hover:opacity-80";

  const mutedClass =
    "text-sm text-[var(--premium-text-muted)]";

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[var(--background)] text-[var(--foreground)]">
        <p role="status" className={mutedClass}>
          Loading settings...
        </p>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[var(--background)] text-[var(--foreground)]">
      <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6">

        {/* Header */}
        <header className="mb-10 flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="mb-2 font-semibold text-[var(--premium-primary)]">
              AgentDesk AI
            </p>

            <h1 className="text-3xl font-bold">
              Settings
            </h1>

            <p className={`mt-2 ${mutedClass}`}>
              Manage your AgentDesk AI account and workspace.
            </p>
          </div>

          <button
            type="button"
            onClick={() => router.push("/dashboard")}
            className={secondaryButton}
          >
            Back to Dashboard
          </button>
        </header>

        <div className="space-y-6">

          {/* Account */}
          <section className={cardClass}>
            <h2 className="text-xl font-semibold">
              Account
            </h2>

            <p className={`mb-6 mt-1 ${mutedClass}`}>
              Your AgentDesk AI account information.
            </p>

            <div className="space-y-5">
              <div>
                <p className={`mb-2 ${mutedClass}`}>
                  Email Address
                </p>

                <div className="break-all rounded-xl border border-[var(--premium-border)] bg-[var(--premium-surface-muted)] px-4 py-3">
                  {email}
                </div>
              </div>

              <div>
                <p className={`mb-2 ${mutedClass}`}>
                  Account ID
                </p>

                <div className="break-all rounded-xl border border-[var(--premium-border)] bg-[var(--premium-surface-muted)] px-4 py-3 text-sm">
                  {userId}
                </div>
              </div>
            </div>
          </section>

          {/* Business */}
          <section className={cardClass}>
            <h2 className="text-xl font-semibold">
              Business Information
            </h2>

            <p className={`mb-5 mt-1 ${mutedClass}`}>
              Manage the information your AI uses about your business.
            </p>

            <button
              type="button"
              onClick={() => router.push("/business")}
              className="rounded-xl bg-blue-600 px-5 py-2.5 font-semibold text-white transition-colors hover:bg-blue-700"
            >
              Manage Business Information
            </button>
          </section>

          {/* AI Agent */}
          <section className={cardClass}>
            <h2 className="text-xl font-semibold">
              AI Agent
            </h2>

            <p className={`mb-5 mt-1 ${mutedClass}`}>
              Configure your AI Agent status, tone and custom instructions.
            </p>

            <button
              type="button"
              onClick={() => router.push("/agent")}
              className={secondaryButton}
            >
              Manage AI Agent
            </button>
          </section>

          {/* Website Widget */}
          <section className={cardClass}>
            <h2 className="text-xl font-semibold">
              Website Widget
            </h2>

            <p className={`mb-5 mt-1 ${mutedClass}`}>
              Customize your support widget or get the installation code.
            </p>

            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => router.push("/widget")}
                className={secondaryButton}
              >
                Customize Widget
              </button>

              <button
                type="button"
                onClick={() => router.push("/install")}
                className={secondaryButton}
              >
                Installation Code
              </button>
            </div>
          </section>

          {/* Knowledge Base */}
          <section className={cardClass}>
            <h2 className="text-xl font-semibold">
              Knowledge Base
            </h2>

            <p className={`mb-5 mt-1 ${mutedClass}`}>
              Add and manage information used by your AI Agent.
            </p>

            <button
              type="button"
              onClick={() => router.push("/knowledge")}
              className={secondaryButton}
            >
              Manage Knowledge
            </button>
          </section>

          {/* Appearance */}
          <section className={cardClass}>
            <h2 className="text-xl font-semibold">Connected sign-in methods</h2>
            <p className={`mb-5 mt-1 ${mutedClass}`}>Link a provider only while signed in. AgentDesk never merges accounts solely because an unverified email matches.</p>
            <SocialIdentityLinking />
          </section>

          {/* Appearance */}
          <section className={cardClass}>
            <h2 className="text-xl font-semibold">Email preferences</h2>
            <p className={`mb-5 mt-1 ${mutedClass}`}>Control optional product email separately from essential account and security messages.</p>
            <MarketingPreferences />
          </section>

          {/* Appearance */}
          <section className={cardClass}>
            <h2 className="text-xl font-semibold">
              Appearance
            </h2>

            <p className={`mb-5 mt-1 ${mutedClass}`}>
              Choose how AgentDesk AI looks on your device.
            </p>

            <ThemeSwitcher />

            <p className="mt-4 text-xs text-[var(--premium-text-muted)]">
              Select Light, Dark, or System. Your current choice is highlighted and saved on this device.
            </p>
          </section>

          {/* Sign Out */}
          <section className="rounded-2xl border border-red-500/30 bg-red-500/5 p-6">
            <h2 className="text-xl font-semibold">
              Sign Out
            </h2>

            <p className={`mb-5 mt-1 ${mutedClass}`}>
              Sign out of your AgentDesk AI account across devices.
            </p>

            <button
              type="button"
              onClick={signOut}
              disabled={signingOut}
              className="rounded-xl bg-red-600 px-5 py-2.5 font-semibold text-white transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {signingOut
                ? "Signing Out..."
                : "Sign Out"}
            </button>

            {signOutError && (
              <p
                role="alert"
                className="mt-3 text-sm text-red-500"
              >
                {signOutError}
              </p>
            )}
          </section>

        </div>
      </div>
    </main>
  );
}
