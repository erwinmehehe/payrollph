"use strict";
/**
 * Offline synthetic POS adapter for the disposable tenant proof's localhost
 * Next process only. Intercepts precise provider GET URLs; NEVER calls them.
 * Rejects all other non-local fetches rather than falling back to the network.
 * Injected via NODE_OPTIONS=--require=... only for the throwaway child server.
 */
const assert = require("node:assert/strict");
const env = process.env;
for (const [name, value] of Object.entries({
  GITHUB_ACTIONS: "true",
  CI: "true",
  TENANT_SECOND_PASS_MODE: "isolated-ci-only",
  TENANT_POS_DEMAND_PROOF: "fictional-provider-only",
  WFM_POS_MOCK_ONLY: "fictional-local-no-network",
  DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
  SECURITY_SMOKE_URL: "http://127.0.0.1:3000",
  WORKER_ENABLED: "false",
  XENDIT_PAYOUTS_ENABLED: "false",
  PAYMONGO_DISBURSEMENTS_ENABLED: "false",
})) assert.equal(env[name], value, "POS_MOCK_REFUSED: " + name);
assert.match(env.WFM_LOYVERSE_ACCESS_TOKEN ?? "", /^ci-fictional-only-[1-9][0-9]*$/);
assert.match(env.WFM_SQUARE_SANDBOX_ACCESS_TOKEN ?? "", /^ci-fictional-only-[1-9][0-9]*$/);
assert.match(env.WFM_LOYVERSE_STORE_ID ?? "",
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
assert.match(env.WFM_SQUARE_SANDBOX_LOCATION_ID ?? "", /^ci_location_[1-9][0-9]*$/);
for (const name of ["PAYMONGO_SECRET_KEY", "XENDIT_SECRET_KEY",
  "XENDIT_PAYOUT_SECRET_KEY", "RESEND_API_KEY", "STRIPE_SECRET_KEY"])
  assert.ok(!env[name], "POS_MOCK_REFUSED: real provider secret " + name);
const originalFetch = globalThis.fetch;
assert.equal(typeof originalFetch, "function");
const success = payload => Response.json(payload, {
  status: 200, headers: { "cache-control": "no-store" },
});
const phDay = iso => new Date(Date.parse(iso) + 8 * 60 * 60 * 1000)
  .toISOString().slice(0, 10);
globalThis.fetch = async function fictionalPosFetch(input, init) {
  const raw = typeof input === "string" ? input
    : input instanceof URL ? input.href : input?.url;
  const u = new URL(raw);
  if (u.protocol === "http:" && u.hostname === "127.0.0.1"
      && u.port === "3000") return originalFetch(input, init);
  const method = String(init?.method ?? input?.method ?? "GET").toUpperCase();
  const auth = new Headers(init?.headers ?? input?.headers).get("authorization");
  if (method !== "GET" || init?.redirect !== "error")
    throw new Error("POS_MOCK_REFUSED: unapproved method or redirect");
  if (u.origin === "https://api.loyverse.com") {
    if (auth !== "Bearer " + env.WFM_LOYVERSE_ACCESS_TOKEN)
      throw new Error("POS_MOCK_REFUSED: Loyverse token not synthetic");
    if (u.pathname === "/v1.0/stores") {
      if (u.searchParams.get("store_ids") !== env.WFM_LOYVERSE_STORE_ID ||
          u.searchParams.get("limit") !== "1")
        throw new Error("POS_MOCK_REFUSED: mismatched Loyverse store");
      return success({ stores: [{
        id: env.WFM_LOYVERSE_STORE_ID, country: "PH",
      }] });
    }
    if (u.pathname === "/v1.0/receipts") {
      if (u.searchParams.get("store_id") !== env.WFM_LOYVERSE_STORE_ID ||
          u.searchParams.get("source") !== "point of sale" ||
          u.searchParams.get("limit") !== "250" ||
          u.searchParams.has("cursor"))
        throw new Error("POS_MOCK_REFUSED: unexpected Loyverse receipt scan");
      const day = phDay(u.searchParams.get("created_at_min"));
      return success({ receipts: [{
        receipt_number: "fictional_receipt_" + env.WFM_LOYVERSE_POS_ORGANIZATION_ID,
        store_id: env.WFM_LOYVERSE_STORE_ID,
        receipt_type: "SALE", source: "point of sale",
        receipt_date: day + "T09:00:00+08:00",
        created_at: day + "T09:15:00+08:00",
      }] });
    }
    throw new Error("POS_MOCK_REFUSED: unknown Loyverse URL");
  }
  if (u.origin === "https://connect.squareupsandbox.com") {
    if (auth !== "Bearer " + env.WFM_SQUARE_SANDBOX_ACCESS_TOKEN ||
        new Headers(init?.headers).get("square-version") !== "2026-09-16")
      throw new Error("POS_MOCK_REFUSED: Square token/version not synthetic");
    if (u.pathname !== "/v2/payments" ||
        u.searchParams.get("location_id") !== env.WFM_SQUARE_SANDBOX_LOCATION_ID ||
        u.searchParams.get("limit") !== "100" || u.searchParams.has("cursor"))
      throw new Error("POS_MOCK_REFUSED: Square scope or path mismatch");
    const day = phDay(u.searchParams.get("begin_time"));
    return success({ payments: [{
      id: "fictional_payment_" + env.WFM_SQUARE_SANDBOX_ORGANIZATION_ID,
      location_id: env.WFM_SQUARE_SANDBOX_LOCATION_ID,
      created_at: day + "T09:15:00+08:00",
      status: "COMPLETED",
    }] });
  }
  throw new Error("POS_MOCK_BLOCKED_EXTERNAL_NETWORK: " + u.origin);
};
