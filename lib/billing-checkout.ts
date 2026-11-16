import type { BillingPlanCode } from "@/lib/billing-config";

/**
 * A checkout that has not produced a terminal provider result is held for this
 * long before the next attempt may reclaim the account. Provider invoices can
 * stay payable for a while, so the window must not be too short.
 */
export const CHECKOUT_STALE_MS = 2 * 60 * 60 * 1000;

const IN_FLIGHT_ORDER_STATUSES = new Set(["creating", "waiting", "confirming", "sending", "partially_paid"]);

export type CheckoutSubscriptionState = {
  status: string;
  plan_id: string;
  pending_plan_id: string | null;
  provider: string | null;
  provider_customer_ref: string | null;
  provider_subscription_ref: string | null;
  updated_at?: string | null;
};

export type CheckoutOrderState = {
  status: string;
  kind: string;
  created_at: string;
} | null;

export type CheckoutDecision =
  | { action: "renewal" }
  | { action: "initial"; releaseStale: boolean }
  | { action: "rejected"; reason: "in_progress" | "plan_change" };

function ageMs(value: string | null | undefined, now: Date): number {
  const timestamp = Date.parse(value ?? "");
  return Number.isFinite(timestamp) ? now.getTime() - timestamp : Number.POSITIVE_INFINITY;
}

/**
 * Decides whether an authenticated account may start a provider checkout.
 *
 * The previous implementation only allowed a brand-new free account or an
 * active same-plan renewal. Any abandoned, failed, or expired first checkout
 * left `pending_plan_id` behind and permanently locked the account out with a
 * 409. This decision lets an account recover as soon as its pending checkout is
 * terminal or stale, while still blocking genuinely concurrent checkouts.
 */
export function decideCheckout(
  subscription: CheckoutSubscriptionState,
  latestOrder: CheckoutOrderState,
  planCode: Exclude<BillingPlanCode, "free">,
  providerName: string,
  now = new Date(),
): CheckoutDecision {
  if (subscription.status === "incomplete") {
    const orderInFlight = latestOrder !== null && IN_FLIGHT_ORDER_STATUSES.has(latestOrder.status);
    const orderRecent = latestOrder !== null && ageMs(latestOrder.created_at, now) < CHECKOUT_STALE_MS;
    const stateRecent = ageMs(subscription.updated_at, now) < CHECKOUT_STALE_MS;
    // A fresh incomplete row without an order means another request already
    // claimed the slot and is still waiting on the provider.
    if ((orderInFlight && orderRecent) || (latestOrder === null && stateRecent)) {
      return { action: "rejected", reason: "in_progress" };
    }
    return { action: "initial", releaseStale: true };
  }

  if (subscription.status === "active" && subscription.plan_id !== "free") {
    const isRenewal = providerName === "nowpayments" &&
      subscription.provider === "nowpayments" &&
      subscription.plan_id === planCode &&
      subscription.pending_plan_id === null;
    if (isRenewal) return { action: "renewal" };
    return { action: "rejected", reason: "plan_change" };
  }

  // Canceled, past-due, expired, and free accounts may always start a fresh
  // customer-initiated payment. A paid plan keeps its provider identity, so it
  // never needs to be cleared before re-subscribing.
  return { action: "initial", releaseStale: false };
}

/**
 * Builds the post-payment return URL. Behind a proxy or preview host the
 * incoming request URL is not the canonical origin, so the configured app
 * origin wins when it is a valid HTTPS origin.
 */
export function resolveBillingReturnUrl(requestUrl: string, configuredOrigin?: string): string {
  if (configuredOrigin) {
    try {
      const origin = new URL(configuredOrigin);
      if (
        origin.protocol === "https:" &&
        !origin.username &&
        !origin.password &&
        origin.pathname === "/" &&
        !origin.search &&
        !origin.hash
      ) {
        return new URL("/billing", origin.origin).href;
      }
    } catch {
      // Fall back to the request origin below.
    }
  }
  return new URL("/billing", requestUrl).href;
}
