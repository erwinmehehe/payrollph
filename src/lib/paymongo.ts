export type PaymongoCheckoutInput = {
  amountCents: number;
  description: string;
  invoiceNumber: string;
  organizationId: number;
  plan: string;
  billingCycle: string;
  successUrl: string;
  cancelUrl: string;
  customerName?: string;
  customerEmail?: string;
};

/**
 * Builds the documented PayMongo v1 Checkout Session payload. The provider call
 * stays server-side, only the hosted checkout URL ever reaches the browser.
 */
export function buildPaymongoCheckoutPayload(input: PaymongoCheckoutInput) {
  return {
    data: {
      attributes: {
        billing: input.customerName || input.customerEmail
          ? { name: input.customerName, email: input.customerEmail }
          : undefined,
        description: input.description,
        line_items: [{
          amount: input.amountCents,
          currency: "PHP",
          name: input.description,
          quantity: 1,
        }],
        payment_method_types: ["card", "gcash", "paymaya"],
        send_email_receipt: Boolean(input.customerEmail),
        show_description: true,
        show_line_items: true,
        success_url: input.successUrl,
        cancel_url: input.cancelUrl,
        metadata: {
          invoice_number: input.invoiceNumber,
          organization_id: String(input.organizationId),
          plan: input.plan,
          billing_cycle: input.billingCycle,
        },
      },
    },
  };
}

export function paymongoAuthorization(secretKey: string) {
  return `Basic ${Buffer.from(`${secretKey}:`).toString("base64")}`;
}

export type PaymongoCheckoutResult = {
  id: string;
  checkoutUrl: string;
};

/**
 * Creates a hosted checkout session. Any provider failure is propagated; callers
 * must not activate a subscription unless a verified payment webhook arrives.
 */
export async function createPaymongoCheckout(input: PaymongoCheckoutInput): Promise<PaymongoCheckoutResult> {
  const secret = process.env.PAYMONGO_SECRET_KEY;
  if (!secret) throw new Error("PAYMONGO_SECRET_KEY is not configured.");

  const response = await fetch("https://api.paymongo.com/v1/checkout_sessions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: paymongoAuthorization(secret),
    },
    body: JSON.stringify(buildPaymongoCheckoutPayload(input)),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.errors?.[0]?.detail ?? payload?.errors?.[0]?.code ?? `PayMongo returned HTTP ${response.status}.`);
  }

  const id = payload?.data?.id;
  const checkoutUrl = payload?.data?.attributes?.checkout_url;
  if (!id || !checkoutUrl) throw new Error("PayMongo returned a checkout session without an id or checkout URL.");
  return { id, checkoutUrl };
}
