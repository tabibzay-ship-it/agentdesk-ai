export type BillingNotice = {
  kind: "info" | "warning" | "error";
  code: "payment_pending" | "payment_failed" | "payment_expired" | "renewal_due" | "subscription_past_due";
  message: string;
};

type SubscriptionSummary = {
  status: string;
  plan_id: string;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
} | null;

type PaymentOrderSummary = {
  status: string;
  kind: string;
  created_at: string;
} | null;

const PENDING_PAYMENT_STATUSES = new Set(["creating", "waiting", "confirming", "sending", "partially_paid"]);

export function buildBillingNotices(
  subscription: SubscriptionSummary,
  latestPaymentOrder: PaymentOrderSummary,
  now = new Date(),
): BillingNotice[] {
  const notices: BillingNotice[] = [];
  if (latestPaymentOrder && PENDING_PAYMENT_STATUSES.has(latestPaymentOrder.status)) {
    notices.push({
      kind: "info",
      code: "payment_pending",
      message: "Payment is pending provider confirmation. Access changes only after a verified confirmation.",
    });
  } else if (latestPaymentOrder?.status === "failed") {
    notices.push({
      kind: "error",
      code: "payment_failed",
      message: "The latest payment failed. No subscription access was granted; start a new payment when ready.",
    });
  } else if (latestPaymentOrder?.status === "expired") {
    notices.push({
      kind: "warning",
      code: "payment_expired",
      message: "The latest payment expired. It cannot activate or renew access; start a new payment when ready.",
    });
  }

  if (!subscription || subscription.plan_id === "free") return notices;
  if (subscription.status === "past_due") {
    notices.push({
      kind: "error",
      code: "subscription_past_due",
      message: "This subscription is past due. Paid access remains unavailable until a new payment is confirmed.",
    });
    return notices;
  }
  if (subscription.status !== "active" || subscription.cancel_at_period_end || !subscription.current_period_end) return notices;

  const periodEnd = Date.parse(subscription.current_period_end);
  if (!Number.isFinite(periodEnd)) return notices;
  const daysRemaining = Math.ceil((periodEnd - now.getTime()) / 86_400_000);
  if (daysRemaining <= 7) {
    notices.push({
      kind: daysRemaining <= 0 ? "error" : "warning",
      code: "renewal_due",
      message: daysRemaining <= 0
        ? "The paid period has ended. Complete a new provider-confirmed payment to renew."
        : `Renewal payment is due in ${daysRemaining} day${daysRemaining === 1 ? "" : "s"}. Automatic wallet charging is disabled.`,
    });
  }
  return notices;
}
