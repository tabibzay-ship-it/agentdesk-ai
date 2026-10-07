"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../../lib/supabase";

export default function InstallPage() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState("");
  const [publicAgentId, setPublicAgentId] =
    useState("");

  const [copied, setCopied] = useState(false);
  const [isInstalled, setIsInstalled] =
    useState(false);

  const [verifying, setVerifying] =
    useState(false);

  const [message, setMessage] = useState("");

  const widgetUrl =
    "https://musical-sunflower-fb3106.netlify.app/widget.js";

  // =========================================
  // INSTALLATION CODE
  // Uses PUBLIC Agent ID only
  // =========================================

  const installCode = `<script
  src="${widgetUrl}"
  data-agent-id="${publicAgentId}"
  async>
</script>`;

  // =========================================
  // LOAD PAGE
  // =========================================

  useEffect(() => {
    async function loadPage() {
      try {
        // =====================================
        // AUTH USER
        // =====================================

        const {
          data: { user },
          error: userError,
        } = await supabase.auth.getUser();

        if (userError || !user) {
          router.replace("/login");
          return;
        }

        setUserId(user.id);

        // =====================================
        // LOAD PUBLIC AGENT ID
        // =====================================

        const {
          data: agentSettings,
          error: agentError,
        } = await supabase
          .from("agent_settings")
          .select("public_agent_id")
          .eq("user_id", user.id)
          .maybeSingle();

        if (agentError) {
          console.error(
            "Public Agent ID load error:",
            agentError
          );

          setMessage(
            "Could not load Public Agent ID."
          );
        } else if (
          agentSettings?.public_agent_id
        ) {
          setPublicAgentId(
            agentSettings.public_agent_id
          );
        } else {
          setMessage(
            "Public Agent ID is not available."
          );
        }

        // =====================================
        // LOAD INSTALLATION STATUS
        // =====================================

        const {
          data: settings,
          error: settingsError,
        } = await supabase
          .from("widget_settings")
          .select("is_installed")
          .eq("user_id", user.id)
          .maybeSingle();

        if (settingsError) {
          console.error(
            "Widget installation status error:",
            settingsError
          );
        }

        if (!settingsError && settings) {
          setIsInstalled(
            settings.is_installed === true
          );
        }
      } catch (error) {
        console.error(
          "Installation page load error:",
          error
        );

        setMessage(
          "Could not load the installation page."
        );
      } finally {
        setLoading(false);
      }
    }

    loadPage();
  }, [router]);

  // =========================================
  // COPY INSTALLATION CODE
  // =========================================

  async function handleCopy() {
    if (!publicAgentId) {
      setMessage(
        "Public Agent ID is not available."
      );
      return;
    }

    try {
      await navigator.clipboard.writeText(
        installCode
      );

      setCopied(true);
      setMessage("");

      setTimeout(() => {
        setCopied(false);
      }, 2000);
    } catch (error) {
      console.error(
        "Could not copy installation code:",
        error
      );

      setMessage(
        "Could not copy the installation code."
      );
    }
  }

  // =========================================
  // VERIFY INSTALLATION
  // =========================================

  async function handleVerifyInstallation() {
    if (!userId) {
      return;
    }

    setVerifying(true);
    setMessage("");

    try {
      /*
        IMPORTANT:

        At this stage this button manually confirms
        that the user has installed and tested the
        website widget.

        Automatic domain verification can be added
        later.
      */

      const {
        data,
        error,
      } = await supabase
        .from("widget_settings")
        .update({
          is_installed: true,
          updated_at: new Date().toISOString(),
        })
        .eq("user_id", userId)
        .select("is_installed")
        .single();

      if (error) {
        console.error(
          "Installation verification error:",
          error
        );

        setMessage(
          "Could not verify installation. Please try again."
        );

        return;
      }

      if (data?.is_installed === true) {
        setIsInstalled(true);

        setMessage(
          "Widget installation confirmed successfully!"
        );
      }
    } catch (error) {
      console.error(
        "Verification error:",
        error
      );

      setMessage(
        "Something went wrong. Please try again."
      );
    } finally {
      setVerifying(false);
    }
  }

  // =========================================
  // LOADING
  // =========================================

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-950 text-white">
        <p className="text-slate-400">
          Loading installation page...
        </p>
      </main>
    );
  }

  // =========================================
  // PAGE
  // =========================================

  return (
    <main className="min-h-screen bg-slate-950 px-5 py-10 text-white">
      <div className="mx-auto max-w-4xl">

        {/* Back Button */}

        <button
          type="button"
          onClick={() =>
            router.push("/dashboard")
          }
          className="mb-6 text-sm text-slate-400 transition hover:text-white"
        >
          ← Back to Dashboard
        </button>

        {/* Header */}

        <div className="mb-8">
          <h1 className="text-3xl font-bold">
            Install Website Widget
          </h1>

          <p className="mt-3 max-w-2xl text-slate-400">
            Add AgentDesk AI to your website by
            copying the code below and placing it
            before the closing body tag of your
            website.
          </p>
        </div>

        {/* Installation Status */}

        <div className="mb-6 rounded-2xl border border-slate-800 bg-slate-900 p-6">
          <div className="flex flex-wrap items-center justify-between gap-4">

            <div>
              <p className="text-sm text-slate-400">
                Installation Status
              </p>

              {isInstalled ? (
                <p className="mt-2 text-lg font-semibold text-green-400">
                  ✓ Installation Completed
                </p>
              ) : (
                <p className="mt-2 text-lg font-semibold text-yellow-400">
                  ● Pending Installation
                </p>
              )}
            </div>

            {isInstalled && (
              <div className="rounded-full bg-green-500/10 px-4 py-2 text-sm font-medium text-green-400">
                Active
              </div>
            )}
          </div>
        </div>

        {/* Installation Code */}

        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6">
          <div className="flex flex-wrap items-center justify-between gap-4">

            <div>
              <h2 className="text-xl font-semibold">
                Installation Code
              </h2>

              <p className="mt-1 text-sm text-slate-400">
                Copy this code and paste it into
                your website.
              </p>
            </div>

            <button
              type="button"
              onClick={handleCopy}
              disabled={!publicAgentId}
              className="rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {copied
                ? "Copied ✓"
                : "Copy Code"}
            </button>
          </div>

          <div className="mt-5 overflow-x-auto rounded-xl border border-slate-800 bg-slate-950 p-5">
            <pre className="text-sm leading-7 text-slate-300">
              <code>
                {publicAgentId
                  ? installCode
                  : "Loading Public Agent ID..."}
              </code>
            </pre>
          </div>
        </div>

        {/* Steps */}

        <div className="mt-6 rounded-2xl border border-slate-800 bg-slate-900 p-6">
          <h2 className="text-xl font-semibold">
            Installation Steps
          </h2>

          <div className="mt-6 space-y-5">

            <div className="flex gap-4">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-600 font-semibold">
                1
              </div>

              <div>
                <h3 className="font-medium">
                  Copy the code
                </h3>

                <p className="mt-1 text-sm text-slate-400">
                  Click the Copy Code button above.
                </p>
              </div>
            </div>

            <div className="flex gap-4">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-600 font-semibold">
                2
              </div>

              <div>
                <h3 className="font-medium">
                  Open your website code
                </h3>

                <p className="mt-1 text-sm text-slate-400">
                  Open the HTML file or website
                  template where you want to install
                  the support widget.
                </p>
              </div>
            </div>

            <div className="flex gap-4">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-600 font-semibold">
                3
              </div>

              <div>
                <h3 className="font-medium">
                  Paste before &lt;/body&gt;
                </h3>

                <p className="mt-1 text-sm text-slate-400">
                  Paste the AgentDesk AI code before
                  the closing body tag.
                </p>
              </div>
            </div>

            <div className="flex gap-4">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-600 font-semibold">
                4
              </div>

              <div>
                <h3 className="font-medium">
                  Save and test
                </h3>

                <p className="mt-1 text-sm text-slate-400">
                  Save your website and make sure
                  the AgentDesk chat button appears.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Verification */}

        <div className="mt-6 rounded-2xl border border-slate-800 bg-slate-900 p-6">
          <h2 className="text-xl font-semibold">
            Verify Installation
          </h2>

          <p className="mt-2 text-sm leading-6 text-slate-400">
            After the AgentDesk AI widget appears
            and works on your website, confirm the
            installation below.
          </p>

          <button
            type="button"
            onClick={
              handleVerifyInstallation
            }
            disabled={
              verifying ||
              isInstalled ||
              !publicAgentId
            }
            className={`mt-5 rounded-xl px-6 py-3 font-semibold transition ${
              isInstalled
                ? "cursor-not-allowed bg-green-600/20 text-green-400"
                : "bg-blue-600 text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
            }`}
          >
            {isInstalled
              ? "Installation Verified ✓"
              : verifying
                ? "Verifying..."
                : "Verify Installation"}
          </button>

          {message && (
            <p
              className={`mt-4 text-sm ${
                isInstalled
                  ? "text-green-400"
                  : "text-red-400"
              }`}
            >
              {message}
            </p>
          )}
        </div>

        {/* Done */}

        {isInstalled && (
          <div className="mt-6 rounded-2xl border border-green-900/50 bg-green-950/20 p-6">
            <h3 className="text-lg font-semibold text-green-400">
              🎉 Your widget is installed!
            </h3>

            <p className="mt-2 text-sm text-slate-400">
              Your AgentDesk AI customer support
              widget has been marked as installed.
            </p>

            <button
              type="button"
              onClick={() =>
                router.push("/dashboard")
              }
              className="mt-5 rounded-xl bg-green-600 px-5 py-3 text-sm font-semibold transition hover:bg-green-500"
            >
              Go to Dashboard
            </button>
          </div>
        )}
      </div>
    </main>
  );
}