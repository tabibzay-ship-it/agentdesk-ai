import { authenticateBillingRequest, billingJson } from "@/lib/billing-server";
import { getPaymentProvider, isApprovedPaymentRedirect, PaymentProviderUnavailableError } from "@/lib/payments/provider";
import { BodyError, readJsonObject } from "@/lib/request-security";

export const runtime = "nodejs";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(request: Request) {
  const authentication = await authenticateBillingRequest(request);
  if ("response" in authentication) return authentication.response;
  const { data, error } = await authentication.admin.from("payment_methods")
    .select("id,brand,last4,exp_month,exp_year,is_default,status,created_at")
    .eq("user_id", authentication.user.id).eq("status", "active").order("created_at", { ascending: false });
  if (error) return billingJson({ error: "Payment methods are unavailable until the local migration is applied.", code: "BILLING_MIGRATION_REQUIRED" }, 503);
  return billingJson({ paymentMethods: data ?? [], setupAvailable: getPaymentProvider().configured });
}

export async function POST(request: Request) {
  try {
    const authentication = await authenticateBillingRequest(request);
    if ("response" in authentication) return authentication.response;
    const provider = getPaymentProvider();
    if (!provider.configured) return billingJson({ error: "Secure payment-method setup is not configured.", code: "PAYMENT_PROVIDER_UNAVAILABLE" }, 503);
    const body = await readJsonObject(request, 2048);
    const replaceId = typeof body.replacePaymentMethodId === "string" ? body.replacePaymentMethodId : undefined;
    let replaceReference: string | undefined;
    if (replaceId) {
      if (!uuid.test(replaceId)) return billingJson({ error: "Invalid payment method.", code: "INVALID_PAYMENT_METHOD" }, 400);
      const { data } = await authentication.admin.from("payment_methods").select("provider_payment_method_ref")
        .eq("id", replaceId).eq("user_id", authentication.user.id).eq("status", "active").maybeSingle();
      if (!data) return billingJson({ error: "Payment method not found.", code: "PAYMENT_METHOD_NOT_FOUND" }, 404);
      replaceReference = data.provider_payment_method_ref;
    }
    const setup = await provider.createPaymentMethodSetup({ userId: authentication.user.id,
      returnUrl: new URL("/billing", request.url).href, replacePaymentMethodReference: replaceReference });
    if (!isApprovedPaymentRedirect(provider, setup.setupUrl)) {
      return billingJson({ error: "Unsafe provider URL.", code: "UNSAFE_PROVIDER_URL" }, 502);
    }
    return billingJson({ setupUrl: new URL(setup.setupUrl).href });
  } catch (error) {
    if (error instanceof BodyError) return billingJson({ error: error.message, code: error.code }, error.status);
    if (error instanceof PaymentProviderUnavailableError) return billingJson({ error: error.message, code: "PAYMENT_PROVIDER_UNAVAILABLE" }, 503);
    return billingJson({ error: "Payment-method setup could not be started.", code: "PAYMENT_METHOD_SETUP_FAILED" }, 500);
  }
}

export async function DELETE(request: Request) {
  try {
    const authentication = await authenticateBillingRequest(request);
    if ("response" in authentication) return authentication.response;
    const provider = getPaymentProvider();
    if (!provider.configured) return billingJson({ error: "Payment-method removal is not configured.", code: "PAYMENT_PROVIDER_UNAVAILABLE" }, 503);
    const body = await readJsonObject(request, 1024);
    if (typeof body.paymentMethodId !== "string" || !uuid.test(body.paymentMethodId))
      return billingJson({ error: "Invalid payment method.", code: "INVALID_PAYMENT_METHOD" }, 400);
    const { data } = await authentication.admin.from("payment_methods").select("provider_payment_method_ref")
      .eq("id", body.paymentMethodId).eq("user_id", authentication.user.id).eq("status", "active").maybeSingle();
    if (!data) return billingJson({ error: "Payment method not found.", code: "PAYMENT_METHOD_NOT_FOUND" }, 404);
    await provider.removePaymentMethod(data.provider_payment_method_ref);
    const { error } = await authentication.admin.from("payment_methods").update({ status: "detached", is_default: false,
      updated_at: new Date().toISOString() }).eq("id", body.paymentMethodId).eq("user_id", authentication.user.id);
    if (error) return billingJson({ error: "Provider removed the method, but local reconciliation is pending.", code: "RECONCILIATION_PENDING" }, 202);
    return billingJson({ removed: true });
  } catch (error) {
    if (error instanceof BodyError) return billingJson({ error: error.message, code: error.code }, error.status);
    if (error instanceof PaymentProviderUnavailableError) return billingJson({ error: error.message, code: "PAYMENT_PROVIDER_UNAVAILABLE" }, 503);
    return billingJson({ error: "Payment method could not be removed.", code: "PAYMENT_METHOD_REMOVE_FAILED" }, 500);
  }
}
