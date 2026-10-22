"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { safeAuthCallbackDestination } from "@/lib/client-security";
import { RECOVERY_SESSION_KEY } from "@/lib/recovery-flow";
import { supabase } from "@/lib/supabase";

export default function AuthCallbackPage() {
  const router = useRouter();
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    async function finish() {
      const url = new URL(window.location.href);
      const next = safeAuthCallbackDestination(url.searchParams.get("next"));
      const code = url.searchParams.get("code");
      const fragment = new URLSearchParams(url.hash.slice(1));
      const accessToken = fragment.get("access_token");
      const refreshToken = fragment.get("refresh_token");
      // Remove one-time credentials before any asynchronous work, error UI,
      // analytics or browser extensions can retain the callback URL.
      window.history.replaceState({}, "", "/auth/callback");
      // Callback credentials identify the session the user is actively completing.
      // Only reuse an existing session when this is not an authentication callback.
      const result = code
        ? await supabase.auth.exchangeCodeForSession(code)
        : accessToken && refreshToken
          ? await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken })
          : await supabase.auth.getSession();
      if (!active) return;
      if (!result || result.error || !result.data.session) {
        setError("The sign-in response is invalid or expired. Please try again.");
        return;
      }
      if (next === "/reset-password" && (code || (accessToken && refreshToken))) {
        sessionStorage.setItem(RECOVERY_SESSION_KEY, "verified");
      }
      router.replace(next);
    }
    void finish();
    return () => { active = false; };
  }, [router]);
  return <main className="flex min-h-screen items-center justify-center bg-[var(--background)] px-4 text-[var(--foreground)]">
    <section className="w-full max-w-md rounded-2xl border border-[var(--premium-border)] bg-[var(--premium-surface)] p-6 text-center">
      {error ? <><h1 className="text-xl font-bold">Sign-in failed</h1><p role="alert" className="mt-3 text-red-400">{error}</p><Link href="/login" className="mt-5 inline-block text-blue-500">Return to Sign In</Link></>
        : <><div role="status" className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-blue-500 border-t-transparent"/><p className="mt-4">Verifying your secure sign-in…</p></>}
    </section>
  </main>;
}
