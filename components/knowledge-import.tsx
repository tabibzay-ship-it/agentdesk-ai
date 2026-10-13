"use client";

import { ChangeEvent, useState } from "react";
import { supabase } from "@/lib/supabase";

type Source = { id: string; title: string; content: string; created_at?: string | null };
const text = {
  en: { label: "Import PDF, DOCX or TXT", help: "Text is extracted securely on the server. Maximum 10 MB.", imported: "Document imported.", duplicate: "This document already exists.", error: "Document import failed." },
  ps: { label: "PDF، DOCX یا TXT راوړل", help: "متن په خوندي ډول په سرور کې ایستل کېږي. تر ۱۰ MB پورې.", imported: "سند راوړل شو.", duplicate: "دا سند له مخکې شته.", error: "سند راوړل نه شو." },
  fa: { label: "واردکردن PDF، DOCX یا TXT", help: "متن به‌صورت امن در سرور استخراج می‌شود. حداکثر ۱۰ MB.", imported: "سند وارد شد.", duplicate: "این سند از قبل وجود دارد.", error: "واردکردن سند ناموفق بود." },
} as const;

export function KnowledgeImport({ locale, onImported }: { locale: "en" | "ps" | "fa"; onImported: (source: Source, duplicate: boolean) => void }) {
  const t = text[locale], [busy, setBusy] = useState(false), [message, setMessage] = useState(""), [error, setError] = useState("");
  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; event.target.value = ""; if (!file || busy) return;
    setBusy(true); setError(""); setMessage("");
    const { data } = await supabase.auth.getSession(); const token = data.session?.access_token;
    if (!token) { setBusy(false); return; }
    const form = new FormData(); form.append("file", file);
    const response = await fetch("/api/knowledge/import", { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: form });
    const body = await response.json();
    if (!response.ok) setError(body.error || t.error); else { onImported(body.source, body.duplicate); setMessage(body.duplicate ? t.duplicate : t.imported); }
    setBusy(false);
  }
  return <div className="mt-5 rounded-xl border border-dashed border-blue-500/40 bg-blue-500/5 p-4"><label className="block text-sm font-bold text-blue-600">{t.label}<input aria-label={t.label} disabled={busy} type="file" accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain" onChange={event => void upload(event)} className="mt-3 block w-full text-sm file:me-3 file:min-h-11 file:rounded-xl file:border-0 file:bg-blue-600 file:px-4 file:font-bold file:text-white" /></label><p className="mt-2 text-xs text-[var(--premium-text-muted)]">{t.help}</p>{busy && <p role="status" className="mt-2 text-sm">…</p>}{message && <p role="status" className="mt-2 text-sm text-emerald-600">{message}</p>}{error && <p role="alert" className="mt-2 text-sm text-red-600">{error}</p>}</div>;
}
