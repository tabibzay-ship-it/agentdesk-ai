"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { BILLING_CURRENCY } from "@/lib/billing-config";
import { supabase } from "@/lib/supabase";

type Plan = { code: string; name: string; priceCents: number; agentLimit: number; monthlyResponseLimit: number; description: string };
type BillingData = {
  plans: Plan[];
  subscription: null | { plan_id: string; status: string; current_period_end: string | null; cancel_at_period_end: boolean };
  usage: null | { monthly_limit: number; messages_used: number; period_start: string };
  billingEvents: Array<{ id: string; event_type: string; outcome: string; occurred_at: string | null; created_at: string }>;
  transactions: Array<{ id: string; amount_cents: number; currency: string; status: string; occurred_at: string; created_at: string }>;
  checkout: { available: boolean; message: string };
};

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: BILLING_CURRENCY, minimumFractionDigits: 0 });

export default function BillingPage() {
  const router = useRouter();
  const [data, setData] = useState<BillingData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    async function loadBilling() {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.replace("/login"); return; }
      try {
        const response = await fetch("/api/billing", {
          headers: { Authorization: `Bearer ${session.access_token}` },
          cache: "no-store",
        });
        if (response.status === 401) { router.replace("/login"); return; }
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "Could not load billing information.");
        if (active) setData(result);
      } catch (loadError) {
        if (active) setError(loadError instanceof Error ? loadError.message : "Could not load billing information.");
      } finally {
        if (active) setLoading(false);
      }
    }
    loadBilling();
    return () => { active = false; };
  }, [router]);

  if (loading) return <main className="flex min-h-screen items-center justify-center bg-slate-950 text-slate-400">Loading billing…</main>;

  const currentPlan = data?.subscription?.plan_id ?? "free";
  const used = data?.usage?.messages_used ?? 0;
  const limit = data?.usage?.monthly_limit ?? data?.plans.find((plan) => plan.code === currentPlan)?.monthlyResponseLimit ?? 100;
  const remaining = Math.max(0, limit - used);
  const usagePercent = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;

  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <header className="border-b border-slate-800 bg-slate-950/95 px-5 py-5 sm:px-8">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4">
          <button type="button" onClick={() => router.push("/dashboard")} className="text-xl font-bold">AgentDesk <span className="text-blue-500">AI</span></button>
          <button type="button" onClick={() => router.push("/dashboard")} className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:bg-slate-800">Back to dashboard</button>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-5 py-10 sm:px-8">
        <div className="max-w-2xl">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-blue-400">Subscription & billing</p>
          <h1 className="mt-3 text-3xl font-bold sm:text-4xl">A plan that grows with your support</h1>
          <p className="mt-3 text-slate-400">Review your current plan and monthly AI usage. Paid checkout stays disabled until a verified payment provider is connected.</p>
        </div>

        {error && <div role="alert" className="mt-8 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-amber-200">{error}</div>}

        {data && <>
          <section className="mt-8 grid gap-5 lg:grid-cols-3">
            <div className="rounded-2xl border border-blue-500/40 bg-blue-500/10 p-6 lg:col-span-2">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div><p className="text-sm text-blue-300">Current subscription</p><h2 className="mt-1 text-2xl font-bold capitalize">{currentPlan}</h2><p className="mt-1 text-sm capitalize text-slate-400">Status: {data.subscription?.status ?? "active"}</p></div>
                <span className="rounded-full bg-blue-500/20 px-3 py-1 text-sm text-blue-200">{remaining.toLocaleString()} responses remaining</span>
              </div>
              <div className="mt-6 h-2 overflow-hidden rounded-full bg-slate-800"><div className="h-full rounded-full bg-blue-500" style={{ width: `${usagePercent}%` }} /></div>
              <div className="mt-2 flex justify-between text-xs text-slate-400"><span>{used.toLocaleString()} used</span><span>{limit.toLocaleString()} monthly limit</span></div>
            </div>
            <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6">
              <p className="text-sm text-slate-400">Renewal / expiration</p>
              <p className="mt-2 font-semibold">{data.subscription?.current_period_end ? new Date(data.subscription.current_period_end).toLocaleDateString() : "No paid renewal scheduled"}</p>
              <p className="mt-3 text-sm text-slate-500">{data.subscription?.cancel_at_period_end ? "Cancellation is scheduled." : currentPlan === "free" ? "The Free plan does not expire." : "Renews after verified provider confirmation."}</p>
            </div>
          </section>

          {!data.checkout.available && <div className="mt-6 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-100"><strong>Payments unavailable:</strong> {data.checkout.message}</div>}

          <section className="mt-10 grid gap-5 md:grid-cols-3">
            {data.plans.map((plan) => {
              const selected = plan.code === currentPlan;
              return <article key={plan.code} className={`rounded-2xl border p-6 ${selected ? "border-blue-500 bg-blue-500/10" : "border-slate-800 bg-slate-900"}`}>
                <div className="flex items-center justify-between"><h2 className="text-xl font-bold">{plan.name}</h2>{selected && <span className="rounded-full bg-blue-600 px-2.5 py-1 text-xs">Current</span>}</div>
                <p className="mt-4 text-3xl font-bold">{money.format(plan.priceCents / 100)}<span className="text-sm font-normal text-slate-400"> / month</span></p>
                <p className="mt-3 min-h-10 text-sm text-slate-400">{plan.description}</p>
                <ul className="mt-5 space-y-2 text-sm text-slate-300"><li>✓ {plan.agentLimit} AI {plan.agentLimit === 1 ? "Agent" : "Agents"}</li><li>✓ {plan.monthlyResponseLimit.toLocaleString()} AI responses / month</li></ul>
                <button type="button" disabled={selected || plan.priceCents > 0 || !data.checkout.available} className="mt-6 w-full rounded-xl bg-blue-600 px-4 py-3 font-semibold disabled:cursor-not-allowed disabled:bg-slate-800 disabled:text-slate-500">{selected ? "Current plan" : plan.priceCents === 0 ? "Free plan" : "Checkout unavailable"}</button>
              </article>;
            })}
          </section>

          <section className="mt-10 rounded-2xl border border-slate-800 bg-slate-900 p-6">
            <div className="flex flex-wrap items-center justify-between gap-4"><div><h2 className="text-xl font-semibold">Billing history</h2><p className="mt-1 text-sm text-slate-400">Verified payment activity for this account only.</p></div><button type="button" disabled={!data.checkout.available || currentPlan === "free"} className="rounded-lg border border-red-500/40 px-4 py-2 text-sm text-red-300 disabled:cursor-not-allowed disabled:border-slate-700 disabled:text-slate-600">Cancel subscription</button></div>
            {data.transactions.length === 0 && data.billingEvents.length === 0 ? <p className="mt-6 rounded-xl bg-slate-950 p-5 text-sm text-slate-500">No billing activity yet.</p> : <div className="mt-6 space-y-3">{data.transactions.map((item) => <div key={item.id} className="flex justify-between rounded-xl bg-slate-950 p-4 text-sm"><span className="capitalize">{item.status}</span><span>{money.format(item.amount_cents / 100)} · {new Date(item.occurred_at || item.created_at).toLocaleDateString()}</span></div>)}</div>}
          </section>
        </>}
      </div>
    </main>
  );
}
