"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../../lib/supabase";

export default function LoginPage() {
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  async function handleLogin(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();

    setErrorMessage("");
    setLoading(true);

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (error) {
        setErrorMessage(error.message);
        return;
      }

      if (!data.session) {
        setErrorMessage("Login failed. No session was created.");
        return;
      }

      router.push("/dashboard");
    } catch (error) {
      console.error(error);
      setErrorMessage("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <nav className="mx-auto flex max-w-7xl items-center justify-between px-6 py-6">
        <Link href="/" className="text-2xl font-bold">
          AgentDesk <span className="text-blue-500">AI</span>
        </Link>

        <p className="text-sm text-slate-400">
          Don&apos;t have an account?{" "}
          <Link href="/register" className="font-semibold text-blue-400">
            Start Free
          </Link>
        </p>
      </nav>

      <section className="flex min-h-[80vh] items-center justify-center px-6">
        <div className="w-full max-w-md">

          <div className="mb-8 text-center">
            <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-600 text-xl font-bold">
              AI
            </div>

            <h1 className="text-3xl font-bold">
              Welcome back
            </h1>

            <p className="mt-3 text-slate-400">
              Sign in to manage your AI support agent.
            </p>
          </div>

          <form
            onSubmit={handleLogin}
            className="rounded-2xl border border-slate-800 bg-slate-900 p-7 shadow-2xl"
          >
            <label className="text-sm font-medium">
              Email address
            </label>

            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com"
              required
              autoComplete="email"
              className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-white outline-none focus:border-blue-500"
            />

            <label className="mt-5 block text-sm font-medium">
              Password
            </label>

            <div className="relative mt-2">
              <input
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter your password"
                required
                autoComplete="current-password"
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 pr-20 text-white outline-none focus:border-blue-500"
              />

              <button
                type="button"
                onClick={() => setShowPassword((value) => !value)}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-sm text-slate-400 hover:text-white"
              >
                {showPassword ? "Hide" : "Show"}
              </button>
            </div>

            {errorMessage && (
              <div className="mt-5 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-400">
                {errorMessage}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="mt-6 w-full rounded-xl bg-blue-600 py-3 font-semibold transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading ? "Signing in..." : "Sign In"}
            </button>

            <p className="mt-6 text-center text-xs text-slate-500">
              Secure login • AgentDesk AI
            </p>
          </form>
        </div>
      </section>
    </main>
  );
}