import { isBillingPlanCode, isPaidPlan } from "@/lib/billing-config";
import { decideCheckout, resolveBillingReturnUrl } from "@/lib/billing-checkout";
import { authenticateBillingRequest, billingJson } from "@/lib/billing-server";
import { getPaymentProvider, isApprovedPaymentRedirect, PaymentProviderUnavailableError } from "@/lib/payments/provider";
import { BodyError, readJsonObject } from "@/lib/request-security";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const authentication = await authenticateBillingRequest(request);
    if ("response" in authentication) return authentication.response;

    let body: Record<string, unknown>;
    try { body = await readJsonObject(request, 2048); }
    catch (error) {
      if (error instanceof BodyError) return billingJson({ error: error.message, code: error.code }, error.status);
      return billingJson({ error: "Invalid request body.", code: "INVALID_REQUEST" }, 400);
    }

    if (!isBillingPlanCode(body.planCode) || !isPaidPlan(body.planCode)) {
      return billingJson({ error: "Select a valid paid plan.", code: "INVALID_PLAN" }, 400);
    }
    const provider = getPaymentProvider();
    if (!provider.configured) {
      return billingJson({ error: "Paid checkout is not available yet.", code: "PAYMENT_PROVIDER_UNAVAILABLE" }, 503);
    }
    const customerInitiated = provider.name === "nowpayments";
    if (customerInitiated ? body.renewalConsent !== true : body.autoRenew !== true) {
      return billingJson({
        error: customerInitiated
          ? "Monthly renewal terms require explicit consent. Each renewal payment must be authorized separately."
          : "Monthly automatic renewal requires explicit consent.",
        code: "RENEWAL_CONSENT_REQUIRED",
      }, 400);
    }

    const { admin, user } = authentication;
    const { error: ensureError } = await admin.rpc("billing_ensure_free_subscription", { p_user_id: user.id });
    if (ensureError) return billingJson({ error: "Billing data is not available yet.", code: "BILLING_MIGRATION_REQUIRED" }, 503);
    const { data: subscription, error: subscriptionError } = await admin.from("subscriptions")
      .select("status,plan_id,pending_plan_id,provider,provider_customer_ref,provider_subscription_ref,updated_at")
      .eq("user_id", user.id).maybeSingle();
    if (subscriptionError || !subscription) return billingJson({ error: "Could not load the subscription.", code: "BILLING_READ_FAILED" }, 500);

    const orderResult = provider.name === "nowpayments"
      ? await admin.from("nowpayments_payment_orders")
        .select("status,kind,created_at").eq("user_id", user.id)
        .order("created_at", { ascending: false }).limit(1).maybeSingle()
      : { data: null, error: null };
    // The order ledger is an optimization for recovery, not a requirement for
    // checkout. A missing migration must not block an otherwise valid payment.
    const latestOrder = orderResult.error ? null : orderResult.data;

    const decision = decideCheckout(subscription, latestOrder, body.planCode, provider.name);
    if (decision.action === "rejected") {
      return billingJson({
        error: decision.reason === "in_progress"
          ? "A checkout for this account is already in progress. Finish it or wait for it to expire before starting another."
          : "A different paid plan is already active. Contact support before changing plans.",
        code: "DUPLICATE_SUBSCRIPTION",
      }, 409);
    }

    const observedStatus = subscription.status;
    const releasedStatus = subscription.plan_id === "free"
      ? "active"
      : observedStatus === "incomplete" ? "past_due" : observedStatus;
    const nowIso = new Date().toISOString();

    // Atomically claim the account before calling the provider. The claim also
    // clears a stale checkout so a previously stuck account can pay again.
    let claimStatus = observedStatus;
    let claimValues: {
      status?: string;
      pending_plan_id?: string | null;
      provider?: string | null;
      provider_customer_ref?: string | null;
      provider_subscription_ref?: string | null;
      updated_at: string;
    } = { updated_at: nowIso };
    if (decision.action === "initial") {
      if (decision.releaseStale) {
        claimStatus = releasedStatus;
        claimValues = subscription.plan_id === "free"
          ? { status: "active", pending_plan_id: null, provider: null, provider_customer_ref: null, provider_subscription_ref: null, updated_at: nowIso }
          : { status: releasedStatus, pending_plan_id: null, updated_at: nowIso };
      } else {
        claimStatus = "incomplete";
        claimValues = { status: "incomplete", updated_at: nowIso };
      }
    }

    let claimQuery = admin.from("subscriptions").update(claimValues)
      .eq("user_id", user.id).eq("status", observedStatus);
    claimQuery = subscription.pending_plan_id === null
      ? claimQuery.is("pending_plan_id", null)
      : claimQuery.eq("pending_plan_id", subscription.pending_plan_id);
    if (subscription.updated_at) claimQuery = claimQuery.eq("updated_at", subscription.updated_at);
    const { data: claimedRows, error: claimError } = await claimQuery.select("updated_at");
    if (claimError) return billingJson({ error: "Checkout could not be safely recorded.", code: "CHECKOUT_STATE_FAILED" }, 500);
    if (!claimedRows?.length) {
      return billingJson({
        error: "A checkout for this account is already in progress. Finish it or wait for it to expire before starting another.",
        code: "DUPLICATE_SUBSCRIPTION",
      }, 409);
    }
    const claimUpdatedAt = claimedRows[0]?.updated_at as string | undefined;

    const returnUrl = resolveBillingReturnUrl(request.url, process.env.AGENTDESK_APP_ORIGIN);
    let checkout;
    try {
      checkout = await provider.createCheckout({
        userId: user.id,
        planCode: body.planCode,
        returnUrl,
        autoRenew: !customerInitiated,
        billingPeriod: "monthly",
        renewal: decision.action === "renewal",
      });
    } catch (error) {
      // Release the claim so a provider outage does not lock the account for
      // the full staleness window.
      let releaseQuery = admin.from("subscriptions").update({ status: releasedStatus, updated_at: new Date().toISOString() })
        .eq("user_id", user.id).eq("status", claimStatus);
      if (claimUpdatedAt) releaseQuery = releaseQuery.eq("updated_at", claimUpdatedAt);
      await releaseQuery.select("user_id");
      throw error;
    }

    if (!isApprovedPaymentRedirect(provider, checkout.checkoutUrl)) {
      return billingJson({ error: "Unsafe provider URL.", code: "UNSAFE_PROVIDER_URL" }, 502);
    }
    if (decision.action === "renewal") return billingJson({ checkoutUrl: checkout.checkoutUrl, renewal: true });

    let finalizeQuery = admin.from("subscriptions").update({
      pending_plan_id: body.planCode,
      status: "incomplete",
      provider: provider.name,
      provider_customer_ref: checkout.customerReference,
      provider_subscription_ref: checkout.subscriptionReference,
      updated_at: new Date().toISOString(),
    }).eq("user_id", user.id).eq("status", claimStatus);
    if (claimUpdatedAt) finalizeQuery = finalizeQuery.eq("updated_at", claimUpdatedAt);
    // If a verified webhook changed the row mid-flight, the payment ledger still
    // reconciles the order; never overwrite a newer activation state.
    await finalizeQuery.select("user_id");

    return billingJson({ checkoutUrl: checkout.checkoutUrl });
  } catch (error) {
    if (error instanceof PaymentProviderUnavailableError) {
      return billingJson({ error: error.message, code: "PAYMENT_PROVIDER_UNAVAILABLE" }, 503);
    }
    return billingJson({ error: "Checkout could not be started.", code: "CHECKOUT_FAILED" }, 500);
  }
}
