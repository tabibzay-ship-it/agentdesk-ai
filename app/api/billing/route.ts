import { authenticateBillingRequest, billingJson } from "@/lib/billing-server";
import { getPaymentProvider } from "@/lib/payments/provider";

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

    const [plansResult, subscriptionResult, usageResult, eventsResult, transactionsResult] = await Promise.all([
      admin.from("subscription_plans")
        .select("code,name,price_cents,agent_limit,monthly_response_limit,description")
        .eq("active", true).order("display_order", { ascending: true }),
      admin.from("subscriptions")
        .select("id,plan_id,status,billing_period,current_period_start,current_period_end,cancel_at_period_end,canceled_at,created_at,updated_at")
        .eq("user_id", user.id).maybeSingle(),
      admin.from("usage_limits").select("plan,monthly_limit,messages_used,period_start")
        .eq("user_id", user.id).maybeSingle(),
      admin.from("billing_events").select("id,event_type,outcome,occurred_at,processed_at,created_at")
        .eq("user_id", user.id).order("created_at", { ascending: false }).limit(25),
      admin.from("payment_transactions").select("id,amount_cents,currency,status,occurred_at,created_at")
        .eq("user_id", user.id).order("created_at", { ascending: false }).limit(25),
    ]);

    if (plansResult.error || subscriptionResult.error || usageResult.error || eventsResult.error || transactionsResult.error) {
      return billingJson({ error: "Could not load billing information.", code: "BILLING_READ_FAILED" }, 500);
    }

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
      billingEvents: eventsResult.data ?? [],
      transactions: transactionsResult.data ?? [],
      checkout: {
        available: getPaymentProvider().configured,
        message: "Paid checkout is not configured. Starter and Pro purchases remain disabled.",
      },
    });
  } catch {
    return billingJson({ error: "Billing service is temporarily unavailable.", code: "BILLING_UNAVAILABLE" }, 503);
  }
}
