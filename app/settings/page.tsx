"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

export default function SettingsPage() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState("");
  const [userId, setUserId] = useState("");

  useEffect(() => {
    loadAccount();
  }, []);

  async function loadAccount() {
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      router.push("/login");
      return;
    }

    setEmail(user.email || "");
    setUserId(user.id);
    setLoading(false);
  }

  async function signOut() {
    await supabase.auth.signOut();
    router.push("/login");
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-slate-950 flex items-center justify-center text-white">
        <p className="text-slate-400">
          Loading settings...
        </p>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <div className="max-w-5xl mx-auto px-6 py-10">

        {/* Header */}
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between mb-10">
          <div>
            <p className="text-blue-400 font-semibold mb-2">
              AgentDesk AI
            </p>

            <h1 className="text-3xl font-bold">
              Settings
            </h1>

            <p className="text-slate-400 mt-2">
              Manage your AgentDesk AI account and workspace.
            </p>
          </div>

          <button
            onClick={() => router.push("/dashboard")}
            className="px-5 py-2.5 rounded-xl border border-slate-700 bg-slate-900 hover:bg-slate-800 transition"
          >
            Back to Dashboard
          </button>
        </div>

        <div className="space-y-6">

          {/* Account */}
          <section className="rounded-2xl border border-slate-800 bg-slate-900 p-6">
            <h2 className="text-xl font-semibold">
              Account
            </h2>

            <p className="text-sm text-slate-400 mt-1 mb-6">
              Your AgentDesk AI account information.
            </p>

            <div className="space-y-5">
              <div>
                <label className="block text-sm text-slate-400 mb-2">
                  Email Address
                </label>

                <div className="rounded-xl border border-slate-700 bg-slate-950 px-4 py-3">
                  {email}
                </div>
              </div>

              <div>
                <label className="block text-sm text-slate-400 mb-2">
                  Account ID
                </label>

                <div className="rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm text-slate-300 break-all">
                  {userId}
                </div>
              </div>
            </div>
          </section>

          {/* Business */}
          <section className="rounded-2xl border border-slate-800 bg-slate-900 p-6">
            <h2 className="text-xl font-semibold">
              Business Information
            </h2>

            <p className="text-sm text-slate-400 mt-1 mb-5">
              Manage the information your AI uses about your business.
            </p>

            <button
              onClick={() => router.push("/business")}
              className="px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 font-semibold transition"
            >
              Manage Business Information
            </button>
          </section>

          {/* AI Agent */}
          <section className="rounded-2xl border border-slate-800 bg-slate-900 p-6">
            <h2 className="text-xl font-semibold">
              AI Agent
            </h2>

            <p className="text-sm text-slate-400 mt-1 mb-5">
              Configure your AI Agent status, tone and custom instructions.
            </p>

            <button
              onClick={() => router.push("/agent")}
              className="px-5 py-2.5 rounded-xl border border-slate-700 bg-slate-950 hover:bg-slate-800 font-semibold transition"
            >
              Manage AI Agent
            </button>
          </section>

          {/* Widget */}
          <section className="rounded-2xl border border-slate-800 bg-slate-900 p-6">
            <h2 className="text-xl font-semibold">
              Website Widget
            </h2>

            <p className="text-sm text-slate-400 mt-1 mb-5">
              Customize your support widget or get the installation code.
            </p>

            <div className="flex flex-wrap gap-3">
              <button
                onClick={() => router.push("/widget")}
                className="px-5 py-2.5 rounded-xl border border-slate-700 bg-slate-950 hover:bg-slate-800 font-semibold transition"
              >
                Customize Widget
              </button>

              <button
                onClick={() => router.push("/install")}
                className="px-5 py-2.5 rounded-xl border border-slate-700 bg-slate-950 hover:bg-slate-800 font-semibold transition"
              >
                Installation Code
              </button>
            </div>
          </section>

          {/* Knowledge */}
          <section className="rounded-2xl border border-slate-800 bg-slate-900 p-6">
            <h2 className="text-xl font-semibold">
              Knowledge Base
            </h2>

            <p className="text-sm text-slate-400 mt-1 mb-5">
              Add and manage information used by your AI Agent.
            </p>

            <button
              onClick={() => router.push("/knowledge")}
              className="px-5 py-2.5 rounded-xl border border-slate-700 bg-slate-950 hover:bg-slate-800 font-semibold transition"
            >
              Manage Knowledge
            </button>
          </section>

          {/* Sign Out */}
          <section className="rounded-2xl border border-red-900/50 bg-red-950/20 p-6">
            <h2 className="text-xl font-semibold">
              Sign Out
            </h2>

            <p className="text-sm text-slate-400 mt-1 mb-5">
              Sign out of your AgentDesk AI account on this device.
            </p>

            <button
              onClick={signOut}
              className="px-5 py-2.5 rounded-xl bg-red-600 hover:bg-red-500 font-semibold transition"
            >
              Sign Out
            </button>
          </section>

        </div>
      </div>
    </main>
  );
}