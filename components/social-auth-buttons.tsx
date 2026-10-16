"use client";

import { useState } from "react";
import { safeAuthDestination } from "@/lib/client-security";
import { supabase } from "@/lib/supabase";

type Provider = "google" | "facebook";
const enabled: Record<Provider, boolean> = {
  google: process.env.NEXT_PUBLIC_GOOGLE_AUTH_ENABLED === "true",
  facebook: process.env.NEXT_PUBLIC_FACEBOOK_AUTH_ENABLED === "true",
};

export function SocialAuthButtons() {
  const [pending, setPending] = useState<Provider | null>(null);
  const [error, setError] = useState("");

  async function continueWith(provider: Provider) {
    if (!enabled[provider] || pending) return;
    setError(""); setPending(provider);
    const next = safeAuthDestination(new URLSearchParams(window.location.search).get("next"));
    const callback = new URL("/auth/callback", window.location.origin);
    callback.searchParams.set("next", next);
    const { error: authError } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: callback.href,
        scopes: provider === "google" ? "openid email profile" : undefined,
        skipBrowserRedirect: false,
      },
    });
    if (authError) { setError("Social sign-in could not be started. Please try again."); setPending(null); }
  }

  return <div className="mt-5 border-t border-[var(--premium-border)] pt-5">
    <p className="mb-3 text-center text-xs uppercase tracking-wider text-[var(--premium-text-muted)]">Or continue securely</p>
    <div className="grid gap-3 sm:grid-cols-2">
      {(["google", "facebook"] as const).map((provider) => <button key={provider} type="button"
        disabled={!enabled[provider] || pending !== null} onClick={() => void continueWith(provider)}
        aria-label={`Continue with ${provider === "google" ? "Google" : "Facebook"}`}
        className="min-h-12 rounded-xl border border-[var(--premium-border)] px-4 py-2 text-sm font-semibold capitalize transition hover:border-blue-500 disabled:cursor-not-allowed disabled:opacity-50">
        {pending === provider ? "Connecting…" : `Continue with ${provider === "google" ? "Google" : "Facebook"}`}
        {!enabled[provider] && <span className="ms-1 text-xs font-normal">(not configured)</span>}
      </button>)}
    </div>
    {error && <p role="alert" className="mt-3 text-sm text-red-400">{error}</p>}
  </div>;
}
