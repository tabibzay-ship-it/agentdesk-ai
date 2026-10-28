import { authenticateBillingRequest, billingJson } from "@/lib/billing-server";
import { getPaymentProvider } from "@/lib/payments/provider";
import { buildBillingNotices } from "@/lib/billing-renewal";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const authentication = await authenticateBillingRequest(request);
    if ("response" in authentication) return authentication.response;
    const { admin, user } = authentication;

    const { error: ensureError } = await admin.rpc("billing_ensure_free_subscription", {
      p_user_id: user.id,
    });
    if (ensureError) {
      return billingJson({ error: "Billing data is not available yet.", code: "BILLING_MIGRATION_REQUIRED" }, 503);
    }
    const { error: trialEnsureError } = await admin.rpc("billing_ensure_trial_entitlement", { p_user_id: user.id });
    if (trialEnsureError) {
      return billingJson({ error: "Trial billing data is not available yet.", code: "TRIAL_MIGRATION_REQUIRED" }, 503);
    }

    const paymentProvider = getPaymentProvider();
    const [plansResult, subscriptionResult, usageResult, trialResult, methodsResult, eventsResult, transactionsResult, ordersResult] = await Promise.all([
      admin.from("subscription_plans")
        .select("code,name,price_cents,agent_limit,monthly_response_limit,description")
        .eq("active", true).order("display_order", { ascending: true }),
      admin.from("subscriptions")
        .select("id,plan_id,status,billing_period,current_period_start,current_period_end,cancel_at_period_end,canceled_at,created_at,updated_at")
        .eq("user_id", user.id).maybeSingle(),
      admin.from("usage_limits").select("plan,monthly_limit,messages_used,period_start")
        .eq("user_id", user.id).maybeSingle(),
      admin.from("trial_entitlements").select("status,starts_at,ends_at,credit_limit,credits_used,ended_at")
        .eq("user_id", user.id).maybeSingle(),
      admin.from("payment_methods").select("id,brand,last4,exp_month,exp_year,is_default,status")
        .eq("user_id", user.id).eq("status", "active").order("created_at", { ascending: false }),
      admin.from("billing_events").select("id,event_type,outcome,occurred_at,processed_at,created_at")
        .eq("user_id", user.id).order("created_at", { ascending: false }).limit(25),
      admin.from("payment_transactions").select("id,amount_cents,currency,status,occurred_at,created_at")
        .eq("user_id", user.id).order("created_at", { ascending: false }).limit(25),
      paymentProvider.configured && paymentProvider.name === "nowpayments"
        ? admin.from("nowpayments_payment_orders").select("status,kind,created_at")
          .eq("user_id", user.id).order("created_at", { ascending: false }).limit(1).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    ]);

    if (plansResult.error || subscriptionResult.error || usageResult.error || trialResult.error || methodsResult.error || eventsResult.error || transactionsResult.error || ordersResult.error) {
      return billingJson({ error: "Could not load billing information.", code: "BILLING_READ_FAILED" }, 500);
    }

    const renewalMode = paymentProvider.name === "nowpayments" ? "customer_initiated" : "provider_managed";
    return billingJson({
      plans: (plansResult.data ?? []).map((plan) => ({
        code: plan.code,
        name: plan.name,
        priceCents: plan.price_cents,
        agentLimit: plan.agent_limit,
        monthlyResponseLimit: plan.monthly_response_limit,
        description: plan.description,
      })),
      subscription: subscriptionResult.data,
      usage: usageResult.data,
      trial: trialResult.data,
      paymentMethods: methodsResult.data ?? [],
      billingEvents: eventsResult.data ?? [],
      transactions: transactionsResult.data ?? [],
      paymentOrder: ordersResult.data,
      notices: buildBillingNotices(subscriptionResult.data, ordersResult.data),
      checkout: {
        available: paymentProvider.configured,
        provider: paymentProvider.configured ? paymentProvider.name : null,
        renewalMode,
        automaticChargingAvailable: false,
        paymentMethodsAvailable: paymentProvider.configured && paymentProvider.name !== "nowpayments",
        cancellationAvailable: paymentProvider.configured && paymentProvider.name !== "nowpayments",
        message: paymentProvider.configured
          ? renewalMode === "customer_initiated"
            ? "Secure checkout is available. Every renewal requires a new customer-authorized payment."
            : "Secure checkout is available. Automatic charging remains disabled until provider support is verified."
          : "Paid checkout is not configured. Starter and Pro purchases remain disabled.",
      },
    });
  } catch {
    return billingJson({ error: "Billing service is temporarily unavailable.", code: "BILLING_UNAVAILABLE" }, 503);
  }
}
