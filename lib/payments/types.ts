import type { BillingPlanCode } from "@/lib/billing-config";

export type CheckoutRequest = {
  userId: string;
  planCode: Exclude<BillingPlanCode, "free">;
  returnUrl: string;
  autoRenew: boolean;
  billingPeriod: "monthly";
  renewal?: boolean;
};

export type PaymentMethodSetupRequest = { userId: string; returnUrl: string; replacePaymentMethodReference?: string };

export type VerifiedSubscriptionEvent = {
  kind: "subscription";
  provider: string;
  eventId: string;
  eventType: string;
  customerReference: string;
  subscriptionReference: string;
  transactionReference?: string;
  planCode: Exclude<BillingPlanCode, "free">;
  status: "active" | "past_due" | "canceled";
  cancelAtPeriodEnd: boolean;
  periodStart?: string;
  periodEnd?: string;
  occurredAt: string;
};

export type VerifiedPaymentMethodEvent = {
  kind: "payment_method"; provider: string; eventId: string; eventType: string;
  customerReference: string; paymentMethodReference: string; brand: string; last4: string;
  expMonth: number; expYear: number; occurredAt: string;
};
export type VerifiedPaymentEvent = VerifiedSubscriptionEvent | VerifiedPaymentMethodEvent;

export interface PaymentProvider {
  readonly name: string;
  readonly configured: boolean;
  readonly approvedRedirectOrigins: readonly string[];
  createCheckout(request: CheckoutRequest): Promise<{
    checkoutUrl: string;
    customerReference: string;
    subscriptionReference: string;
  }>;
  createPaymentMethodSetup(request: PaymentMethodSetupRequest): Promise<{ setupUrl: string }>;
  removePaymentMethod(providerPaymentMethodReference: string): Promise<void>;
  cancelSubscription(providerSubscriptionReference: string, options: { atPeriodEnd: true }): Promise<void>;
  verifyWebhook(rawBody: string, signature: string | null): Promise<VerifiedPaymentEvent>;
}

function isBoundedReference(value: unknown, maxLength = 255): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maxLength && !value.includes("\0");
}

export function isVerifiedPaymentEvent(value: unknown): value is VerifiedPaymentEvent {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const event = value as Record<string, unknown>;
  const occurredAt = typeof event.occurredAt === "string" ? Date.parse(event.occurredAt) : Number.NaN;
  const common = (
    isBoundedReference(event.provider, 64) &&
    isBoundedReference(event.eventId) &&
    isBoundedReference(event.eventType, 128) &&
    isBoundedReference(event.customerReference) &&
    Number.isFinite(occurredAt)
  );
  if (!common) return false;
  if (event.kind === "payment_method") return (
    isBoundedReference(event.paymentMethodReference) && isBoundedReference(event.brand, 32) &&
    typeof event.last4 === "string" && /^[0-9]{4}$/.test(event.last4) &&
    Number.isInteger(event.expMonth) && Number(event.expMonth) >= 1 && Number(event.expMonth) <= 12 &&
    Number.isInteger(event.expYear) && Number(event.expYear) >= 2020 && Number(event.expYear) <= 2200
  );
  return (
    event.kind === "subscription" && isBoundedReference(event.subscriptionReference) &&
    (event.transactionReference === undefined || isBoundedReference(event.transactionReference)) &&
    (event.planCode === "starter" || event.planCode === "pro") &&
    (event.status === "active" || event.status === "past_due" || event.status === "canceled") &&
    typeof event.cancelAtPeriodEnd === "boolean" &&
    (event.periodStart === undefined || (typeof event.periodStart === "string" && Number.isFinite(Date.parse(event.periodStart)))) &&
    (event.periodEnd === undefined || (typeof event.periodEnd === "string" && Number.isFinite(Date.parse(event.periodEnd))))
  );
}
