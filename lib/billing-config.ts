export const BILLING_CURRENCY = "USD" as const;

export const BILLING_PLANS = {
  free: {
    code: "free",
    name: "Free",
    priceCents: 0,
    agentLimit: 1,
    monthlyResponseLimit: 100,
    description: "For testing your first customer-support agent.",
  },
  starter: {
    code: "starter",
    name: "Starter",
    priceCents: 900,
    agentLimit: 3,
    monthlyResponseLimit: 2_000,
    description: "For small teams ready to support more customers.",
  },
  pro: {
    code: "pro",
    name: "Pro",
    priceCents: 2_900,
    agentLimit: 10,
    monthlyResponseLimit: 10_000,
    description: "For growing support operations.",
  },
} as const;

export type BillingPlanCode = keyof typeof BILLING_PLANS;

export function isBillingPlanCode(value: unknown): value is BillingPlanCode {
  return typeof value === "string" && Object.hasOwn(BILLING_PLANS, value);
}

export function isPaidPlan(code: BillingPlanCode): code is Exclude<BillingPlanCode, "free"> {
  return BILLING_PLANS[code].priceCents > 0;
}
