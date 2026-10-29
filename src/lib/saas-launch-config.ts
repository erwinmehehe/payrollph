import { deliveryCapable } from "@/lib/mail-provider";
import { privatePilotInviteReady } from "@/lib/private-pilot-invite";

export type SignupMode = "disabled" | "pilot" | "paid";

/**
 * One public account-creation route, /signup. Pilot registration is separate
 * from paid subscription activation and never enables Xendit billing.
 * Fail closed unless the chosen mode has its required infrastructure.
 */
export function signupMode(env: NodeJS.ProcessEnv = process.env): SignupMode {
  const hasCanonicalUrl = Boolean(env.APP_BASE_URL?.startsWith("https://"))
    || env.NODE_ENV !== "production";
  if (!hasCanonicalUrl) return "disabled";
  if (env.PUBLIC_SIGNUP_MODE === "pilot" && (deliveryCapable(env) || privatePilotInviteReady(env))) return "pilot";
  if (!deliveryCapable(env)) return "disabled";
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

/** Public account creation may NOT fall back to a per-process rate counter.
 * A cross-instance outage must not silently weaken registration abuse limits.
 */
export function signupRateLimitResponse(
  rate: { allowed: boolean; mode: string },
  throttledMessage = "Too many registration attempts. Please try later.",
): Response | null {
  if (rate.mode !== "distributed-postgres") {
    return Response.json({ error: "Registration security check is temporarily unavailable." }, {
      status: 503, headers: { "Cache-Control": "no-store" },
    });
  }
  if (!rate.allowed) {
    return Response.json({ error: throttledMessage }, {
      status: 429, headers: { "Cache-Control": "no-store" },
    });
  }
  return null;
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
