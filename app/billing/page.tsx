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
  trial: null | { status: string; starts_at: string; ends_at: string; credit_limit: number; credits_used: number; ended_at: string | null };
  paymentMethods: Array<{ id: string; brand: string; last4: string; exp_month: number | null; exp_year: number | null; is_default: boolean }>;
  billingEvents: Array<{ id: string; event_type: string; outcome: string; occurred_at: string | null; created_at: string }>;
  transactions: Array<{ id: string; amount_cents: number; currency: string; status: string; occurred_at: string; created_at: string }>;
  paymentOrder: null | { status: string; kind: string; created_at: string };
  notices: Array<{ kind: "info" | "warning" | "error"; code: string; message: string }>;
  checkout: { available: boolean; provider: string | null; renewalMode: "customer_initiated" | "provider_managed"; automaticChargingAvailable: boolean; paymentMethodsAvailable: boolean; cancellationAvailable: boolean; message: string };
};

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: BILLING_CURRENCY, minimumFractionDigits: 0 });

export default function BillingPage() {
  const router = useRouter();
  const [data, setData] = useState<BillingData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [renewalConsent, setRenewalConsent] = useState(false);

  async function authorizedPost(path: string, body?: Record<string, unknown>) {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { router.replace("/login"); throw new Error("Your session has expired."); }
    const response = await fetch(path, {
      method: "POST",
      headers: { Authorization: `Bearer ${session.access_token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "The billing request could not be completed.");
    return result;
  }

  async function paymentMethodRequest(method: "POST" | "DELETE", body?: Record<string, unknown>) {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { router.replace("/login"); throw new Error("Your session has expired."); }
    const response = await fetch("/api/billing/payment-methods", { method, headers: {
      Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json",
    }, body: JSON.stringify(body ?? {}) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "The payment-method request could not be completed.");
    return result;
  }

  async function setupPaymentMethod(replacePaymentMethodId?: string) {
    if (pendingAction) return;
    setError(""); setPendingAction(replacePaymentMethodId ? `replace:${replacePaymentMethodId}` : "add-method");
    try {
      const result = await paymentMethodRequest("POST", replacePaymentMethodId ? { replacePaymentMethodId } : {});
      const setupUrl = new URL(String(result.setupUrl));
      if (setupUrl.protocol !== "https:") throw new Error("The payment provider returned an unsafe setup URL.");
      window.location.assign(setupUrl.href);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Payment-method setup could not be started.");
      setPendingAction(null);
    }
  }

  async function removePaymentMethod(paymentMethodId: string) {
    if (pendingAction || !window.confirm("Remove this saved payment method at the provider?")) return;
    setError(""); setPendingAction(`remove:${paymentMethodId}`);
    try {
      await paymentMethodRequest("DELETE", { paymentMethodId });
      setData((current) => current ? { ...current, paymentMethods: current.paymentMethods.filter((item) => item.id !== paymentMethodId) } : current);
      setNotice("Payment method removed.");
    } catch (actionError) { setError(actionError instanceof Error ? actionError.message : "Payment method could not be removed."); }
    finally { setPendingAction(null); }
  }

  async function startCheckout(planCode: string) {
    if (pendingAction) return;
    setError(""); setNotice(""); setPendingAction(planCode);
    try {
      if (!renewalConsent) throw new Error(data?.checkout.renewalMode === "customer_initiated" ? "Confirm the customer-authorized renewal terms before continuing." : "Confirm monthly automatic renewal before continuing.");
      const result = await authorizedPost("/api/billing/checkout", data?.checkout.renewalMode === "customer_initiated"
        ? { planCode, renewalConsent: true, autoRenew: false }
        : { planCode, renewalConsent: true, autoRenew: true });
      const checkoutUrl = new URL(String(result.checkoutUrl));
      if (checkoutUrl.protocol !== "https:") throw new Error("The payment provider returned an unsafe checkout URL.");
      window.location.assign(checkoutUrl.href);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Checkout could not be started.");
      setPendingAction(null);
    }
  }

  async function cancelSubscription() {
    if (pendingAction || !window.confirm("Request cancellation of this subscription at the provider?")) return;
    setError(""); setNotice(""); setPendingAction("cancel");
    try {
      const result = await authorizedPost("/api/billing/cancel");
      setNotice(result.message || "Cancellation requested. Status will update after provider confirmation.");
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Cancellation could not be requested.");
    } finally {
      setPendingAction(null);
    }
  }

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
    <main className="min-h-screen bg-[var(--background)] text-[var(--foreground)]">
      <header className="border-b border-[var(--premium-border)] bg-[var(--premium-surface)] px-5 py-5 sm:px-8">
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
        {notice && <div role="status" className="mt-8 rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-4 text-emerald-700 dark:text-emerald-200">{notice}</div>}

        {data && <>
          {data.trial && <section className="mt-8 rounded-2xl border border-violet-500/40 bg-violet-500/10 p-6">
            <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-sm font-semibold text-violet-400">5-day Pro trial</p><h2 className="mt-1 text-xl font-bold capitalize">{data.trial.status}</h2><p className="mt-2 text-sm text-[var(--premium-text-muted)]">Trial and Free credits are tracked separately. Your Free allowance remains untouched until the trial ends.</p></div><div className="text-end"><p className="font-semibold">{Math.max(0, data.trial.credit_limit-data.trial.credits_used)} / {data.trial.credit_limit} credits left</p><p className="mt-1 text-sm text-[var(--premium-text-muted)]">Ends {new Date(data.trial.ends_at).toLocaleString()}</p></div></div>
          </section>}
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

          {data.notices.map((item) => <div key={item.code} role={item.kind === "error" ? "alert" : "status"} className={`mt-4 rounded-xl border p-4 text-sm ${item.kind === "error" ? "border-red-500/40 bg-red-500/10 text-red-200" : item.kind === "warning" ? "border-amber-500/40 bg-amber-500/10 text-amber-200" : "border-blue-500/40 bg-blue-500/10 text-blue-200"}`}>{item.message}</div>)}

          <section className="mt-6 rounded-xl border border-[var(--premium-border)] bg-[var(--premium-surface)] p-4">
            <div className="flex items-center justify-between gap-4"><div><strong>Auto-Renew</strong><p className="mt-1 text-sm text-[var(--premium-text-muted)]">{data.checkout.automaticChargingAvailable ? "Automatic charging is available after explicit customer authorization." : "OFF — automatic wallet charging is not supported or verified for this payment method."}</p></div><button type="button" role="switch" aria-checked={false} disabled={!data.checkout.automaticChargingAvailable} className="min-h-11 min-w-20 rounded-full border border-slate-700 bg-slate-800 px-4 text-sm font-semibold text-slate-400 disabled:cursor-not-allowed">OFF</button></div>
          </section>

          <label className="mt-6 flex min-h-12 items-start gap-3 rounded-xl border border-[var(--premium-border)] bg-[var(--premium-surface)] p-4 text-sm">
            <input type="checkbox" checked={renewalConsent} onChange={(event) => setRenewalConsent(event.target.checked)} className="mt-0.5 h-5 w-5 accent-blue-600" />
            <span><strong>{data.checkout.renewalMode === "customer_initiated" ? "Customer-authorized monthly renewal" : "Monthly automatic renewal"}</strong><br/><span className="text-[var(--premium-text-muted)]">{data.checkout.renewalMode === "customer_initiated" ? "I understand each renewal requires a new confirmed crypto payment; AgentDesk will never charge a stored payment method automatically. This preference only enables checkout and renewal reminders." : "I agree to monthly renewal at the displayed plan price until I cancel. Cancellation is requested for the end of the current billing period."}</span></span>
          </label>

          <section className="mt-10 grid gap-5 md:grid-cols-3">
            {data.plans.map((plan) => {
              const selected = plan.code === currentPlan;
              const canRenew = selected && plan.priceCents > 0 && data.checkout.renewalMode === "customer_initiated";
              return <article key={plan.code} className={`rounded-2xl border p-6 ${selected ? "border-blue-500 bg-blue-500/10" : "border-slate-800 bg-slate-900"}`}>
                <div className="flex items-center justify-between"><h2 className="text-xl font-bold">{plan.name}</h2>{selected && <span className="rounded-full bg-blue-600 px-2.5 py-1 text-xs">Current</span>}</div>
                <p className="mt-4 text-3xl font-bold">{money.format(plan.priceCents / 100)}<span className="text-sm font-normal text-slate-400"> / month</span></p>
                <p className="mt-3 min-h-10 text-sm text-slate-400">{plan.description}</p>
                <ul className="mt-5 space-y-2 text-sm text-slate-300"><li>✓ {plan.agentLimit} AI {plan.agentLimit === 1 ? "Agent" : "Agents"}</li><li>✓ {plan.monthlyResponseLimit.toLocaleString()} AI responses / month</li></ul>
                <button type="button" onClick={() => void startCheckout(plan.code)}
                  disabled={(selected && !canRenew) || plan.priceCents === 0 || !data.checkout.available || !renewalConsent || pendingAction !== null}
                  className="mt-6 min-h-12 w-full rounded-xl bg-blue-600 px-4 py-3 font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-800 disabled:text-slate-500">
                  {pendingAction === plan.code ? "Opening secure checkout…" : canRenew ? `Renew ${plan.name}` : selected ? "Current plan" : plan.priceCents === 0 ? "Free plan" : data.checkout.available ? `Choose ${plan.name}` : "Checkout unavailable"}
                </button>
              </article>;
            })}
          </section>

          <section className="mt-10 rounded-2xl border border-slate-800 bg-slate-900 p-6">
            <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-xl font-semibold">Saved payment methods</h2><button type="button" onClick={() => void setupPaymentMethod()} disabled={!data.checkout.paymentMethodsAvailable || pendingAction !== null} className="min-h-11 rounded-lg border border-blue-500/40 px-4 py-2 text-sm text-blue-400 disabled:cursor-not-allowed disabled:border-slate-700 disabled:text-slate-600">{pendingAction === "add-method" ? "Opening provider…" : "Add payment method"}</button></div>
            <p className="mt-1 text-sm text-slate-400">Cards are collected only on the provider&apos;s hosted page. AgentDesk stores token references and safe display metadata—never card numbers or CVV.</p>
            {data.paymentMethods.length === 0 ? <p className="mt-5 rounded-xl bg-slate-950 p-4 text-sm text-slate-500">No saved payment method. Add, replace, and remove controls become available only after an approved provider is configured.</p> :
              <div className="mt-5 space-y-3">{data.paymentMethods.map((method) => <div key={method.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-slate-950 p-4 text-sm"><div><span className="capitalize">{method.brand} •••• {method.last4}</span><span className="ms-3 text-slate-500">{method.exp_month && method.exp_year ? `Expires ${method.exp_month}/${method.exp_year}` : "Expiry managed by provider"}{method.is_default ? " · Default" : ""}</span></div><div className="flex gap-2"><button type="button" disabled={!data.checkout.paymentMethodsAvailable || pendingAction !== null} onClick={() => void setupPaymentMethod(method.id)} className="min-h-11 rounded-lg border border-slate-700 px-3 disabled:opacity-50">Replace</button><button type="button" disabled={!data.checkout.paymentMethodsAvailable || pendingAction !== null} onClick={() => void removePaymentMethod(method.id)} className="min-h-11 rounded-lg border border-red-500/40 px-3 text-red-400 disabled:opacity-50">Remove</button></div></div>)}</div>}
          </section>

          <section className="mt-10 rounded-2xl border border-slate-800 bg-slate-900 p-6">
            <div className="flex flex-wrap items-center justify-between gap-4"><div><h2 className="text-xl font-semibold">Billing history</h2><p className="mt-1 text-sm text-slate-400">Verified payment activity for this account only.</p></div><button type="button" onClick={() => void cancelSubscription()} disabled={!data.checkout.cancellationAvailable || currentPlan === "free" || pendingAction !== null} className="min-h-11 rounded-lg border border-red-500/40 px-4 py-2 text-sm text-red-400 disabled:cursor-not-allowed disabled:border-slate-700 disabled:text-slate-600">{pendingAction === "cancel" ? "Requesting…" : "Cancel subscription"}</button></div>
            {data.transactions.length === 0 && data.billingEvents.length === 0 ? <p className="mt-6 rounded-xl bg-slate-950 p-5 text-sm text-slate-500">No billing activity yet.</p> : <div className="mt-6 space-y-3">{data.transactions.map((item) => <div key={item.id} className="flex justify-between rounded-xl bg-slate-950 p-4 text-sm"><span className="capitalize">{item.status}</span><span>{money.format(item.amount_cents / 100)} · {new Date(item.occurred_at || item.created_at).toLocaleDateString()}</span></div>)}</div>}
          </section>
        </>}
      </div>
    </main>
  );
}
