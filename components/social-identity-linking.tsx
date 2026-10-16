"use client";

import { useEffect, useState } from "react";
import type { UserIdentity } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";

type Provider = "google" | "facebook";
const enabled: Record<Provider, boolean> = {
  google: process.env.NEXT_PUBLIC_GOOGLE_AUTH_ENABLED === "true",
  facebook: process.env.NEXT_PUBLIC_FACEBOOK_AUTH_ENABLED === "true",
};

export function SocialIdentityLinking() {
  const [identities, setIdentities] = useState<UserIdentity[]>([]);
  const [pending, setPending] = useState("");
  const [message, setMessage] = useState("");
  useEffect(() => { void supabase.auth.getUser().then(({ data }) => setIdentities(data.user?.identities ?? [])); }, []);

  async function link(provider: Provider) {
    if (!enabled[provider] || pending) return;
    setPending(provider); setMessage("");
    const { error } = await supabase.auth.linkIdentity({ provider, options: {
      redirectTo: `${window.location.origin}/auth/callback?next=%2Fsettings`,
      scopes: provider === "google" ? "openid email profile" : undefined,
    } });
    if (error) { setMessage("Identity linking could not be started."); setPending(""); }
  }

  async function unlink(identity: UserIdentity) {
    if (pending || identities.length < 2 || !window.confirm(`Disconnect ${identity.provider}?`)) return;
    setPending(identity.id); setMessage("");
    const { error } = await supabase.auth.unlinkIdentity(identity);
    if (error) setMessage("This identity could not be disconnected. Keep at least one sign-in method.");
    else { setIdentities((items) => items.filter((item) => item.id !== identity.id)); setMessage("Identity disconnected."); }
    setPending("");
  }

  return <div>
    <div className="space-y-2">{identities.map((identity) => <div key={identity.id} className="flex min-h-12 items-center justify-between rounded-xl border border-[var(--premium-border)] px-4 text-sm"><span className="capitalize">{identity.provider}</span><button type="button" onClick={() => void unlink(identity)} disabled={pending !== "" || identities.length < 2} className="min-h-11 text-red-500 disabled:opacity-40">Disconnect</button></div>)}</div>
    <div className="mt-4 flex flex-wrap gap-3">{(["google", "facebook"] as const).map((provider) => <button key={provider} type="button" onClick={() => void link(provider)} disabled={!enabled[provider] || pending !== "" || identities.some((item) => item.provider === provider)} className="min-h-11 rounded-xl border border-[var(--premium-border)] px-4 text-sm font-semibold capitalize disabled:opacity-50">{pending === provider ? "Connecting…" : `Connect ${provider}`}{!enabled[provider] ? " (not configured)" : ""}</button>)}</div>
    {message && <p role="status" className="mt-3 text-sm text-[var(--premium-text-muted)]">{message}</p>}
  </div>;
}
