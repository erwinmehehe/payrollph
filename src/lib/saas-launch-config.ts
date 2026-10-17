import { deliveryCapable } from "@/lib/mail-provider";

export type SignupMode = "disabled" | "pilot" | "paid";

/**
 * One public account-creation route, /signup. Pilot registration is separate
 * from paid subscription activation and never enables Xendit billing.
 * Fail closed unless the chosen mode has its required infrastructure.
 */
export function signupMode(env: NodeJS.ProcessEnv = process.env): SignupMode {
  const hasCanonicalUrl = Boolean(env.APP_BASE_URL?.startsWith("https://"))
    || env.NODE_ENV !== "production";
  if (!hasCanonicalUrl || !deliveryCapable(env)) return "disabled";
  if (env.PUBLIC_SIGNUP_MODE === "pilot") return "pilot";
  // Retain the independent go-live approval flag for paid enrollment.
  if (env.PUBLIC_SIGNUP_MODE === "paid"
    && env.SELF_SERVE_SIGNUP_ENABLED === "true"
    && recurringBillingReady(env)) return "paid";
  return "disabled";
}

export function recurringBillingReady(env: NodeJS.ProcessEnv = process.env) {
  return env.XENDIT_BILLING_ENABLED === "true"
    && Boolean(env.XENDIT_SECRET_KEY?.trim())
    && Boolean(env.XENDIT_CALLBACK_TOKEN?.trim())
    && Boolean(env.XENDIT_BUSINESS_ID?.trim())
    && Boolean(env.APP_BASE_URL?.startsWith("https://"));
}

/** Compatibility for billing-only paths; pilot signup never enables billing. */
export function publicSelfServeReady() {
  return signupMode() === "paid";
}

export function publicSignupReady() {
  return signupMode() !== "disabled";
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
