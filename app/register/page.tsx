"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../../lib/supabase";

export default function RegisterPage() {
  const router = useRouter();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  async function handleRegister(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();

    setMessage("");
    setErrorMessage("");

    if (!fullName.trim()) {
      setErrorMessage("Please enter your full name.");
      return;
    }

    if (password.length < 8) {
      setErrorMessage("Password must be at least 8 characters.");
      return;
    }

    setLoading(true);

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: fullName.trim(),
        },
      },
    });

    setLoading(false);

    if (error) {
      setErrorMessage(error.message);
      return;
    }

    if (data.session) {
      router.replace("/dashboard");
      return;
    } else {
      setMessage(
        "Account created! Please check your email and confirm your account."
      );
    }

    setFullName("");
    setEmail("");
    setPassword("");
  }

  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <nav className="mx-auto flex max-w-7xl items-center justify-between px-6 py-6">
        <Link href="/" className="text-2xl font-bold">
          AgentDesk <span className="text-blue-500">AI</span>
        </Link>

        <p className="text-sm text-slate-400">
          Already have an account?{" "}
          <Link href="/login" className="font-semibold text-blue-400">
            Sign In
          </Link>
        </p>
      </nav>

      <section className="flex items-center justify-center px-6 py-10">
        <div className="w-full max-w-md">
          <div className="mb-8 text-center">
            <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-600 text-xl font-bold">
              AI
            </div>

            <h1 className="text-3xl font-bold">Create your account</h1>

            <p className="mt-3 text-slate-400">
              Start building your AI support agent for free.
            </p>
          </div>

          <form
            onSubmit={handleRegister}
            className="rounded-2xl border border-slate-800 bg-slate-900 p-7 shadow-2xl"
          >
            <label className="text-sm font-medium">Full name</label>

            <input
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="John Smith"
              required
              autoComplete="name"
              className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 outline-none focus:border-blue-500"
            />

            <label className="mt-5 block text-sm font-medium">
              Email address
            </label>

            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com"
              required
              autoComplete="email"
              className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 outline-none focus:border-blue-500"
            />

            <label className="mt-5 block text-sm font-medium">Password</label>

            <div className="relative mt-2">
              <input
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Create a strong password"
                required
                minLength={8}
                autoComplete="new-password"
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 pr-16 outline-none focus:border-blue-500"
              />

              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-4 top-3 text-sm text-slate-400 hover:text-white"
              >
                {showPassword ? "Hide" : "Show"}
              </button>
            </div>

            <p className="mt-2 text-xs text-slate-500">
              Use at least 8 characters.
            </p>

            {errorMessage && (
              <div className="mt-5 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-400">
                {errorMessage}
              </div>
            )}

            {message && (
              <div className="mt-5 rounded-xl border border-green-500/30 bg-green-500/10 p-3 text-sm text-green-400">
                {message}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="mt-6 w-full rounded-xl bg-blue-600 py-3 font-semibold transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading ? "Creating account..." : "Create Free Account"}
            </button>

          </form>
        </div>
      </section>
    </main>
  );
}
