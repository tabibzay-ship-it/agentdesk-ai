"use client";

import Link from "next/link";
import { FormEvent, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../../lib/supabase";
import { isBoundedText, isValidEmail, safeAuthDestination } from "../../lib/client-security";
import { AuthPreferences, useAuthLocale } from "@/components/auth-preferences";

export default function LoginPage() {
  const router = useRouter();
  const { locale, setLocale, t, rtl } = useAuthLocale();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [notice] = useState(() => {
    if (typeof window === "undefined") return "";
    const params = new URLSearchParams(window.location.search);
    if (params.get("confirmed") === "1") return "confirmed";
    if (params.get("reset") === "success") return "reset";
    return null;
  });
  const submitting = useRef(false);

  useEffect(() => {
    let active = true;
    void supabase.auth.getSession().then(({ data }) => {
      if (active && data.session) {
        router.replace(safeAuthDestination(new URLSearchParams(window.location.search).get("next")));
      }
    });
    return () => { active = false; };
  }, [router]);

  async function handleLogin(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submitting.current) return;

    setErrorMessage("");
    if (!isValidEmail(email.trim()) || !password || !isBoundedText(password, 1024)) {
      setErrorMessage(t.invalidLogin);
      return;
    }
    submitting.current = true;
    setLoading(true);

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (error) {
        setErrorMessage(error.status === 429
          ? t.tooMany : t.loginFailed);
        return;
      }

      if (!data.session) {
        setErrorMessage(t.noSession);
        return;
      }

      setPassword("");
      router.replace(safeAuthDestination(new URLSearchParams(window.location.search).get("next")));
    } catch {
      setErrorMessage(t.generic);
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
          {t.noAccount}{" "}
          <Link href="/register" className="font-semibold text-blue-400">
            {t.startFree}
          </Link>
        </p>
      </nav>

      <section className="flex min-h-[80vh] items-center justify-center px-4 py-8 sm:px-6">
        <div className="w-full max-w-md">

          <div className="mb-8 text-center">
            <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-600 text-xl font-bold">
              AI
            </div>

            <h1 className="text-3xl font-bold">
              {t.welcome}
            </h1>

            <p className="mt-3 text-[var(--premium-text-muted)]">
              {t.loginSubtitle}
            </p>
          </div>

          <form
            onSubmit={handleLogin}
            className="rounded-2xl border border-[var(--premium-border)] bg-[var(--premium-surface)] p-5 shadow-2xl sm:p-7"
          >
            <label htmlFor="login-email" className="text-sm font-medium">
              {t.email}
            </label>

            <input
              id="login-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com"
              required
              autoComplete="email"
              maxLength={254}
              className="mt-2 min-h-12 w-full rounded-xl border border-[var(--premium-border)] bg-[var(--premium-surface-muted)] px-4 py-3 text-[var(--premium-text)] outline-none focus:border-blue-500"
            />

            <label htmlFor="login-password" className="mt-5 block text-sm font-medium">
              {t.password}
            </label>

            <div className="relative mt-2">
              <input
                id="login-password"
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={t.enterPassword}
                required
                autoComplete="current-password"
                maxLength={1024}
                className="min-h-12 w-full rounded-xl border border-[var(--premium-border)] bg-[var(--premium-surface-muted)] px-4 py-3 pe-20 text-[var(--premium-text)] outline-none focus:border-blue-500"
              />

              <button
                type="button"
                onClick={() => setShowPassword((value) => !value)}
                aria-label={showPassword ? t.hide : t.show}
                className="absolute end-4 top-1/2 min-h-11 -translate-y-1/2 text-sm text-[var(--premium-text-muted)] hover:text-blue-500 focus-visible:outline-2 focus-visible:outline-blue-500"
              >
                {showPassword ? t.hide : t.show}
              </button>
            </div>

            <div className="mt-3 text-end">
              <Link href="/forgot-password" className="text-sm font-semibold text-blue-400 hover:text-blue-300">
                {t.forgot}
              </Link>
            </div>

            {errorMessage && (
              <div role="alert" aria-live="assertive" className="mt-5 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-400">
                {errorMessage}
              </div>
            )}

            {notice && (
              <div role="status" aria-live="polite" className="mt-5 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-400">
                {notice === "confirmed" ? t.confirmed : t.resetSuccess}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="mt-6 w-full rounded-xl bg-blue-600 py-3 font-semibold transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading ? <span role="status">{t.signingIn}</span> : t.signIn}
            </button>

            <p className="mt-6 text-center text-xs text-slate-500">
              {t.secureLogin}
            </p>
          </form>
          <div className="mt-5"><AuthPreferences locale={locale} onLocaleChange={setLocale} /></div>
        </div>
      </section>
    </main>
  );
}
