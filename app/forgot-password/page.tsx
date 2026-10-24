"use client";

import Link from "next/link";
import { FormEvent, useEffect, useRef, useState } from "react";
import { AuthPreferences, useAuthLocale } from "@/components/auth-preferences";
import { isValidEmail } from "@/lib/client-security";
import { recoveryCooldownSeconds, startRecoveryCooldown } from "@/lib/recovery-flow";
import { supabase } from "@/lib/supabase";

export default function ForgotPasswordPage() {
  const { locale, setLocale } = useAuthLocale(true);
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [cooldown, setCooldown] = useState(0);
  const submitting = useRef(false);

  useEffect(() => {
    const update = () => setCooldown(recoveryCooldownSeconds());
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current || cooldown > 0) return;
    const normalizedEmail = email.trim().toLowerCase();
    setError("");
    setNotice("");
    if (!isValidEmail(normalizedEmail)) {
      setError("Enter a valid email address.");
      return;
    }

    submitting.current = true;
    setLoading(true);
    try {
      const redirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent("/reset-password")}`;
      const { error: recoveryError } = await supabase.auth.resetPasswordForEmail(normalizedEmail, { redirectTo });
      if (recoveryError?.status === 429) {
        startRecoveryCooldown();
        setCooldown(60);
        setError("Too many requests. Please wait before requesting another code.");
        return;
      }
      if (recoveryError) {
        setError("We could not start password recovery. Check your connection and try again.");
        return;
      }
      startRecoveryCooldown();
      setCooldown(60);
      setNotice("If an account exists for this email, you will receive a password reset link.");
    } catch {
      setError("We could not start password recovery. Check your connection and try again.");
    } finally {
      submitting.current = false;
      setLoading(false);
    }
  }

  return (
    <main className="grid min-h-screen place-items-center bg-[var(--background)] px-4 py-10 text-[var(--foreground)]">
      <section className="w-full max-w-md rounded-2xl border border-[var(--premium-border)] bg-[var(--premium-surface)] p-6 shadow-xl sm:p-8">
        <p className="font-semibold text-blue-500">AgentDesk AI</p>
        <p className="mt-5 text-xs font-bold uppercase tracking-[0.18em] text-[var(--premium-text-muted)]">Account recovery</p>
        <h1 className="mt-2 text-3xl font-bold">Forgot your password?</h1>
        <p className="mt-3 text-sm leading-6 text-[var(--premium-text-muted)]">Enter your email address and we will send a secure password reset link.</p>
        <form onSubmit={submit} className="mt-7">
          <label htmlFor="recovery-email" className="text-sm font-medium">Email address</label>
          <input id="recovery-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} required maxLength={254} autoComplete="email" placeholder="you@company.com" className="mt-2 min-h-12 w-full rounded-xl border border-[var(--premium-border)] bg-[var(--premium-surface-muted)] px-4 outline-none focus:border-blue-500 focus-visible:ring-2 focus-visible:ring-blue-500/30" />
          {error && <p role="alert" aria-live="assertive" className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-500">{error}</p>}
          {notice && <p role="status" aria-live="polite" className="mt-4 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-600">{notice}</p>}
          <button type="submit" disabled={loading || cooldown > 0} className="mt-6 min-h-12 w-full rounded-xl bg-blue-600 px-4 font-semibold text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-60">
            {loading ? <span role="status">Sending reset link…</span> : cooldown > 0 ? `Try again in ${cooldown}s` : "Send Reset Link"}
          </button>
        </form>
        <Link href="/login" className="mt-6 block min-h-11 text-center text-sm font-semibold text-blue-500">Back to Sign In</Link>
        <div className="mt-5"><AuthPreferences locale={locale} onLocaleChange={setLocale} /></div>
      </section>
    </main>
  );
}
