"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

type FollowUp = { id: string; due_at: string; note: string; completed_at: string | null };
type Locale = "en" | "ps" | "fa";
const text = {
  en: { title: "Follow-ups", date: "Follow-up date", note: "Note", add: "Add follow-up", empty: "No follow-ups yet.", done: "Completed", reopen: "Reopen", close: "Close", error: "Could not update follow-ups." },
  ps: { title: "تعقیبي چارې", date: "د تعقیب نېټه", note: "یادښت", add: "تعقیب زیاتول", empty: "تر اوسه تعقیبي چاره نشته.", done: "بشپړ شو", reopen: "بیا پرانیستل", close: "تړل", error: "تعقیبي چارې تازه نه شوې." },
  fa: { title: "پیگیری‌ها", date: "تاریخ پیگیری", note: "یادداشت", add: "افزودن پیگیری", empty: "هنوز پیگیری ثبت نشده است.", done: "تکمیل شد", reopen: "بازگشایی", close: "بستن", error: "پیگیری‌ها به‌روزرسانی نشد." },
} as const;

export function LeadFollowUps({ leadId, leadName, locale, onClose }: { leadId: string; leadName: string; locale: Locale; onClose: () => void }) {
  const t = text[locale], [rows, setRows] = useState<FollowUp[]>([]), [dueAt, setDueAt] = useState(""), [note, setNote] = useState(""), [loading, setLoading] = useState(true), [saving, setSaving] = useState(false), [error, setError] = useState("");
  const authHeaders = useCallback(async () => {
    const { data } = await supabase.auth.getSession();
    return data.session ? { Authorization: `Bearer ${data.session.access_token}` } : null;
  }, []);
  const load = useCallback(async () => {
    setLoading(true); setError("");
    const headers = await authHeaders();
    if (!headers) return setLoading(false);
    const response = await fetch(`/api/leads/follow-ups?leadId=${encodeURIComponent(leadId)}`, { headers, cache: "no-store" });
    const body = await response.json();
    if (!response.ok) setError(body.error || t.error); else setRows(body.rows);
    setLoading(false);
  }, [authHeaders, leadId, t.error]);
  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);
  async function add(event: FormEvent) {
    event.preventDefault(); if (saving) return; setSaving(true); setError("");
    const headers = await authHeaders();
    if (headers) {
      const response = await fetch("/api/leads/follow-ups", { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify({ leadId, dueAt, note }) });
      const body = await response.json();
      if (!response.ok) setError(body.error || t.error); else { setDueAt(""); setNote(""); await load(); }
    }
    setSaving(false);
  }
  async function toggle(row: FollowUp) {
    const headers = await authHeaders(); if (!headers) return;
    const response = await fetch("/api/leads/follow-ups", { method: "PATCH", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify({ id: row.id, completed: !row.completed_at }) });
    if (!response.ok) setError(t.error); else void load();
  }
  return <section aria-labelledby="follow-up-heading" className="rounded-2xl border border-[var(--premium-border)] bg-[var(--premium-surface)] p-5 shadow-lg">
    <div className="flex items-start justify-between gap-3"><div><h2 id="follow-up-heading" className="text-xl font-black">{t.title}</h2><p className="text-sm text-[var(--premium-muted)]">{leadName}</p></div><button type="button" onClick={onClose} className="min-h-11 rounded-xl border px-4 font-bold">{t.close}</button></div>
    {error && <p role="alert" className="mt-3 rounded-xl bg-red-50 p-3 text-sm text-red-800">{error}</p>}
    <form onSubmit={add} className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,12rem)_1fr_auto]">
      <label className="text-sm font-bold">{t.date}<input required type="datetime-local" value={dueAt} onChange={event => setDueAt(event.target.value)} className="mt-1 min-h-11 w-full rounded-xl border border-[var(--premium-border)] bg-transparent px-3" /></label>
      <label className="text-sm font-bold">{t.note}<input required maxLength={1000} value={note} onChange={event => setNote(event.target.value)} className="mt-1 min-h-11 w-full rounded-xl border border-[var(--premium-border)] bg-transparent px-3" /></label>
      <button disabled={saving} className="min-h-11 self-end rounded-xl bg-blue-600 px-4 font-bold text-white disabled:opacity-50">{saving ? "…" : t.add}</button>
    </form>
    <div className="mt-4 space-y-2">{loading ? <p className="py-5 text-center">…</p> : !rows.length ? <p className="py-5 text-center text-sm text-[var(--premium-muted)]">{t.empty}</p> : rows.map(row => <article key={row.id} className={`flex flex-col justify-between gap-3 rounded-xl border border-[var(--premium-border)] p-3 sm:flex-row sm:items-center ${row.completed_at ? "opacity-60" : ""}`}><div><p className={row.completed_at ? "line-through" : ""}>{row.note}</p><time className="text-xs font-bold text-[var(--premium-muted)]">{new Date(row.due_at).toLocaleString(locale === "en" ? "en-US" : "fa-AF")}</time></div><button type="button" onClick={() => void toggle(row)} className="min-h-11 rounded-xl border px-4 text-sm font-bold text-blue-600">{row.completed_at ? t.reopen : t.done}</button></article>)}</div>
  </section>;
}
