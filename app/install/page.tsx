"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

export default function InstallPage() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState("");
  const [copied, setCopied] = useState(false);

  const widgetUrl =
    "https://musical-sunflower-fb3106.netlify.app/widget.js";

  useEffect(() => {
    const loadUser = async () => {
      const {
        data: { user },
        error,
      } = await supabase.auth.getUser();

      if (error || !user) {
        router.push("/login");
        return;
      }

      setUserId(user.id);
      setLoading(false);
    };

    loadUser();
  }, [router]);

  const installCode = `<script
  src="${widgetUrl}"
  data-agent-id="${userId}"
  async>
</script>`;

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(installCode);

      setCopied(true);

      setTimeout(() => {
        setCopied(false);
      }, 2000);
    } catch (error) {
      console.error("Could not copy widget code:", error);
    }
  };

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-950 text-white">
        <p className="text-slate-400">
          Loading...
        </p>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-950 px-6 py-10 text-white">
      <div className="mx-auto max-w-5xl">

        {/* Header */}
        <div className="mb-10 flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wider text-blue-500">
              Website Widget
            </p>

            <h1 className="mt-2 text-3xl font-bold">
              Install AgentDesk AI
            </h1>

            <p className="mt-3 max-w-2xl text-slate-400">
              Add your AI customer support assistant to your
              website by copying the code below.
            </p>
          </div>

          <button
            onClick={() => router.push("/dashboard")}
            className="rounded-xl border border-slate-700 px-5 py-3 text-sm font-semibold text-slate-300 transition hover:bg-slate-900 hover:text-white"
          >
            ← Back to Dashboard
          </button>
        </div>

        {/* Main Card */}
        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6 md:p-8">

          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-blue-600 text-xl">
              💬
            </div>

            <div>
              <h2 className="text-xl font-semibold">
                Install your chat widget
              </h2>

              <p className="mt-2 leading-7 text-slate-400">
                Copy this code and paste it before the closing
                &lt;/body&gt; tag on your website.
              </p>
            </div>
          </div>

          {/* Code */}
          <div className="mt-8 overflow-hidden rounded-xl border border-slate-700 bg-slate-950">
            <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
              <span className="text-sm font-medium text-slate-400">
                HTML
              </span>

              <button
                onClick={copyCode}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold transition hover:bg-blue-500"
              >
                {copied ? "Copied ✓" : "Copy Code"}
              </button>
            </div>

            <pre className="overflow-x-auto p-5 text-sm leading-7 text-slate-300">
              <code>{installCode}</code>
            </pre>
          </div>

          {/* Instructions */}
          <div className="mt-8">
            <h3 className="text-lg font-semibold">
              Installation steps
            </h3>

            <div className="mt-5 space-y-4">

              <div className="flex gap-4 rounded-xl border border-slate-800 bg-slate-950/50 p-4">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-600 text-sm font-bold">
                  1
                </div>

                <div>
                  <p className="font-medium">
                    Copy the widget code
                  </p>

                  <p className="mt-1 text-sm text-slate-400">
                    Click the Copy Code button above.
                  </p>
                </div>
              </div>

              <div className="flex gap-4 rounded-xl border border-slate-800 bg-slate-950/50 p-4">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-600 text-sm font-bold">
                  2
                </div>

                <div>
                  <p className="font-medium">
                    Open your website HTML
                  </p>

                  <p className="mt-1 text-sm text-slate-400">
                    Open the page where you want the AgentDesk AI
                    chat widget to appear.
                  </p>
                </div>
              </div>

              <div className="flex gap-4 rounded-xl border border-slate-800 bg-slate-950/50 p-4">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-600 text-sm font-bold">
                  3
                </div>

                <div>
                  <p className="font-medium">
                    Paste before &lt;/body&gt;
                  </p>

                  <p className="mt-1 text-sm text-slate-400">
                    Paste the copied code just before your website&apos;s
                    closing &lt;/body&gt; tag.
                  </p>
                </div>
              </div>

              <div className="flex gap-4 rounded-xl border border-slate-800 bg-slate-950/50 p-4">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-green-600 text-sm font-bold">
                  ✓
                </div>

                <div>
                  <p className="font-medium">
                    Publish your website
                  </p>

                  <p className="mt-1 text-sm text-slate-400">
                    Save and publish the website. Your AI chat
                    assistant should then appear automatically.
                  </p>
                </div>
              </div>

            </div>
          </div>
        </div>

        {/* Important Note */}
        <div className="mt-6 rounded-2xl border border-blue-500/20 bg-blue-500/10 p-5">
          <p className="font-semibold text-blue-400">
            Your widget is connected automatically
          </p>

          <p className="mt-2 text-sm leading-6 text-slate-400">
            This installation code is connected to your AgentDesk AI
            account. Your business information, knowledge base,
            widget customization and AI Agent settings will be used
            automatically.
          </p>
        </div>

      </div>
    </main>
  );
}