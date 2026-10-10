import { randomUUID } from "node:crypto";
import { checkoutHostnameAllowed } from "@/lib/saas-launch-config";
import { firstRecurringAnchor } from "@/lib/saas-pricing";

export type SubscriptionSessionInput = {
  referenceId: string;
  organizationId: number;
  userId: number;
  name: string;
  email: string;
  plan: string;
  seats: number;
  amountCents: number;
  successUrl: string;
  cancelUrl: string;
};

export function xenditBasicAuth(key: string) {
  return "Basic " + Buffer.from(key + ":").toString("base64");
}

export function buildXenditSubscriptionSession(input: SubscriptionSessionInput, now = new Date()) {
  const amount = input.amountCents / 100;
  if (!Number.isSafeInteger(input.amountCents) || amount <= 0 || !Number.isFinite(amount)) {
    throw new Error("A positive billing amount is required.");
  }
  const firstName = input.name.trim().split(/\s+/)[0] || "Customer";
  const surname = input.name.trim().split(/\s+/).slice(1).join(" ") || "Customer";
  return {
    reference_id: input.referenceId,
    session_type: "SUBSCRIPTION",
    mode: "PAYMENT_LINK",
    currency: "PHP",
    country: "PH",
    amount,
    customer: {
      reference_id: "linaw_owner_" + input.userId,
      type: "INDIVIDUAL",
      email: input.email,
      individual_detail: { given_names: firstName, surname },
    },
    locale: "en",
    description: `Linaw ${input.plan} monthly: ${input.seats} employee seat(s)`,
    subscription: {
      schedule: {
        interval: "MONTH",
        interval_count: 1,
        anchor_date: firstRecurringAnchor(now),
        retry_interval: "DAY",
        retry_interval_count: 1,
        total_retry: 3,
        failed_attempt_notifications: [1, 2, 3],
      },
      immediate_payment: true,
      failed_cycle_action: "STOP",
      payment_link_for_failed_attempt: true,
    },
    success_return_url: input.successUrl,
    cancel_return_url: input.cancelUrl,
  };
}

async function xenditRequest<T>(path: string, method: string, body?: unknown, fetchImpl: typeof fetch = fetch): Promise<T> {
  const key = process.env.XENDIT_SECRET_KEY?.trim();
  if (!key) throw new Error("Xendit billing is not configured.");
  const url = "https://api.xendit.co" + path;
  const headers = new Headers({
    Authorization: xenditBasicAuth(key),
    Accept: "application/json",
    "api-version": "2026-01-01",
  });
  if (body) headers.set("Content-Type", "application/json");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetchImpl(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
      cache: "no-store",
      redirect: "error",
    });
    const json = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error("Xendit subscription request failed (HTTP " + response.status + ").");
    return json as T;
  } finally {
    clearTimeout(timeout);
  }
}

export async function createXenditSubscriptionSession(input: SubscriptionSessionInput) {
  const result = await xenditRequest<{
    payment_session_id: string;
    recurring_plan_id: string;
    payment_link_url: string;
    expires_at?: string;
  }>("/sessions", "POST", buildXenditSubscriptionSession(input));
  if (!result.payment_session_id || !result.recurring_plan_id
    || !result.payment_link_url || !checkoutHostnameAllowed(result.payment_link_url)) {
    throw new Error("Xendit did not return a verified hosted subscription link and recurring plan ID.");
  }
  return result;
}

export async function deactivateXenditSubscription(planId: string) {
  if (!/^repl[_-][a-zA-Z0-9_-]+$/.test(planId)) throw new Error("Invalid recurring plan identifier.");
  return xenditRequest<Record<string, unknown>>("/recurring/plans/" + encodeURIComponent(planId) + "/deactivate", "POST");
}

export function newSubscriptionReference(organizationId: number) {
  return "linaw_sub_" + organizationId + "_" + randomUUID().replace(/-/g, "");
}
