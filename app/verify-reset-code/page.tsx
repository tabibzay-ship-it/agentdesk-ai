"use client";

import Link from "next/link";
import { ClipboardEvent, FormEvent, KeyboardEvent, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AuthPreferences, useAuthLocale } from "@/components/auth-preferences";
import { RECOVERY_EMAIL_KEY, RECOVERY_SESSION_KEY, recoveryCooldownSeconds, startRecoveryCooldown } from "@/lib/recovery-flow";
import { supabase } from "@/lib/supabase";

const CODE_LENGTH = 6;

export default function VerifyResetCodePage() {
  const router = useRouter();
  const { locale, setLocale } = useAuthLocale(true);
  const [email, setEmail] = useState("");
  const [emailReady, setEmailReady] = useState(false);
  const [digits, setDigits] = useState(() => Array(CODE_LENGTH).fill("") as string[]);
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("If an account exists for this email, a verification code has been sent.");
  const inputs = useRef<Array<HTMLInputElement | null>>([]);
  const submitting = useRef(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const storedEmail = sessionStorage.getItem(RECOVERY_EMAIL_KEY) || "";
      setEmail(storedEmail);
      setEmailReady(true);
      if (!storedEmail) router.replace("/forgot-password");
    }, 0);
    return () => window.clearTimeout(timer);
  }, [router]);

  useEffect(() => {
    if (!emailReady || !email) return;
    const update = () => setCooldown(recoveryCooldownSeconds());
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [email, emailReady]);

  function setCode(value: string) {
    const next = value.replace(/\D/g, "").slice(0, CODE_LENGTH).split("");
    setDigits(Array.from({ length: CODE_LENGTH }, (_, index) => next[index] || ""));
    inputs.current[Math.min(next.length, CODE_LENGTH - 1)]?.focus();
  }

  function changeDigit(index: number, value: string) {
    const numeric = value.replace(/\D/g, "");
    if (numeric.length > 1) { setCode(numeric); return; }
    setDigits((current) => current.map((digit, position) => position === index ? numeric : digit));
    if (numeric && index < CODE_LENGTH - 1) inputs.current[index + 1]?.focus();
  }

  function keyDown(index: number, event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Backspace" && !digits[index] && index > 0) inputs.current[index - 1]?.focus();
    if (event.key === "ArrowLeft" && index > 0) inputs.current[index - 1]?.focus();
    if (event.key === "ArrowRight" && index < CODE_LENGTH - 1) inputs.current[index + 1]?.focus();
  }

  function paste(event: ClipboardEvent<HTMLInputElement>) {
    event.preventDefault();
    setCode(event.clipboardData.getData("text"));
  }

  async function verify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    const token = digits.join("");
    setError("");
    if (!/^\d{6}$/.test(token) || !email) {
      setError("Enter the complete six-digit verification code.");
      return;
    }
    submitting.current = true;
    setLoading(true);
    try {
      const { data, error: verifyError } = await supabase.auth.verifyOtp({ email, token, type: "recovery" });
      if (verifyError || !data.session) {
        setError(verifyError?.status === 429 ? "Too many attempts. Please wait and try again." : "The code is incorrect, expired, or has already been used.");
        return;
      }
      setDigits(Array(CODE_LENGTH).fill(""));
      sessionStorage.setItem(RECOVERY_SESSION_KEY, "verified");
      router.replace("/reset-password");
    } catch {
      setError("The code could not be verified. Check your connection and try again.");
    } finally {
      submitting.current = false;
      setLoading(false);
    }
  }

  async function resend() {
    if (!email || cooldown > 0 || resending) return;
    setError("");
    setNotice("");
    setResending(true);
    try {
      const { error: resendError } = await supabase.auth.resetPasswordForEmail(email);
      if (resendError?.status === 429) {
        startRecoveryCooldown();
        setCooldown(60);
        setError("Too many requests. Please wait before requesting another code.");
        return;
      }
      if (resendError) {
        setError("A new code could not be requested. Check your connection and try again.");
        return;
      }
      startRecoveryCooldown();
      setCooldown(60);
      setDigits(Array(CODE_LENGTH).fill(""));
      setNotice("If an account exists for this email, a new verification code has been sent.");
      inputs.current[0]?.focus();
    } catch {
      setError("A new code could not be requested. Check your connection and try again.");
    } finally {
      setResending(false);
    }
  }

  return (
    <main className="grid min-h-screen place-items-center bg-[var(--background)] px-4 py-10 text-[var(--foreground)]">
      <section className="w-full max-w-md rounded-2xl border border-[var(--premium-border)] bg-[var(--premium-surface)] p-6 shadow-xl sm:p-8">
        <p className="font-semibold text-blue-500">AgentDesk AI</p>
        <p className="mt-5 text-xs font-bold uppercase tracking-[0.18em] text-[var(--premium-text-muted)]">Step 2 of 3</p>
        <h1 className="mt-2 text-3xl font-bold">Verify your code</h1>
        <p className="mt-3 text-sm leading-6 text-[var(--premium-text-muted)]">Enter the six-digit password reset code from your email. The code expires according to the security policy configured in Supabase.</p>
        {notice && <p role="status" aria-live="polite" className="mt-5 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-500">{notice}</p>}
        <form onSubmit={verify} className="mt-6">
          <fieldset>
            <legend className="sr-only">Six-digit verification code</legend>
            <div className="grid grid-cols-6 gap-2" dir="ltr">
              {digits.map((digit, index) => <input key={index} ref={(element) => { inputs.current[index] = element; }} value={digit} onChange={(event) => changeDigit(index, event.target.value)} onKeyDown={(event) => keyDown(index, event)} onPaste={paste} inputMode="numeric" autoComplete={index === 0 ? "one-time-code" : "off"} pattern="[0-9]" maxLength={1} aria-label={`Verification code digit ${index + 1}`} className="aspect-square min-w-0 rounded-xl border border-[var(--premium-border)] bg-[var(--premium-surface-muted)] text-center text-xl font-bold outline-none focus:border-blue-500 focus-visible:ring-2 focus-visible:ring-blue-500/30" />)}
            </div>
          </fieldset>
          {error && <p role="alert" aria-live="assertive" className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-500">{error}</p>}
          <button type="submit" disabled={loading || digits.some((digit) => !digit)} className="mt-6 min-h-12 w-full rounded-xl bg-blue-600 px-4 font-semibold text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-60">{loading ? <span role="status">Verifying…</span> : "Verify Code"}</button>
        </form>
        <button type="button" onClick={() => void resend()} disabled={resending || cooldown > 0 || !email} className="mt-4 min-h-11 w-full text-sm font-semibold text-blue-500 disabled:cursor-not-allowed disabled:opacity-60">{resending ? "Sending…" : cooldown > 0 ? `Resend available in ${cooldown}s` : "Resend Code"}</button>
        <Link href="/forgot-password" className="mt-3 block min-h-11 text-center text-sm text-[var(--premium-text-muted)]">Use a different email address</Link>
        <div className="mt-5"><AuthPreferences locale={locale} onLocaleChange={setLocale} /></div>
      </section>
    </main>
  );
}
