import { billingJson, createBillingAdminClient } from "@/lib/billing-server";
import { getPaymentProvider, PaymentProviderUnavailableError } from "@/lib/payments/provider";

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
    const admin = createBillingAdminClient();
    const { data, error } = await admin.rpc("billing_process_verified_event", {
      p_provider: event.provider,
      p_event_id: event.eventId,
      p_event_type: event.eventType,
      p_customer_ref: event.customerReference,
      p_subscription_ref: event.subscriptionReference,
      p_transaction_ref: event.transactionReference ?? null,
      p_plan_code: event.planCode,
      p_status: event.status,
      p_occurred_at: event.occurredAt,
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
