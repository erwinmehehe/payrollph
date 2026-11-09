/**
 * Egress-blocking PayMongo fixture for one legacy billing POST proof.
 * Never use with a real provider key, production DB, or deployed server.
 */
import assert from "node:assert/strict";
import { appendFileSync } from "node:fs";

export const FIXTURE_KEY = "ci-fictional-paymongo-checkout-no-provider-access";
export const RECEIPT = "/tmp/payrollph-tenant-paymongo-checkout.ndjson";
const PROVIDER_URL = "https://api.paymongo.com/v1/checkout_sessions";

export function requireFictionalPaymongoEnv(env = process.env) {
  let database, server;
  try {
    database = new URL(env.DATABASE_URL ?? "");
    server = new URL(env.SECURITY_SMOKE_URL ?? "");
  } catch {
    throw new Error("TENANT_PAYMONGO_REFUSED: explicit disposable database and server required");
  }
  const blocked = [
    "XENDIT_SECRET_KEY", "XENDIT_PAYOUT_SECRET_KEY", "PAYMONGO_WEBHOOK_SECRET",
    "RESEND_API_KEY", "SMTP_URL", "STRIPE_SECRET_KEY", "MAYA_SECRET_KEY",
  ];
  if (env.CI !== "true" || env.GITHUB_ACTIONS !== "true" ||
      env.NODE_ENV !== "production" || env.TENANT_PAYMONGO_PROOF !== "fiction-only" ||
      env.PAYMONGO_SECRET_KEY !== FIXTURE_KEY ||
      env.APP_BASE_URL !== "https://payroll.example.test" ||
      env.XENDIT_BILLING_ENABLED === "true" ||
      env.PAYMONGO_DISBURSEMENTS_ENABLED === "true" ||
      env.XENDIT_PAYOUTS_ENABLED === "true" ||
      env.WORKER_ENABLED === "true" || env.CENTRAL_SCHEDULER_ENABLED === "true" ||
      env.DEMO_MODE !== "false" ||
      database.protocol !== "postgresql:" || database.hostname !== "127.0.0.1" ||
      database.pathname !== "/app_db" || database.port !== "5432" ||
      server.origin !== "http://127.0.0.1:3000" ||
      blocked.some(key => Boolean(env[key]))) {
    throw new Error("TENANT_PAYMONGO_REFUSED: fictional PG16 localhost and disabled external providers only");
  }
}

export async function simulatedPaymongoFetch(input, init = {}, emit = () => {}) {
  const url = typeof input === "string" ? input : input?.url?.toString() ?? String(input);
  assert.equal(url, PROVIDER_URL, "Only the exact fictional checkout endpoint is permitted");
  assert.equal(init.method, "POST", "Only a fictional checkout POST is permitted");
  assert.equal(new Headers(init.headers).get("authorization"),
    "Basic " + Buffer.from(FIXTURE_KEY + ":").toString("base64"),
    "Only the designated fictional key is permitted");
  const payload = JSON.parse(init.body ?? "{}");
  const attributes = payload?.data?.attributes;
  const metadata = attributes?.metadata;
  const organizationId = Number(metadata?.organization_id);
  assert.ok(Number.isSafeInteger(organizationId) && organizationId > 0);
  assert.match(String(metadata?.invoice_number ?? ""), /^INV-[0-9]{4}-[0-9]{1,7}$/);
  assert.ok(["Core", "Scale", "Enterprise"].includes(metadata?.plan));
  assert.ok(["monthly", "annual"].includes(metadata?.billing_cycle));
  assert.equal(attributes?.success_url?.startsWith("https://payroll.example.test/"), true);
  assert.equal(attributes?.cancel_url?.startsWith("https://payroll.example.test/"), true);
  assert.equal(attributes?.line_items?.length, 1);
  assert.equal(attributes.line_items[0].currency, "PHP");
  assert.ok(Number.isSafeInteger(attributes.line_items[0].amount));
  assert.ok(attributes.line_items[0].amount > 0);
  assert.equal(attributes.line_items[0].quantity, 1);
  const invoice = metadata.invoice_number;
  const id = "cs_ci_" + organizationId + "_" + invoice.replaceAll("-", "_");
  emit({
    kind: "checkout", organizationId, invoiceNumber: invoice,
    amountCents: attributes.line_items[0].amount, plan: metadata.plan,
    billingCycle: metadata.billing_cycle,
  });
  return Response.json({
    data: {
      id,
      attributes: {
        checkout_url: "https://checkout.paymongo.com/fictional-" + organizationId +
          "-" + invoice.replaceAll("-", "_"),
      },
    },
  }, { status: 201 });
}

if (process.env.TENANT_PAYMONGO_PRELOAD === "enabled") {
  requireFictionalPaymongoEnv();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const target = typeof input === "string" ? input : input?.url?.toString() ?? String(input);
    if (target === PROVIDER_URL) {
      return simulatedPaymongoFetch(target, init, event =>
        appendFileSync(RECEIPT, JSON.stringify(event) + "\n", { flag: "a" }));
    }
    let url;
    try { url = new URL(target); } catch { throw new Error("TENANT_PAYMONGO_EGRESS_BLOCKED"); }
    if (url.protocol === "http:" && url.hostname === "127.0.0.1" &&
        url.port === "3000") {
      return originalFetch(input, init);
    }
    throw new Error("TENANT_PAYMONGO_EGRESS_BLOCKED: outbound request refused");
  };
}
