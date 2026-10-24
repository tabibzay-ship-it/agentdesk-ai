"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AppPreferences as AuthPreferences, useAuthLocale } from "@/components/auth-preferences";
import { isBoundedText, isHttpWebsite, isValidEmail } from "@/lib/client-security";
import { supabase } from "@/lib/supabase";

const copy = {
  en: { title: "Business information", subtitle: "Give your AI agent accurate, account-owned business context.", back: "Dashboard", name: "Business name", description: "Business description", email: "Support email", phone: "Phone", website: "Website", address: "Address", save: "Save business information", saving: "Saving…", loading: "Loading business information…", saved: "Business information saved successfully.", invalid: "Check the fields and use a full http:// or https:// website address.", loadError: "Business information could not be loaded. Your data was not changed.", saveError: "Business information could not be saved. Please try again.", session: "Your session has expired. Please sign in again." },
  ps: { title: "د سوداګرۍ معلومات", subtitle: "خپل AI استازي ته د حساب اړوند کره معلومات ورکړئ.", back: "ډشبورډ", name: "د سوداګرۍ نوم", description: "د سوداګرۍ تشریح", email: "د ملاتړ برېښنالیک", phone: "تلیفون", website: "وېب‌سایټ", address: "پته", save: "د سوداګرۍ معلومات خوندي کول", saving: "خوندي کېږي…", loading: "د سوداګرۍ معلومات پورته کېږي…", saved: "د سوداګرۍ معلومات خوندي شول.", invalid: "فیلډونه وګورئ او بشپړ http:// یا https:// وېب‌سایټ پته وکاروئ.", loadError: "معلومات پورته نه شول. ستاسو معلومات بدل شوي نه دي.", saveError: "معلومات خوندي نه شول. بیا هڅه وکړئ.", session: "ستاسو ناسته پای ته رسېدلې. بیا ننوځئ." },
  fa: { title: "اطلاعات کسب‌وکار", subtitle: "اطلاعات دقیق و متعلق به حساب را به عامل هوش مصنوعی بدهید.", back: "داشبورد", name: "نام کسب‌وکار", description: "توضیح کسب‌وکار", email: "ایمیل پشتیبانی", phone: "تلفن", website: "وب‌سایت", address: "آدرس", save: "ذخیره اطلاعات کسب‌وکار", saving: "در حال ذخیره…", loading: "اطلاعات کسب‌وکار بارگذاری می‌شود…", saved: "اطلاعات کسب‌وکار ذخیره شد.", invalid: "فیلدها را بررسی کنید و آدرس کامل http:// یا https:// وارد کنید.", loadError: "اطلاعات بارگذاری نشد. داده‌های شما تغییر نکرد.", saveError: "اطلاعات ذخیره نشد. دوباره کوشش کنید.", session: "نشست شما منقضی شده است. دوباره وارد شوید." },
} as const;

type Notice = { kind: "success" | "error"; text: string } | null;

export default function BusinessPage() {
  const router = useRouter();
  const { locale, setLocale, rtl } = useAuthLocale();
  const t = copy[locale];
  const [form, setForm] = useState({ businessName: "", description: "", email: "", phone: "", website: "", address: "" });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const { data: { user }, error: userError } = await supabase.auth.getUser();
        if (!active) return;
        if (userError || !user) { router.replace("/login"); return; }
        const { data, error } = await supabase.from("business_profiles").select("business_name,description,email,phone,website,address").eq("user_id", user.id).maybeSingle();
        if (!active) return;
        if (error) { setNotice({ kind: "error", text: t.loadError }); return; }
        if (data) setForm({ businessName: data.business_name ?? "", description: data.description ?? "", email: data.email ?? "", phone: data.phone ?? "", website: data.website ?? "", address: data.address ?? "" });
      } catch { if (active) setNotice({ kind: "error", text: t.loadError }); }
      finally { if (active) setLoading(false); }
    })();
    return () => { active = false; };
  }, [router, t.loadError]);

  function update(name: keyof typeof form, value: string) { setForm((current) => ({ ...current, [name]: value })); }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    const values = Object.fromEntries(Object.entries(form).map(([key, value]) => [key, value.trim()])) as typeof form;
    if (!values.businessName || !isBoundedText(values.businessName, 200) || !isBoundedText(values.description, 20000) || !isBoundedText(values.phone, 100) || !isBoundedText(values.address, 2000) || !isHttpWebsite(values.website) || (values.email && !isValidEmail(values.email))) { setNotice({ kind: "error", text: t.invalid }); return; }
    setSaving(true); setNotice(null);
    try {
      const { data: { user }, error: userError } = await supabase.auth.getUser();
      if (userError || !user) { setNotice({ kind: "error", text: t.session }); router.replace("/login"); return; }
      const { error } = await supabase.from("business_profiles").upsert({ user_id: user.id, business_name: values.businessName, description: values.description, email: values.email, phone: values.phone, website: values.website, address: values.address }, { onConflict: "user_id" });
      if (error) { setNotice({ kind: "error", text: t.saveError }); return; }
      setForm(values); setNotice({ kind: "success", text: t.saved });
    } catch { setNotice({ kind: "error", text: t.saveError }); }
    finally { setSaving(false); }
  }

  const inputClass = "mt-2 min-h-11 w-full rounded-xl border border-[var(--premium-border)] bg-[var(--premium-surface-muted)] px-4 py-3 text-[var(--premium-text)] outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20";
  if (loading) return <main className="flex min-h-screen items-center justify-center bg-[var(--premium-bg)] text-[var(--premium-text)]"><p role="status" className="text-[var(--premium-muted)]">{t.loading}</p></main>;

  return <main dir={rtl ? "rtl" : "ltr"} className="min-h-screen bg-[var(--premium-bg)] text-[var(--premium-text)]">
    <header className="border-b border-[var(--premium-border)] bg-[var(--premium-surface)]"><div className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-4 px-4 py-5 sm:px-6"><div><Link href="/dashboard" className="text-sm font-bold text-blue-600">← {t.back}</Link><h1 className="mt-2 text-3xl font-black">{t.title}</h1><p className="mt-1 text-sm text-[var(--premium-muted)]">{t.subtitle}</p></div><AuthPreferences locale={locale} onLocaleChange={setLocale} /></div></header>
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 sm:py-12"><form onSubmit={handleSubmit} className="rounded-3xl border border-[var(--premium-border)] bg-[var(--premium-surface)] p-5 shadow-sm sm:p-8">
      <div className="grid gap-6 sm:grid-cols-2">
        <label className="text-sm font-bold sm:col-span-2">{t.name}<input required maxLength={200} autoComplete="organization" value={form.businessName} onChange={(e) => update("businessName", e.target.value)} className={inputClass} /></label>
        <label className="text-sm font-bold sm:col-span-2">{t.description}<textarea rows={5} maxLength={20000} value={form.description} onChange={(e) => update("description", e.target.value)} className={`${inputClass} resize-y`} /></label>
        <label className="text-sm font-bold">{t.email}<input type="email" maxLength={254} autoComplete="email" value={form.email} onChange={(e) => update("email", e.target.value)} className={inputClass} /></label>
        <label className="text-sm font-bold">{t.phone}<input type="tel" maxLength={100} autoComplete="tel" value={form.phone} onChange={(e) => update("phone", e.target.value)} className={inputClass} /></label>
        <label className="text-sm font-bold">{t.website}<input type="url" maxLength={2048} autoComplete="url" placeholder="https://example.com" value={form.website} onChange={(e) => update("website", e.target.value)} className={inputClass} /></label>
        <label className="text-sm font-bold">{t.address}<input maxLength={2000} autoComplete="street-address" value={form.address} onChange={(e) => update("address", e.target.value)} className={inputClass} /></label>
      </div>
      {notice && <p role={notice.kind === "error" ? "alert" : "status"} className={`mt-6 rounded-xl border p-4 text-sm font-semibold ${notice.kind === "success" ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300"}`}>{notice.text}</p>}
      <button type="submit" disabled={saving} className="mt-8 min-h-12 w-full rounded-xl bg-blue-600 px-5 py-3 font-bold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50">{saving ? t.saving : t.save}</button>
    </form></div>
  </main>;
}
