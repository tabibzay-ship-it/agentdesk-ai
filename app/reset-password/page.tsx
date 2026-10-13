"use client";

import Link from "next/link";
import { FormEvent, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AuthPreferences, useAuthLocale } from "@/components/auth-preferences";
import { isStrongPassword } from "@/lib/client-security";
import { hasRecoveryAuthorization, RECOVERY_EMAIL_KEY } from "@/lib/recovery-flow";
import { supabase } from "@/lib/supabase";

export default function ResetPasswordPage() {
  const router = useRouter();
  const { locale, setLocale } = useAuthLocale();
  const [recoveryState, setRecoveryState] = useState<"checking" | "ready" | "invalid">("checking");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const submitting = useRef(false);

  useEffect(() => {
    let active = true;
    void supabase.auth.getClaims().then(({ data, error: claimsError }) => {
      if (!active) return;
      setRecoveryState(!claimsError && hasRecoveryAuthorization(data?.claims) ? "ready" : "invalid");
    }).catch(() => {
      if (active) setRecoveryState("invalid");
    });
    return () => { active = false; };
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    setError("");
    if (recoveryState !== "ready") {
      setError("Your recovery authorization is missing or expired. Request a new code.");
      return;
    }
    if (!isStrongPassword(password)) {
      setError("Use 12 or more characters with at least one letter and one number.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }

    submitting.current = true;
    setLoading(true);
    try {
      const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
      if (claimsError || !hasRecoveryAuthorization(claimsData?.claims)) {
        setRecoveryState("invalid");
        setError("Your recovery authorization is missing or expired. Request a new code.");
        return;
      }
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) {
        setError("Password could not be updated. Request a new verification code and try again.");
        return;
      }
      setPassword("");
      setConfirm("");
      sessionStorage.removeItem(RECOVERY_EMAIL_KEY);
      await supabase.auth.signOut({ scope: "local" });
      router.replace("/login?reset=success");
    } catch {
      setError("Password could not be updated. Check your connection and try again.");
    } finally {
      submitting.current = false;
      setLoading(false);
    }
  }

  return (
    <main className="grid min-h-screen place-items-center bg-[var(--background)] px-4 py-10 text-[var(--foreground)]">
      <section className="w-full max-w-md rounded-2xl border border-[var(--premium-border)] bg-[var(--premium-surface)] p-6 shadow-xl sm:p-8">
        <p className="font-semibold text-blue-500">AgentDesk AI</p>
        <p className="mt-5 text-xs font-bold uppercase tracking-[0.18em] text-[var(--premium-text-muted)]">Step 3 of 3</p>
        <h1 className="mt-2 text-3xl font-bold">Create a new password</h1>
        <p className="mt-3 text-sm leading-6 text-[var(--premium-text-muted)]">Use at least 12 characters with a letter and a number.</p>
        {recoveryState === "checking" && <p role="status" aria-live="polite" className="mt-5 rounded-xl border border-blue-500/30 bg-blue-500/10 p-3 text-sm text-blue-500">Verifying your recovery session…</p>}
        {recoveryState === "invalid" && <p role="alert" className="mt-5 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-500">Your recovery authorization is invalid or expired. Request a new verification code.</p>}
        <form onSubmit={submit} className="mt-6 space-y-5">
          <div><label htmlFor="new-password" className="text-sm font-medium">New Password</label><input id="new-password" type={show ? "text" : "password"} value={password} onChange={(event) => setPassword(event.target.value)} required minLength={12} maxLength={1024} autoComplete="new-password" disabled={recoveryState !== "ready"} className="mt-2 min-h-12 w-full rounded-xl border border-[var(--premium-border)] bg-[var(--premium-surface-muted)] px-4 outline-none focus:border-blue-500 disabled:opacity-60" /></div>
          <div><label htmlFor="confirm-new-password" className="text-sm font-medium">Confirm New Password</label><input id="confirm-new-password" type={show ? "text" : "password"} value={confirm} onChange={(event) => setConfirm(event.target.value)} required minLength={12} maxLength={1024} autoComplete="new-password" disabled={recoveryState !== "ready"} className="mt-2 min-h-12 w-full rounded-xl border border-[var(--premium-border)] bg-[var(--premium-surface-muted)] px-4 outline-none focus:border-blue-500 disabled:opacity-60" /></div>
          <button type="button" onClick={() => setShow((value) => !value)} aria-label={show ? "Hide passwords" : "Show passwords"} className="min-h-11 text-sm font-semibold text-blue-500">{show ? "Hide Passwords" : "Show Passwords"}</button>
          {error && <p role="alert" aria-live="assertive" className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-500">{error}</p>}
          <button type="submit" disabled={loading || recoveryState !== "ready"} className="min-h-12 w-full rounded-xl bg-blue-600 px-4 font-semibold text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-60">{loading ? <span role="status">Resetting password…</span> : "Reset Password"}</button>
        </form>
        <Link href="/forgot-password" className="mt-6 block min-h-11 text-center text-sm font-semibold text-blue-500">Request a new code</Link>
        <div className="mt-5"><AuthPreferences locale={locale} onLocaleChange={setLocale} /></div>
      </section>
    </main>
  );
}
