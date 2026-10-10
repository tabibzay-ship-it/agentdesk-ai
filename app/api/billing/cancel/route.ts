import { authenticateBillingRequest, billingJson } from "@/lib/billing-server";
import { getPaymentProvider, PaymentProviderUnavailableError } from "@/lib/payments/provider";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const authentication = await authenticateBillingRequest(request);
    if ("response" in authentication) return authentication.response;
    const provider = getPaymentProvider();
    if (!provider.configured) {
      return billingJson({ error: "Subscription cancellation is unavailable until a payment provider is connected.", code: "PAYMENT_PROVIDER_UNAVAILABLE" }, 503);
    }

    const { data: subscription, error } = await authentication.admin.from("subscriptions")
      .select("status,provider_subscription_ref")
      .eq("user_id", authentication.user.id).maybeSingle();
    if (error) return billingJson({ error: "Could not load the subscription.", code: "BILLING_READ_FAILED" }, 500);
    if (!subscription?.provider_subscription_ref || subscription.status !== "active") {
      return billingJson({ error: "There is no active paid subscription to cancel.", code: "NO_ACTIVE_SUBSCRIPTION" }, 409);
    }

    await provider.cancelSubscription(subscription.provider_subscription_ref);
    // Provider cancellation is reconciled by a verified webhook. The browser
    // response never changes paid entitlements or payment state.
    return billingJson({ accepted: true, message: "Cancellation requested. Status updates after provider confirmation." }, 202);
  } catch (error) {
    if (error instanceof PaymentProviderUnavailableError) {
      return billingJson({ error: error.message, code: "PAYMENT_PROVIDER_UNAVAILABLE" }, 503);
    }
    return billingJson({ error: "Cancellation could not be requested.", code: "CANCELLATION_FAILED" }, 500);
  }
}
