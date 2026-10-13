"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { isBoundedText, isValidEmail } from "@/lib/client-security";

export default function AdminLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function checkRole(token: string) {
    const response = await fetch("/api/admin?section=overview", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
    const body = await response.json().catch(() => ({}));
    if (response.ok) return "/admin";
    if (body.code === "MFA_REQUIRED" || body.code === "MFA_SETUP_REQUIRED") return "/admin/mfa";
    throw new Error(body.code === "ADMIN_MIGRATION_REQUIRED" ? "Administrator access is not configured yet." : "This account is not authorized for platform administration.");
  }

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loading) return;
    setError("");
    if (!isValidEmail(email.trim()) || !password || !isBoundedText(password, 1024)) { setError("Enter a valid email address and password."); return; }
    setLoading(true);
    try {
      const { data, error: authError } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      setPassword("");
      if (authError || !data.session) throw new Error("Sign-in failed. Check your credentials and email verification.");
      const destination = await checkRole(data.session.access_token);
      router.replace(destination);
    } catch (reason) {
      await supabase.auth.signOut({ scope: "local" });
      setError(reason instanceof Error ? reason.message : "Administrator sign-in failed.");
    } finally { setLoading(false); }
  }

  return <main className="min-h-screen bg-[#07101f] px-5 py-10 text-white">
    <div className="mx-auto flex max-w-6xl items-center justify-between"><Link href="/" className="text-xl font-bold">AgentDesk <span className="text-blue-400">AI</span></Link><span className="rounded-full border border-blue-400/30 bg-blue-400/10 px-3 py-1 text-xs font-semibold text-blue-300">Super Admin</span></div>
    <section className="mx-auto grid min-h-[78vh] max-w-6xl items-center gap-10 lg:grid-cols-2">
      <div className="hidden lg:block"><p className="text-sm font-semibold uppercase tracking-[.22em] text-blue-400">Platform control center</p><h1 className="mt-5 max-w-xl text-5xl font-bold leading-tight">Secure visibility across AgentDesk AI.</h1><p className="mt-5 max-w-lg text-lg leading-8 text-slate-400">A separate, audited administration surface protected by role checks and mandatory multi-factor authentication.</p></div>
      <form onSubmit={signIn} className="mx-auto w-full max-w-md rounded-3xl border border-white/10 bg-white/[.06] p-7 shadow-2xl backdrop-blur sm:p-9">
        <div className="mb-7"><div className="mb-5 grid h-12 w-12 place-items-center rounded-2xl bg-blue-600 font-black">AD</div><h2 className="text-2xl font-bold">Administrator sign in</h2><p className="mt-2 text-sm text-slate-400">Use your verified Supabase account. MFA is required.</p></div>
        <label className="text-sm font-medium">Email address</label><input type="email" autoComplete="email" maxLength={254} required value={email} onChange={e=>setEmail(e.target.value)} className="mt-2 w-full rounded-xl border border-white/10 bg-slate-950/70 px-4 py-3 outline-none focus:border-blue-500" placeholder="admin@example.com"/>
        <label className="mt-5 block text-sm font-medium">Password</label><input type="password" autoComplete="current-password" maxLength={1024} required value={password} onChange={e=>setPassword(e.target.value)} className="mt-2 w-full rounded-xl border border-white/10 bg-slate-950/70 px-4 py-3 outline-none focus:border-blue-500" placeholder="Your password"/>
        {error&&<p role="alert" className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">{error}</p>}
        <button disabled={loading} className="mt-6 w-full rounded-xl bg-blue-600 py-3 font-semibold hover:bg-blue-500 disabled:opacity-60">{loading?"Verifying…":"Continue securely"}</button>
        <Link href="/forgot-password" className="mt-4 block min-h-11 w-full text-center text-sm text-blue-300 hover:text-blue-200">Forgot password?</Link>
        <p className="mt-6 text-center text-xs text-slate-500">No public administrator registration is available.</p>
      </form>
    </section>
  </main>;
}
