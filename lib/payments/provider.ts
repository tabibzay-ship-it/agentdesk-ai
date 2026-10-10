import "server-only";

import type { PaymentProvider } from "./types";

export class PaymentProviderUnavailableError extends Error {
  constructor() {
    super("Paid checkout is not available yet.");
    this.name = "PaymentProviderUnavailableError";
  }
}

const disabledProvider: PaymentProvider = {
  name: "disabled",
  configured: false,
  async createCheckout() { throw new PaymentProviderUnavailableError(); },
  async cancelSubscription() { throw new PaymentProviderUnavailableError(); },
  async verifyWebhook() { throw new PaymentProviderUnavailableError(); },
};

// Add a reviewed provider implementation here only after credentials, signed
// webhooks, and server-side reconciliation are approved and configured.
export function getPaymentProvider(): PaymentProvider {
  return disabledProvider;
}
