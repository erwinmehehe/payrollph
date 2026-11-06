/**
 * Fiction-only Xendit transport for the tenant billing HTTP proof.
 * Loaded ONLY in the isolated GitHub Actions Next server via NODE_OPTIONS.
 * Network to the real provider is never permitted.
 */
import assert from "node:assert/strict";
import { appendFileSync } from "node:fs";

export const RECEIPT = "/tmp/payrollph-tenant-subscription-provider.ndjson";
export const FIXTURE_KEY = "ci-fictional-xendit-key-no-provider-access";

export function requireFictionalProviderEnv(env = process.env) {
  const required = {
    GITHUB_ACTIONS: "true",
    CI: "true",
    NODE_ENV: "production",
    TENANT_SUBSCRIPTION_PROOF: "fiction-only",
    DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
    SECURITY_SMOKE_URL: "http://127.0.0.1:3000",
    APP_BASE_URL: "https://payroll.example.test",
    XENDIT_BILLING_ENABLED: "true",
    XENDIT_SECRET_KEY: FIXTURE_KEY,
    XENDIT_CALLBACK_TOKEN: "ci-fictional-callback-no-provider-access",
    XENDIT_BUSINESS_ID: "ci-fictional-business",
    WORKER_ENABLED: "false",
    CENTRAL_SCHEDULER_ENABLED: "false",
    XENDIT_PAYOUTS_ENABLED: "false",
    PAYMONGO_DISBURSEMENTS_ENABLED: "false",
    DEMO_MODE: "false",
  };
  for (const [key, expected] of Object.entries(required)) {
    assert.equal(env[key], expected, "TENANT_SUBSCRIPTION_REFUSED: " + key);
  }
  for (const key of [
    "PAYMONGO_SECRET_KEY", "PAYMONGO_WEBHOOK_SECRET", "XENDIT_PAYOUT_SECRET_KEY",
    "RESEND_API_KEY", "SMTP_URL", "STRIPE_SECRET_KEY", "OPENAI_API_KEY",
  ]) {
    assert.ok(!env[key], "TENANT_SUBSCRIPTION_REFUSED: provider credential " + key);
  }
}

export function simulatedXenditFetch(target, options = {}, record = () => {}) {
  const url = target instanceof URL ? target : new URL(target instanceof Request ? target.url : String(target));
  const method = String(options.method ?? (target instanceof Request ? target.method : "GET")).toUpperCase();
  if (url.origin !== "https://api.xendit.co" || method !== "POST") {
    throw Error("TENANT_SUBSCRIPTION_REFUSED: unexpected provider method or origin");
  }
  if (url.pathname === "/sessions") {
    const payload = JSON.parse(String(options.body ?? "{}"));
    assert.match(payload.reference_id, /^linaw_sub_[1-9]\d*_[a-f0-9]{32}$/);
    assert.equal(payload.session_type, "SUBSCRIPTION");
    assert.equal(payload.currency, "PHP");
    assert.ok(Number.isSafeInteger(payload.amount) && payload.amount > 0);
    record({ kind: "start", referenceId: payload.reference_id });
    return new Response(JSON.stringify({
      payment_session_id: "ps_ci_" + payload.reference_id,
      recurring_plan_id: "repl_ci_" + payload.reference_id,
      payment_link_url: "https://checkout.xendit.co/" + payload.reference_id,
      expires_at: "2027-01-01T00:00:00.000Z",
    }), { status: 200, headers: { "content-type": "application/json" } });
  }
  if (/^\/recurring\/plans\/repl_ci_[a-zA-Z0-9_-]+\/deactivate$/.test(url.pathname)) {
    record({ kind: "cancel", planId: url.pathname.split("/")[3] });
    return new Response(JSON.stringify({ status: "INACTIVE" }),
      { status: 200, headers: { "content-type": "application/json" } });
  }
  throw Error("TENANT_SUBSCRIPTION_REFUSED: unreviewed Xendit endpoint " + url.pathname);
}

// Keep importable offline without overriding global network behavior.
if (process.env.TENANT_SUBSCRIPTION_PROOF === "fiction-only" &&
    process.argv.some(arg => /next|start/.test(arg))) {
  requireFictionalProviderEnv();
  const original = globalThis.fetch;
  globalThis.fetch = async function fictionalTransport(input, init = {}) {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.origin === "https://api.xendit.co") {
      return simulatedXenditFetch(input, init, event => {
        appendFileSync(RECEIPT, JSON.stringify(event) + "\n", { flag: "a" });
      });
    }
    if (!["127.0.0.1", "localhost"].includes(url.hostname)) {
      throw Error("TENANT_SUBSCRIPTION_REFUSED: external HTTP egress blocked");
    }
    return original.call(this, input, init);
  };
}
