"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../../lib/supabase";

export default function InstallPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [publicAgentId, setPublicAgentId] = useState("");
  const [widgetUrl, setWidgetUrl] = useState("");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [copied, setCopied] = useState(false);
  const [isInstalled, setIsInstalled] = useState(false);
  const [verifiedThisVisit, setVerifiedThisVisit] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [message, setMessage] = useState("");
  const [messageType, setMessageType] = useState<"success" | "error" | "">("");

  const installCode = `<script
  src="${widgetUrl}"
  data-agent-id="${publicAgentId}"
  async>
</script>`;

  useEffect(() => {
    let cancelled = false;
    async function loadPage() {
      try {
        const { data: { user }, error: userError } = await supabase.auth.getUser();
        if (cancelled) return;
        if (userError || !user) {
          router.replace("/login");
          return;
        }

        const [agentResult, widgetResult, installationResponse] = await Promise.all([
          supabase.from("agent_settings").select("public_agent_id").eq("user_id", user.id).maybeSingle(),
          supabase.from("widget_settings").select("is_installed").eq("user_id", user.id).maybeSingle(),
          fetch("/api/verify-installation", { cache: "no-store", signal: AbortSignal.timeout(10000) }),
        ]);
        if (cancelled) return;

        if (installationResponse.ok) {
          const installationConfig = await installationResponse.json();
          if (typeof installationConfig.widgetUrl === "string") setWidgetUrl(installationConfig.widgetUrl);
        } else {
          setMessage("Installation is temporarily unavailable. Please contact support.");
          setMessageType("error");
        }

        if (agentResult.error || !agentResult.data?.public_agent_id) {
          setMessage("Could not load your Public Agent ID. Please check Agent settings.");
          setMessageType("error");
        } else {
          setPublicAgentId(agentResult.data.public_agent_id);
        }
        if (widgetResult.error) {
          setMessage("Could not load the saved installation status. Please refresh the page.");
          setMessageType("error");
        } else {
          setIsInstalled(widgetResult.data?.is_installed === true);
        }
      } catch {
        if (!cancelled) {
          setMessage("Could not load the installation page. Please try again.");
          setMessageType("error");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void loadPage();
    return () => { cancelled = true; };
  }, [router]);

  async function handleCopy() {
    if (!publicAgentId || !widgetUrl) return;
    try {
      await navigator.clipboard.writeText(installCode);
      setCopied(true);
      setMessage("");
      setMessageType("");
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setMessage("Could not copy the installation code. Select and copy it manually.");
      setMessageType("error");
    }
  }

  async function handleVerifyInstallation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (verifying || !publicAgentId || !websiteUrl.trim()) return;
    setVerifying(true);
    setMessage("");
    setMessageType("");
    try {
      const { data, error } = await supabase.auth.getSession();
      const accessToken = data.session?.access_token;
      if (error || !accessToken) {
        setMessage("Your session has expired. Please sign in again.");
        setMessageType("error");
        return;
      }

      const response = await fetch("/api/verify-installation", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ websiteUrl: websiteUrl.trim() }),
        signal: AbortSignal.timeout(20000),
      });
      const result = await response.json();
      if (response.ok && result.verified === true) {
        setIsInstalled(true);
        setVerifiedThisVisit(true);
        setMessage("Widget detected! Installation verified and saved successfully.");
        setMessageType("success");
      } else {
        setMessage(result.error || "Could not verify the installation. Please try again.");
        setMessageType("error");
      }
    } catch {
      setMessage("Could not verify the website. Please try again.");
      setMessageType("error");
    } finally {
      setVerifying(false);
    }
  }

  if (loading) {
    return <main className="flex min-h-screen items-center justify-center bg-slate-950 text-white"><p className="text-slate-400">Loading installation page...</p></main>;
  }

  return (
    <main className="min-h-screen bg-slate-950 px-5 py-10 text-white">
      <div className="mx-auto max-w-4xl">
        <button type="button" onClick={() => router.push("/dashboard")} className="mb-6 text-sm text-slate-400 transition hover:text-white">← Back to Dashboard</button>

        <div className="mb-8">
          <h1 className="text-3xl font-bold">Install Website Widget</h1>
          <p className="mt-3 max-w-2xl text-slate-400">Add AgentDesk AI to your website, then automatically check your widget installation.</p>
        </div>

        <div className="mb-6 rounded-2xl border border-slate-800 bg-slate-900 p-6">
          <p className="text-sm text-slate-400">Installation Status</p>
          <p className={`mt-2 text-lg font-semibold ${isInstalled ? "text-green-400" : "text-yellow-400"}`}>
            {verifiedThisVisit ? "✓ Installation Verified" : isInstalled ? "✓ Installation saved" : "● Not Verified"}
          </p>
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div><h2 className="text-xl font-semibold">Installation Code</h2><p className="mt-1 text-sm text-slate-400">Copy this code and paste it into your website.</p></div>
            <button type="button" onClick={handleCopy} disabled={!publicAgentId || !widgetUrl} className="rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50">{copied ? "Copied ✓" : "Copy Code"}</button>
          </div>
          <div className="mt-5 overflow-x-auto rounded-xl border border-slate-800 bg-slate-950 p-5"><pre className="text-sm leading-7 text-slate-300"><code>{publicAgentId && widgetUrl ? installCode : "Installation code is unavailable."}</code></pre></div>
        </div>

        <div className="mt-6 rounded-2xl border border-slate-800 bg-slate-900 p-6">
          <h2 className="text-xl font-semibold">Installation Steps</h2>
          <ol className="mt-5 list-inside list-decimal space-y-4 text-sm text-slate-300">
            <li>Copy the installation code.</li>
            <li>Paste it before your website&apos;s closing &lt;/body&gt; tag.</li>
            <li>Publish the website and check that the chat button appears.</li>
            <li>Enter the published page URL below and verify it.</li>
          </ol>
          <p className="mt-5 text-sm text-slate-400">For a public website, use the installation code from your deployed AgentDesk app. A localhost widget URL works only on your computer.</p>
        </div>

        <form onSubmit={handleVerifyInstallation} className="mt-6 rounded-2xl border border-slate-800 bg-slate-900 p-6">
          <h2 className="text-xl font-semibold">Automatic Installation Verification</h2>
          <p className="mt-2 text-sm leading-6 text-slate-400">We check the published page for the AgentDesk widget script and your Public Agent ID, and check your Domain Allowlist.</p>
          <label htmlFor="website-url" className="mt-5 block text-sm font-medium text-slate-300">Website URL</label>
          <input id="website-url" type="text" required value={websiteUrl} disabled={verifying} onChange={(event) => { setWebsiteUrl(event.target.value); setMessage(""); setMessageType(""); }} placeholder="https://example.com" autoComplete="url" className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-white outline-none transition placeholder:text-slate-600 focus:border-blue-500 disabled:opacity-60" />
          <p className="mt-3 text-sm text-slate-400">Place the script directly in the page HTML. Scripts added later by JavaScript or a tag manager cannot be detected by this check.</p>
          <button type="submit" disabled={verifying || !publicAgentId || !widgetUrl || !websiteUrl.trim()} className="mt-5 rounded-xl bg-blue-600 px-6 py-3 font-semibold text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-60">{verifying ? "Checking Website..." : "Verify Installation"}</button>
          {message && <p role={messageType === "error" ? "alert" : "status"} className={`mt-4 text-sm ${messageType === "success" ? "text-green-400" : "text-red-400"}`}>{message}</p>}
        </form>

        {isInstalled && <div className="mt-6 rounded-2xl border border-green-900/50 bg-green-950/20 p-6"><p className="text-sm text-slate-400">Your saved installation status is available on the dashboard.</p><button type="button" onClick={() => router.push("/dashboard")} className="mt-5 rounded-xl bg-green-600 px-5 py-3 text-sm font-semibold transition hover:bg-green-500">Go to Dashboard</button></div>}
      </div>
    </main>
  );
}
