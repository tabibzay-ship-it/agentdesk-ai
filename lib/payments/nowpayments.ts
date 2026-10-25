import "server-only";

import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { BILLING_CURRENCY, BILLING_PLANS } from "@/lib/billing-config";
import { createBillingAdminClient } from "@/lib/billing-server";
import type { CheckoutRequest, PaymentProvider } from "./types";

const PRODUCTION_API_ORIGIN = "https://api.nowpayments.io";
const ALLOWED_API_ORIGINS = new Set([PRODUCTION_API_ORIGIN, "https://api.sandbox.nowpayments.io"]);
const CHECKOUT_HOSTS = new Set(["nowpayments.io", "www.nowpayments.io", "invoice.nowpayments.io", "sandbox.nowpayments.io"]);

type JsonRecord = Record<string, unknown>;

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    const object = value as JsonRecord;
    return Object.fromEntries(Object.keys(object).sort().map((key) => [key, canonicalize(object[key])]));
  }
  return value;
}

export function signNowPaymentsPayload(payload: JsonRecord, secret: string): string {
  return createHmac("sha512", secret).update(JSON.stringify(canonicalize(payload))).digest("hex");
}

export function verifyNowPaymentsSignature(payload: JsonRecord, signature: string | null, secret: string): boolean {
  if (!signature || !/^[a-f0-9]{128}$/i.test(signature) || !secret) return false;
  const expected = Buffer.from(signNowPaymentsPayload(payload, secret), "hex");
  const received = Buffer.from(signature, "hex");
  return expected.length === received.length && timingSafeEqual(expected, received);
}

export function isSafeNowPaymentsCheckoutUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && CHECKOUT_HOSTS.has(url.hostname.toLowerCase());
  } catch { return false; }
}

function appOrigin(): string {
  const value = process.env.AGENTDESK_APP_ORIGIN;
  if (!value) throw new Error("NOWPayments is not configured.");
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("NOWPayments application origin is invalid.");
  }
  return url.origin;
}

function apiOrigin(): string {
  const value = process.env.NOWPAYMENTS_API_ORIGIN?.trim() || PRODUCTION_API_ORIGIN;
  let origin: string;
  try { origin = new URL(value).origin; } catch { throw new Error("NOWPayments API origin is invalid."); }
  if (origin !== value || !ALLOWED_API_ORIGINS.has(origin)) throw new Error("NOWPayments API origin is not approved.");
  return origin;
}

async function createCheckout(request: CheckoutRequest) {
  const apiKey = process.env.NOWPAYMENTS_API_KEY;
  if (!apiKey) throw new Error("NOWPayments is not configured.");
  const orderId = randomUUID();
  const plan = BILLING_PLANS[request.planCode];
  const admin = createBillingAdminClient();
  const { error: insertError } = await admin.from("nowpayments_payment_orders").insert({
    order_id: orderId, user_id: request.userId, plan_code: request.planCode,
    amount_cents: plan.priceCents, currency: BILLING_CURRENCY,
    kind: request.renewal ? "renewal" : "initial", status: "creating",
  });
  if (insertError) throw new Error("Could not record the payment order.");

  const origin = appOrigin();
  const response = await fetch(`${apiOrigin()}/v1/invoice`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": apiKey },
    body: JSON.stringify({
      price_amount: plan.priceCents / 100, price_currency: BILLING_CURRENCY.toLowerCase(), order_id: orderId,
      order_description: `AgentDesk AI ${plan.name} monthly subscription`,
      ipn_callback_url: `${origin}/api/payments/nowpayments/webhook`,
      success_url: request.returnUrl, cancel_url: request.returnUrl,
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  const result = await response.json().catch(() => null) as JsonRecord | null;
  const checkoutUrl = typeof result?.invoice_url === "string" ? result.invoice_url : "";
  const invoiceId = result?.id === undefined ? null : String(result.id);
  if (!response.ok || !invoiceId || !isSafeNowPaymentsCheckoutUrl(checkoutUrl)) {
    await admin.from("nowpayments_payment_orders").update({ status: "api_error" }).eq("order_id", orderId);
    throw new Error("NOWPayments invoice creation failed.");
  }
  const { error: updateError } = await admin.from("nowpayments_payment_orders")
    .update({ provider_invoice_id: invoiceId, status: "waiting" }).eq("order_id", orderId).eq("status", "creating");
  if (updateError) throw new Error("Could not finalize the payment order.");
  return { checkoutUrl, customerReference: orderId, subscriptionReference: orderId };
}

export function createNowPaymentsProvider(): PaymentProvider {
  const configured = process.env.NOWPAYMENTS_ENABLED === "true" && Boolean(
    process.env.NOWPAYMENTS_API_KEY && process.env.NOWPAYMENTS_IPN_SECRET && process.env.AGENTDESK_APP_ORIGIN
  );
  return {
    name: "nowpayments", configured,
    approvedRedirectOrigins: ["https://nowpayments.io", "https://www.nowpayments.io", "https://invoice.nowpayments.io", "https://sandbox.nowpayments.io"],
    createCheckout,
    async createPaymentMethodSetup() { throw new Error("NOWPayments does not support stored payment methods."); },
    async removePaymentMethod() { throw new Error("NOWPayments does not support stored payment methods."); },
    async cancelSubscription() { throw new Error("NOWPayments renewals are customer-initiated."); },
    async verifyWebhook() { throw new Error("Use the dedicated NOWPayments webhook."); },
  };
}
