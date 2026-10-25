import { billingJson, createBillingAdminClient } from "@/lib/billing-server";
import { verifyNowPaymentsSignature } from "@/lib/payments/nowpayments";

export const runtime = "nodejs";

const MAX_BODY_BYTES = 256_000;
const STATUSES = new Set(["waiting", "confirming", "confirmed", "sending", "partially_paid", "finished", "failed", "refunded", "expired"]);

export async function POST(request: Request) {
  const secret = process.env.NOWPAYMENTS_IPN_SECRET;
  if (process.env.NOWPAYMENTS_ENABLED !== "true" || !secret) {
    return billingJson({ error: "NOWPayments is not configured.", code: "PAYMENT_PROVIDER_UNAVAILABLE" }, 503);
  }
  const rawBody = await request.text();
  if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) {
    return billingJson({ error: "Webhook payload is too large.", code: "PAYLOAD_TOO_LARGE" }, 413);
  }
  let payload: Record<string, unknown>;
  try { payload = JSON.parse(rawBody); }
  catch { return billingJson({ error: "Invalid webhook payload.", code: "INVALID_WEBHOOK" }, 400); }
  if (!verifyNowPaymentsSignature(payload, request.headers.get("x-nowpayments-sig"), secret)) {
    return billingJson({ error: "Invalid webhook signature.", code: "INVALID_WEBHOOK" }, 401);
  }

  const paymentId = payload.payment_id === undefined ? "" : String(payload.payment_id);
  const orderId = typeof payload.order_id === "string" ? payload.order_id : "";
  const status = typeof payload.payment_status === "string" ? payload.payment_status : "";
  const priceAmount = typeof payload.price_amount === "number" ? payload.price_amount : Number.NaN;
  const priceCurrency = typeof payload.price_currency === "string" ? payload.price_currency.toUpperCase() : "";
  const occurredAt = typeof payload.updated_at === "string" && Number.isFinite(Date.parse(payload.updated_at))
    ? payload.updated_at : new Date().toISOString();
  if (!paymentId || !/^[0-9a-f-]{36}$/i.test(orderId) || !STATUSES.has(status) || !Number.isFinite(priceAmount) || priceAmount < 0 || !/^[A-Z]{3,10}$/.test(priceCurrency)) {
    return billingJson({ error: "Invalid webhook fields.", code: "INVALID_WEBHOOK" }, 400);
  }

  const admin = createBillingAdminClient();
  const { data, error } = await admin.rpc("billing_process_nowpayments_ipn", {
    p_order_id: orderId, p_payment_id: paymentId, p_status: status,
    p_price_amount: priceAmount, p_price_currency: priceCurrency, p_occurred_at: occurredAt,
  });
  if (error) return billingJson({ error: "Webhook reconciliation failed.", code: "RECONCILIATION_FAILED" }, 500);
  return billingJson({ received: true, duplicate: data?.duplicate === true, activated: data?.activated === true });
}
