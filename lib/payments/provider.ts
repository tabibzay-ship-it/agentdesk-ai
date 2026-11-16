import "server-only";

import type { PaymentProvider } from "./types";
import { createNowPaymentsProvider } from "./nowpayments";

export class PaymentProviderUnavailableError extends Error {
  constructor() {
    super("Paid checkout is not available yet.");
    this.name = "PaymentProviderUnavailableError";
  }
}

const disabledProvider: PaymentProvider = {
  name: "disabled",
  configured: false,
  approvedRedirectOrigins: [],
  async createCheckout() { throw new PaymentProviderUnavailableError(); },
  async createPaymentMethodSetup() { throw new PaymentProviderUnavailableError(); },
  async removePaymentMethod() { throw new PaymentProviderUnavailableError(); },
  async cancelSubscription() { throw new PaymentProviderUnavailableError(); },
  async verifyWebhook() { throw new PaymentProviderUnavailableError(); },
};

// Add a reviewed provider implementation here only after credentials, signed
// webhooks, and server-side reconciliation are approved and configured.
export function getPaymentProvider(): PaymentProvider {
  const nowPayments = createNowPaymentsProvider();
  if (nowPayments.configured) return nowPayments;
  return disabledProvider;
}

/**
 * Providers that can store payment methods and cancel a subscription on the
 * server. NOWPayments is customer-initiated only: every renewal is a new
 * invoice, and it never stores a reusable payment method.
 */
export function supportsProviderManagedBilling(provider: PaymentProvider): boolean {
  return provider.configured && provider.name !== "nowpayments";
}

export function isApprovedPaymentRedirect(provider: PaymentProvider, value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      provider.approvedRedirectOrigins.includes(url.origin)
    );
  } catch {
    return false;
  }
}
