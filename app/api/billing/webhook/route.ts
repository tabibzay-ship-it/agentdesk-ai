import { billingJson, createBillingAdminClient } from "@/lib/billing-server";
import { getPaymentProvider, PaymentProviderUnavailableError } from "@/lib/payments/provider";
import { isVerifiedPaymentEvent } from "@/lib/payments/types";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const provider = getPaymentProvider();
  if (!provider.configured) {
    return billingJson({ error: "Payment provider is not configured.", code: "PAYMENT_PROVIDER_UNAVAILABLE" }, 503);
  }

  try {
    const rawBody = await request.text();
    if (new TextEncoder().encode(rawBody).byteLength > 256_000) {
      return billingJson({ error: "Webhook payload is too large.", code: "PAYLOAD_TOO_LARGE" }, 413);
    }
    const event = await provider.verifyWebhook(rawBody, request.headers.get("payment-signature"));
    if (!isVerifiedPaymentEvent(event)) {
      return billingJson({ error: "Invalid verified webhook event.", code: "INVALID_WEBHOOK_EVENT" }, 400);
    }
    const admin = createBillingAdminClient();
    const { data, error } = event.kind === "payment_method"
      ? await admin.rpc("billing_process_verified_payment_method", {
          p_provider: event.provider, p_event_id: event.eventId, p_event_type: event.eventType,
          p_customer_ref: event.customerReference, p_payment_method_ref: event.paymentMethodReference,
          p_brand: event.brand, p_last4: event.last4, p_exp_month: event.expMonth,
          p_exp_year: event.expYear, p_occurred_at: event.occurredAt,
        })
      : await admin.rpc("billing_process_verified_event_v2", {
          p_provider: event.provider, p_event_id: event.eventId, p_event_type: event.eventType,
          p_customer_ref: event.customerReference, p_subscription_ref: event.subscriptionReference,
          p_transaction_ref: event.transactionReference ?? null, p_plan_code: event.planCode,
          p_status: event.status, p_occurred_at: event.occurredAt,
          p_cancel_at_period_end: event.cancelAtPeriodEnd,
          p_period_start: event.periodStart ?? null, p_period_end: event.periodEnd ?? null,
        });
    if (error) return billingJson({ error: "Webhook reconciliation failed.", code: "RECONCILIATION_FAILED" }, 500);
    return billingJson({ received: true, duplicate: data?.duplicate === true });
  } catch (error) {
    if (error instanceof PaymentProviderUnavailableError) {
      return billingJson({ error: error.message, code: "PAYMENT_PROVIDER_UNAVAILABLE" }, 503);
    }
    return billingJson({ error: "Invalid webhook signature or payload.", code: "INVALID_WEBHOOK" }, 400);
  }
}
