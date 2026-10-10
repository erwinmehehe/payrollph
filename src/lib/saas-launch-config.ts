import { deliveryCapable } from "@/lib/mail-provider";

export function recurringBillingReady() {
  return process.env.XENDIT_BILLING_ENABLED === "true"
    && Boolean(process.env.XENDIT_SECRET_KEY?.trim())
    && Boolean(process.env.XENDIT_CALLBACK_TOKEN?.trim())
    && Boolean(process.env.XENDIT_BUSINESS_ID?.trim())
    && Boolean(process.env.APP_BASE_URL?.startsWith("https://"));
}

export function publicSelfServeReady() {
  return process.env.SELF_SERVE_SIGNUP_ENABLED === "true"
    && recurringBillingReady()
    && deliveryCapable();
}

export function checkoutHostnameAllowed(value: string) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return false;
    const allowed = ["xendit.co", "xen.to"];
    return allowed.some((domain) => url.hostname === domain || url.hostname.endsWith("." + domain));
  } catch {
    return false;
  }
}
