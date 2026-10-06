"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../../lib/supabase";

export default function InstallPage() {
  const router = useRouter();

  const [userId, setUserId] = useState("");
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    async function loadUser() {
      const {
        data: { user },
        error,
      } = await supabase.auth.getUser();

      if (error || !user) {
        router.replace("/login");
        return;
      }

      setUserId(user.id);
      setLoading(false);
    }

    loadUser();
  }, [router]);

  const installCode = `<script
  src="https://YOUR-DOMAIN.com/widget.js"
  data-agent-id="${userId}"
  async>
</script>`;

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(installCode);

      setCopied(true);

      setTimeout(() => {
        setCopied(false);
      }, 2000);
    } catch {
      alert("Could not copy the code.");
    }
  }

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-950 text-white">
        <p className="text-slate-400">
          Loading installation code...
        </p>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <div className="mx-auto max-w-5xl px-6 py-10">

        {/* Back */}
        <button
          type="button"
          onClick={() => router.push("/dashboard")}
          className="mb-8 text-sm font-medium text-blue-400 transition hover:text-blue-300"
        >
          ← Back to Dashboard
        </button>

        {/* Heading */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold">
            Install Chat Widget
          </h1>

          <p className="mt-2 max-w-2xl text-slate-400">
            Add AgentDesk AI to your website by copying
            the installation code below.
          </p>
        </div>

        {/* Main card */}
        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6 md:p-8">

          <div className="mb-8 flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-600 text-xl font-bold">
            &lt;/&gt;
          </div>

          <h2 className="text-2xl font-semibold">
            Website Installation
          </h2>

          <p className="mt-2 text-slate-400">
            Copy this code and paste it into your website
            before the closing &lt;/body&gt; tag.
          </p>

          {/* Code */}
          <div className="mt-8 overflow-hidden rounded-2xl border border-slate-700 bg-slate-950">

            <div className="flex items-center justify-between border-b border-slate-800 px-5 py-3">

              <div className="flex items-center gap-2">
                <span className="h-3 w-3 rounded-full bg-red-500"></span>
                <span className="h-3 w-3 rounded-full bg-yellow-500"></span>
                <span className="h-3 w-3 rounded-full bg-green-500"></span>
              </div>

              <span className="text-xs text-slate-500">
                HTML
              </span>

            </div>

            <pre className="overflow-x-auto p-5 text-sm leading-7 text-blue-300">
              <code>{installCode}</code>
            </pre>

          </div>

          {/* Copy */}
          <button
            type="button"
            onClick={copyCode}
            className={
              copied
                ? "mt-5 rounded-xl bg-green-600 px-6 py-3 font-semibold transition"
                : "mt-5 rounded-xl bg-blue-600 px-6 py-3 font-semibold transition hover:bg-blue-500"
            }
          >
            {copied ? "Copied ✓" : "Copy Code"}
          </button>

          {/* Instructions */}
          <div className="mt-10 border-t border-slate-800 pt-8">

            <h3 className="text-lg font-semibold">
              Installation Instructions
            </h3>

            <div className="mt-6 space-y-5">

              <div className="flex gap-4">

                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-600 font-semibold">
                  1
                </div>

                <div>
                  <p className="font-medium">
                    Copy your installation code
                  </p>

                  <p className="mt-1 text-sm text-slate-400">
                    Click the Copy Code button above.
                  </p>
                </div>

              </div>

              <div className="flex gap-4">

                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-600 font-semibold">
                  2
                </div>

                <div>
                  <p className="font-medium">
                    Open your website code
                  </p>

                  <p className="mt-1 text-sm text-slate-400">
                    Open the HTML or layout file used by
                    your website.
                  </p>
                </div>

              </div>

              <div className="flex gap-4">

                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-600 font-semibold">
                  3
                </div>

                <div>
                  <p className="font-medium">
                    Paste before &lt;/body&gt;
                  </p>

                  <p className="mt-1 text-sm text-slate-400">
                    Paste the AgentDesk AI installation
                    code before the closing body tag.
                  </p>
                </div>

              </div>

              <div className="flex gap-4">

                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-green-600 font-semibold">
                  ✓
                </div>

                <div>
                  <p className="font-medium">
                    Your AI agent is ready
                  </p>

                  <p className="mt-1 text-sm text-slate-400">
                    After the website is published, your
                    chat widget will appear on the website.
                  </p>
                </div>

              </div>

            </div>
          </div>

          {/* Important */}
          <div className="mt-10 rounded-xl border border-blue-500/30 bg-blue-500/10 p-5">

            <p className="font-medium text-blue-300">
              AgentDesk AI Widget
            </p>

            <p className="mt-2 text-sm leading-6 text-slate-400">
              Your installation code contains your unique
              Agent ID. Each AgentDesk AI account receives
              its own installation code.
            </p>

          </div>

        </div>

      </div>
    </main>
  );
}