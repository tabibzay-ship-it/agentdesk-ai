import { isBillingPlanCode, isPaidPlan } from "@/lib/billing-config";
import { authenticateBillingRequest, billingJson } from "@/lib/billing-server";
import { getPaymentProvider, PaymentProviderUnavailableError } from "@/lib/payments/provider";
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

    const { admin, user } = authentication;
    const { error: ensureError } = await admin.rpc("billing_ensure_free_subscription", { p_user_id: user.id });
    if (ensureError) return billingJson({ error: "Billing data is not available yet.", code: "BILLING_MIGRATION_REQUIRED" }, 503);
    const { data: subscription, error: subscriptionError } = await admin.from("subscriptions")
      .select("status,plan_id,pending_plan_id,provider_customer_ref,provider_subscription_ref")
      .eq("user_id", user.id).maybeSingle();
    if (subscriptionError || !subscription) return billingJson({ error: "Could not load the subscription.", code: "BILLING_READ_FAILED" }, 500);
    if (subscription.plan_id !== "free" || subscription.pending_plan_id || subscription.provider_customer_ref || subscription.provider_subscription_ref) {
      return billingJson({ error: "A paid subscription or checkout is already associated with this account.", code: "DUPLICATE_SUBSCRIPTION" }, 409);
    }

    const returnUrl = new URL("/billing", request.url).href;
    const checkout = await provider.createCheckout({
      userId: user.id,
      planCode: body.planCode,
      returnUrl,
    });
    const { error: saveError } = await admin.from("subscriptions").update({
      pending_plan_id: body.planCode,
      status: "incomplete",
      provider: provider.name,
      provider_customer_ref: checkout.customerReference,
      provider_subscription_ref: checkout.subscriptionReference,
      updated_at: new Date().toISOString(),
    }).eq("user_id", user.id).eq("plan_id", "free").is("pending_plan_id", null);
    if (saveError) return billingJson({ error: "Checkout could not be safely recorded.", code: "CHECKOUT_STATE_FAILED" }, 500);
    return billingJson({ checkoutUrl: checkout.checkoutUrl });
  } catch (error) {
    if (error instanceof PaymentProviderUnavailableError) {
      return billingJson({ error: error.message, code: "PAYMENT_PROVIDER_UNAVAILABLE" }, 503);
    }
    return billingJson({ error: "Checkout could not be started.", code: "CHECKOUT_FAILED" }, 500);
  }
}
