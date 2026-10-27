/**
 * Test-only fail-closed transport guard, injected via NODE_OPTIONS --import
 * in the disposable DL-01 CI job. Production code and provider URLs are unchanged.
 * A real PayMongo URL is recognized and rewritten BEFORE the native fetch runs.
 */
import assert from "node:assert/strict";

const env = process.env;
const fake = "sk_test_synthetic_no_network";
const server = new URL(env.DL01_PROOF_URL ?? "");
const pg = new URL(env.DATABASE_URL ?? "");
assert.equal(env.CI, "true");
assert.equal(env.GITHUB_ACTIONS, "true");
assert.equal(env.TENANT_DL01_CLOSURE_PROOF, "isolated-ci-only");
assert.equal(server.href, "http://127.0.0.1:3011/");
assert.equal(pg.protocol, "postgresql:");
assert.equal(pg.host, "127.0.0.1:5432");
assert.equal(pg.pathname, "/payroll_dl01_test");
assert.equal(pg.search, "");
assert.equal(env.PAYMONGO_SECRET_KEY, fake,
  "Only one fixed obviously-fake CI credential can enable this adapter");
assert.equal(env.PAYMONGO_WALLET_ID, "wallet_synthetic");
assert.equal(env.PAYMONGO_DISBURSEMENTS_ENABLED, "true");
assert.equal(env.PAYROLL_PAYOUT_PROVIDER, "paymongo");
assert.equal(env.XENDIT_PAYOUTS_ENABLED, "false");
assert.equal(env.DOCUMENT_OBJECT_STORAGE_ENDPOINT, "https://127.0.0.1:8444/");
assert.equal(env.MALWARE_SCAN_URL, "https://127.0.0.1:8443/scan");
assert.equal(env.DOCUMENT_OBJECT_STORAGE_ACCESS_KEY_ID, "DL01_FAKE_ACCESS_ONLY");
assert.equal(env.DOCUMENT_OBJECT_STORAGE_SECRET_ACCESS_KEY, "DL01_FAKE_STORAGE_ONLY");

const actualFetch = globalThis.fetch;
const allowedPaths = [
  /^\/v2\/transfers\/receiving_institutions$/,
  /^\/v2\/wallets\/wallet_synthetic$/,
  /^\/v2\/batch_transfers$/,
];
globalThis.fetch = async (input, options) => {
  const request = new Request(input, options);
  const target = new URL(request.url);
  if (target.origin === "https://api.paymongo.com") {
    if (!allowedPaths.some(pattern => pattern.test(target.pathname)) ||
      target.username || target.password || target.hash ||
      !["GET", "POST"].includes(request.method)) {
      throw new Error("DL01_PROVIDER_EGRESS_REFUSED: unrecognized PayMongo operation");
    }
    const expected = "Basic " + Buffer.from(fake + ":").toString("base64");
    assert.equal(request.headers.get("authorization"), expected,
      "DL01_PROVIDER_EGRESS_REFUSED: non-fixture authorization");
    const rewritten = new URL(target.pathname + target.search, "http://127.0.0.1:3012");
    return actualFetch(rewritten, {
      method: request.method, headers: request.headers,
      body: ["GET", "HEAD"].includes(request.method) ? undefined : request.body,
      duplex: "half", redirect: "error", cache: "no-store", signal: request.signal,
    });
  }
  // All non-PayMongo HTTP traffic, including the TLS scanner and object store,
  // must already have an EXPLICIT loopback destination. Never resolve or fetch
  // any external hostname, even if it looks similar to the official domain.
  if (!["127.0.0.1", "localhost"].includes(target.hostname) ||
    !["http:", "https:"].includes(target.protocol) ||
    ![3011, 3012, 8443, 8444].includes(Number(target.port))) {
    throw new Error("DL01_OUTBOUND_NETWORK_REFUSED: only loopback adapters may be fetched");
  }
  if (target.port === "8443" && (target.protocol !== "https:" || target.pathname !== "/scan"))
    throw new Error("DL01_SCANNER_ENDPOINT_REFUSED");
  if (target.port === "8444" && target.protocol !== "https:")
    throw new Error("DL01_OBJECT_STORAGE_ENDPOINT_REFUSED");
  return actualFetch(request);
};
