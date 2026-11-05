"use client";

import Link from "next/link";
import { FormEvent, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../../lib/supabase";
import { isBoundedText, isStrongPassword, isValidEmail } from "../../lib/client-security";
import { AuthPreferences, useAuthLocale } from "@/components/auth-preferences";
import { SocialAuthButtons } from "@/components/social-auth-buttons";
import { authRetrySeconds } from "@/lib/auth-rate-limit";
import { rememberSignupEmail, signupCooldownSeconds, startSignupCooldown } from "@/lib/signup-verification";

export default function RegisterPage() {
  const router = useRouter();
  const { locale, setLocale, t, rtl } = useAuthLocale(true);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [marketingConsent, setMarketingConsent] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const submitting = useRef(false);

  useEffect(() => {
    let active = true;
    void supabase.auth.getSession().then(({ data }) => {
      if (active && data.session) router.replace("/dashboard");
    });
    return () => { active = false; };
  }, [router]);

  useEffect(() => {
    const update = () => setCooldown(signupCooldownSeconds());
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, []);

  async function handleRegister(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submitting.current) return;
    if (cooldown > 0) return;

    setErrorMessage("");
    const normalizedEmail = email.trim().toLowerCase();

    if (!fullName.trim() || !isBoundedText(fullName.trim(), 200)) {
      setErrorMessage(t.invalidName);
      return;
    }

    if (!isValidEmail(normalizedEmail)) {
      setErrorMessage(t.invalidEmail);
      return;
    }

    if (!isStrongPassword(password)) {
      setErrorMessage(t.weakPassword);
      return;
    }

    if (password !== confirmPassword) {
      setErrorMessage(t.mismatch);
      return;
    }

    submitting.current = true;
    setLoading(true);

    try {
      const { data, error } = await supabase.auth.signUp({
        email: normalizedEmail,
        password,
        options: {
          data: {
            full_name: fullName.trim(),
            marketing_consent: marketingConsent,
            marketing_consent_policy: "2026-10",
            marketing_consent_source: "registration",
          },
          // PKCE confirmation links return an authorization code. Route them
          // through the callback so the code is exchanged before protected
          // pages are opened.
          emailRedirectTo: `${window.location.origin}/auth/callback?next=%2Fdashboard`,
        },
      });

      if (error) {
        // Provider responses can reveal whether an email is registered.
        if (error.status === 429) {
          const seconds = authRetrySeconds(60);
          startSignupCooldown(seconds * 1000);
          setCooldown(seconds);
          setErrorMessage(`Too many attempts. Try again in ${seconds}s.`);
        } else {
          setErrorMessage(t.createFailed);
        }
        return;
      }

      if (data.session) {
        setPassword("");
        setConfirmPassword("");
        router.replace("/dashboard");
        return;
      }
      rememberSignupEmail(normalizedEmail);
      startSignupCooldown();
      setPassword("");
      setConfirmPassword("");
      router.replace("/verify-email");
    } catch {
      setErrorMessage(t.createRetry);
    } finally {
      submitting.current = false;
      setLoading(false);
    }
  }

  return (
    <main dir={rtl ? "rtl" : "ltr"} className="min-h-screen bg-[var(--background)] text-[var(--foreground)]">
      <nav className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-5 sm:px-6">
        <Link href="/" className="text-2xl font-bold">
          AgentDesk <span className="text-blue-500">AI</span>
        </Link>

        <p className="text-sm text-[var(--premium-text-muted)]">
          {t.haveAccount}{" "}
          <Link href="/login" className="font-semibold text-blue-400">
            {t.signIn}
          </Link>
        </p>
      </nav>

      <section className="flex items-center justify-center px-4 py-8 sm:px-6 sm:py-10">
        <div className="w-full max-w-md">
          <div className="mb-8 text-center">
            <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-600 text-xl font-bold">
              AI
            </div>

            <h1 className="text-3xl font-bold">{t.createTitle}</h1>

            <p className="mt-3 text-[var(--premium-text-muted)]">
              {t.createSubtitle}
            </p>
          </div>

          <form
            onSubmit={handleRegister}
            className="rounded-2xl border border-[var(--premium-border)] bg-[var(--premium-surface)] p-5 shadow-2xl sm:p-7"
          >
            <label htmlFor="register-name" className="text-sm font-medium">{t.fullName}</label>

            <input
              id="register-name"
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder={t.namePlaceholder}
              required
              autoComplete="name"
              maxLength={200}
              className="mt-2 min-h-12 w-full rounded-xl border border-[var(--premium-border)] bg-[var(--premium-surface-muted)] px-4 py-3 outline-none focus:border-blue-500"
            />

            <label htmlFor="register-email" className="mt-5 block text-sm font-medium">
              {t.email}
            </label>

            <input
              id="register-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com"
              required
              autoComplete="email"
              maxLength={254}
              className="mt-2 min-h-12 w-full rounded-xl border border-[var(--premium-border)] bg-[var(--premium-surface-muted)] px-4 py-3 outline-none focus:border-blue-500"
            />

            <label htmlFor="register-password" className="mt-5 block text-sm font-medium">{t.password}</label>

            <div className="relative mt-2">
              <input
                id="register-password"
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={t.createPassword}
                required
                minLength={12}
                maxLength={1024}
                autoComplete="new-password"
                className="min-h-12 w-full rounded-xl border border-[var(--premium-border)] bg-[var(--premium-surface-muted)] px-4 py-3 pe-16 outline-none focus:border-blue-500"
              />

              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                aria-label={showPassword ? t.hidePasswords : t.showPasswords}
                className="absolute end-4 top-1/2 min-h-11 -translate-y-1/2 text-sm text-[var(--premium-text-muted)] hover:text-blue-500 focus-visible:outline-2 focus-visible:outline-blue-500"
              >
                {showPassword ? t.hide : t.show}
              </button>
            </div>

            <p className="mt-2 text-xs text-slate-500">
              {t.passwordHint}
            </p>

            <label className="mt-5 block text-sm font-medium" htmlFor="confirm-password">{t.confirmPassword}</label>
            <input id="confirm-password" type={showPassword ? "text" : "password"} value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)} required minLength={12} maxLength={1024}
              autoComplete="new-password" className="mt-2 min-h-12 w-full rounded-xl border border-[var(--premium-border)] bg-[var(--premium-surface-muted)] px-4 py-3 outline-none focus:border-blue-500" />

            <label className="mt-5 flex cursor-pointer items-start gap-3 text-sm leading-6 text-[var(--premium-text-muted)]">
              <input type="checkbox" checked={marketingConsent} onChange={(event) => setMarketingConsent(event.target.checked)}
                className="h-6 w-6 shrink-0 accent-blue-600" />
              <span>{t.marketingConsent}</span>
            </label>

            {errorMessage && (
              <div role="alert" aria-live="assertive" className="mt-5 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-400">
                {errorMessage}
              </div>
            )}

            {cooldown > 0 && (
              <p role="status" aria-live="polite" className="sr-only">
                Registration is temporarily paused for {cooldown} seconds.
              </p>
            )}

            <button
              type="submit"
              disabled={loading || cooldown > 0}
              className="mt-6 w-full rounded-xl bg-blue-600 py-3 font-semibold transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading ? <span role="status">{t.creating}</span> : cooldown > 0 ? `Try again in ${cooldown}s` : t.createAccount}
            </button>

            <SocialAuthButtons />

          </form>
          <div className="mt-5"><AuthPreferences locale={locale} onLocaleChange={setLocale} /></div>
        </div>
      </section>
    </main>
  );
}
