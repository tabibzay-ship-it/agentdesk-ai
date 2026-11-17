"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

export default function MarketingPreferences() {
  const [consented, setConsented] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function token() {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error("Your session has expired.");
    return session.access_token;
  }

  useEffect(() => {
    let active = true;
    void token().then((accessToken) => fetch("/api/marketing-consent", {
      headers: { Authorization: `Bearer ${accessToken}` }, cache: "no-store",
    })).then(async (response) => {
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not load the preference.");
      if (active) setConsented(result.preference?.consented === true);
    }).catch((loadError) => { if (active) setError(loadError instanceof Error ? loadError.message : "Could not load the preference."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  async function save() {
    if (saving) return;
    setSaving(true); setError(""); setMessage("");
    try {
      const accessToken = await token();
      const response = await fetch("/api/marketing-consent", {
        method: "POST", headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ consented }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not save the preference.");
      setMessage("Marketing preference saved.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not save the preference.");
    } finally { setSaving(false); }
  }

  return <div>
    <label className="flex items-start gap-3 text-sm leading-6">
      <input type="checkbox" checked={consented} disabled={loading || saving} onChange={(event) => setConsented(event.target.checked)} className="mt-1 h-5 w-5 accent-blue-600" />
      <span>Receive occasional product news and helpful tips. This is optional and can be changed at any time.</span>
    </label>
    <button type="button" onClick={() => void save()} disabled={loading || saving} className="mt-4 min-h-11 rounded-xl bg-blue-600 px-5 py-2.5 font-semibold text-white disabled:opacity-50">
      {saving ? "Saving…" : "Save email preference"}
    </button>
    {message && <p role="status" className="mt-3 text-sm text-emerald-600">{message}</p>}
    {error && <p role="alert" className="mt-3 text-sm text-amber-600">{error}</p>}
  </div>;
}
