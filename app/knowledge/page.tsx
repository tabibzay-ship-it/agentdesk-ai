"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../../lib/supabase";
import { isBoundedText } from "../../lib/client-security";

export default function KnowledgePage() {
  const router = useRouter();

  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(false);
  const [checkingUser, setCheckingUser] = useState(true);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    async function checkUser() {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        router.replace("/login");
        return;
      }

      setCheckingUser(false);
    }

    checkUser();
  }, [router]);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (loading) return;

    setMessage("");
    setError("");

    if (!title.trim() || !content.trim()) {
      setError("Please enter a title and knowledge content.");
      return;
    }

    if (!isBoundedText(title.trim(), 200) || !isBoundedText(content.trim(), 200000)) {
      setError("Use a title up to 200 characters and knowledge content up to 200,000 characters.");
      return;
    }

    setLoading(true);

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      setLoading(false);
      router.replace("/login");
      return;
    }

    const { error: insertError } = await supabase
      .from("knowledge_sources")
      .insert({
        user_id: user.id,
        title: title.trim(),
        content: content.trim(),
      });

    if (insertError) {
      setError("Could not save knowledge. Please check the content and try again.");
      setLoading(false);
      return;
    }

    setTitle("");
    setContent("");
    setMessage("Knowledge added successfully!");
    setLoading(false);
  }

  if (checkingUser) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-950 text-white">
        <p className="text-slate-400">Loading AgentDesk AI...</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-950 px-6 py-10 text-white">
      <div className="mx-auto max-w-4xl">

        <button
          type="button"
          onClick={() => router.push("/dashboard")}
          className="mb-8 text-sm font-medium text-blue-400 hover:text-blue-300"
        >
          ← Back to Dashboard
        </button>

        <div className="mb-8">
          <h1 className="text-3xl font-bold">Knowledge Base</h1>

          <p className="mt-2 text-slate-400">
            Add information your AI support agent can use to answer customers.
          </p>
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6 md:p-8">

          <div className="mb-7">
            <h2 className="text-xl font-semibold">
              Add Knowledge
            </h2>

            <p className="mt-2 text-sm text-slate-400">
              Add FAQs, company information, services, policies, or other
              information about your business.
            </p>
          </div>

          {error && (
            <div className="mb-6 rounded-xl border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-400">
              {error}
            </div>
          )}

          {message && (
            <div className="mb-6 rounded-xl border border-green-500/40 bg-green-500/10 p-4 text-sm text-green-400">
              {message}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-6">

            <div>
              <label className="mb-2 block text-sm font-medium">
                Knowledge title
              </label>

              <input
                type="text"
                value={title}
                maxLength={200}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Example: Internet Packages"
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 outline-none transition focus:border-blue-500"
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium">
                Information
              </label>

              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="Enter information that your AI agent should know..."
                rows={12}
                maxLength={200000}
                className="w-full resize-none rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 outline-none transition focus:border-blue-500"
              />
            </div>

            <div className="rounded-xl border border-slate-800 bg-slate-950 p-4">
              <p className="text-sm font-medium">
                Example
              </p>

              <p className="mt-2 text-sm leading-6 text-slate-400">
                Our company provides internet services. Our support hours are
                8:00 AM to 8:00 PM. Customers can contact our support team for
                package information, technical problems, and account support.
              </p>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-xl bg-blue-600 px-5 py-3 font-semibold transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading ? "Saving..." : "Add to Knowledge Base"}
            </button>

          </form>
        </div>
      </div>
    </main>
  );
}
