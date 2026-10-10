import type { BillingPlanCode } from "@/lib/billing-config";

export type CheckoutRequest = {
  userId: string;
  planCode: Exclude<BillingPlanCode, "free">;
  returnUrl: string;
};

export type VerifiedPaymentEvent = {
  provider: string;
  eventId: string;
  eventType: string;
  customerReference: string;
  subscriptionReference: string;
  transactionReference?: string;
  planCode: Exclude<BillingPlanCode, "free">;
  status: "active" | "past_due" | "canceled";
  occurredAt: string;
};

export interface PaymentProvider {
  readonly name: string;
  readonly configured: boolean;
  createCheckout(request: CheckoutRequest): Promise<{
    checkoutUrl: string;
    customerReference: string;
    subscriptionReference: string;
  }>;
  cancelSubscription(providerSubscriptionReference: string): Promise<void>;
  verifyWebhook(rawBody: string, signature: string | null): Promise<VerifiedPaymentEvent>;
}
