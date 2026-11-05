"use client";

import Link from "next/link";
import { ClipboardEvent, FormEvent, KeyboardEvent, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AuthPreferences, useAuthLocale } from "@/components/auth-preferences";
import { authRetrySeconds } from "@/lib/auth-rate-limit";
import {
  SIGNUP_EMAIL_KEY,
  SIGNUP_MAX_ATTEMPTS,
  clearSignupVerification,
  recordSignupVerificationFailure,
  resetSignupVerificationAttempts,
  signupCooldownSeconds,
  signupVerificationAttempts,
  startSignupCooldown,
} from "@/lib/signup-verification";
import { supabase } from "@/lib/supabase";

const CODE_LENGTH = 6;

export default function VerifyEmailPage() {
  const router = useRouter();
  const { locale, setLocale } = useAuthLocale(true);
  const [email] = useState(() => typeof window === "undefined" ? "" : sessionStorage.getItem(SIGNUP_EMAIL_KEY) || "");
  const [digits, setDigits] = useState(() => Array(CODE_LENGTH).fill("") as string[]);
  const [attempts, setAttempts] = useState(() => typeof window === "undefined" ? 0 : signupVerificationAttempts());
  const [cooldown, setCooldown] = useState(() => typeof window === "undefined" ? 0 : signupCooldownSeconds());
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("Enter the verification code sent to your email address.");
  const inputs = useRef<Array<HTMLInputElement | null>>([]);
  const submitting = useRef(false);

  useEffect(() => {
    if (!email) {
      router.replace("/register");
      return;
    }
    const update = () => setCooldown(signupCooldownSeconds());
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [email, router]);

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
    if (submitting.current || attempts >= SIGNUP_MAX_ATTEMPTS) return;
    const token = digits.join("");
    setError("");
    if (!email || !/^\d{6}$/.test(token)) {
      setError("Enter the complete six-digit verification code.");
      return;
    }
    submitting.current = true;
    setLoading(true);
    try {
      const { data, error: verifyError } = await supabase.auth.verifyOtp({ email, token, type: "email" });
      if (verifyError?.status === 429) {
        const seconds = authRetrySeconds(60);
        setError(`Too many verification attempts. Try again in ${seconds}s.`);
        return;
      }
      if (verifyError || !data.session) {
        const nextAttempts = recordSignupVerificationFailure();
        setAttempts(nextAttempts);
        setDigits(Array(CODE_LENGTH).fill(""));
        setError(nextAttempts >= SIGNUP_MAX_ATTEMPTS
          ? "Verification is temporarily locked in this browser. Request a new code before trying again."
          : "The code is incorrect, expired, or has already been used.");
        inputs.current[0]?.focus();
        return;
      }
      clearSignupVerification();
      setDigits(Array(CODE_LENGTH).fill(""));
      router.replace("/dashboard");
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
      const { error: resendError } = await supabase.auth.resend({ type: "signup", email });
      if (resendError?.status === 429) {
        const seconds = authRetrySeconds(60);
        startSignupCooldown(seconds * 1000);
        setCooldown(seconds);
        setError(`Too many email requests. Try again in ${seconds}s.`);
        return;
      }
      if (resendError) {
        setError("A new code could not be requested. Please wait and try again.");
        return;
      }
      startSignupCooldown();
      setCooldown(60);
      resetSignupVerificationAttempts();
      setAttempts(0);
      setDigits(Array(CODE_LENGTH).fill(""));
      setNotice("If this address is awaiting confirmation, a new verification code has been sent.");
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
        <p className="mt-5 text-xs font-bold uppercase tracking-[0.18em] text-[var(--premium-text-muted)]">Email verification</p>
        <h1 className="mt-2 text-3xl font-bold">Enter your verification code</h1>
        <p className="mt-3 text-sm leading-6 text-[var(--premium-text-muted)]">Enter the six-digit code from your confirmation email. Codes expire according to the Supabase security policy.</p>
        {notice && <p role="status" aria-live="polite" className="mt-5 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-500">{notice}</p>}
        <form onSubmit={verify} className="mt-6">
          <fieldset disabled={attempts >= SIGNUP_MAX_ATTEMPTS}>
            <legend className="sr-only">Six-digit email verification code</legend>
            <div className="grid grid-cols-6 gap-2" dir="ltr">
              {digits.map((digit, index) => <input key={index} ref={(element) => { inputs.current[index] = element; }} value={digit} onChange={(event) => changeDigit(index, event.target.value)} onKeyDown={(event) => keyDown(index, event)} onPaste={paste} inputMode="numeric" autoComplete={index === 0 ? "one-time-code" : "off"} pattern="[0-9]" maxLength={1} aria-label={`Verification code digit ${index + 1}`} className="aspect-square min-w-0 rounded-xl border border-[var(--premium-border)] bg-[var(--premium-surface-muted)] text-center text-xl font-bold outline-none focus:border-blue-500 focus-visible:ring-2 focus-visible:ring-blue-500/30" />)}
            </div>
          </fieldset>
          {error && <p role="alert" aria-live="assertive" className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-500">{error}</p>}
          <button type="submit" disabled={loading || attempts >= SIGNUP_MAX_ATTEMPTS || digits.some((digit) => !digit)} className="mt-6 min-h-12 w-full rounded-xl bg-blue-600 px-4 font-semibold text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-60">{loading ? <span role="status">Verifying…</span> : "Verify Email"}</button>
        </form>
        <button type="button" onClick={() => void resend()} disabled={resending || cooldown > 0 || !email} className="mt-4 min-h-11 w-full text-sm font-semibold text-blue-500 disabled:cursor-not-allowed disabled:opacity-60">{resending ? "Sending…" : cooldown > 0 ? `Resend available in ${cooldown}s` : "Resend Code"}</button>
        <Link href="/register" className="mt-3 block min-h-11 text-center text-sm text-[var(--premium-text-muted)]">Use a different email address</Link>
        <div className="mt-5"><AuthPreferences locale={locale} onLocaleChange={setLocale} /></div>
      </section>
    </main>
  );
}
