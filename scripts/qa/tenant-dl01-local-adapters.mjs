/**
 * DL-01 disposable, loopback-only zero-money adapter servers.
 *
 * 3012 HTTP  = PayMongo V2 response shapes needed by the payroll handler.
 * 8443 HTTPS = fake scanner; accepts only fictional marker PDF bytes.
 * 8444 HTTPS = in-memory signed-URL object store, no production bucket.
 *
 * No external network requests, no real provider key, no transfer, no persistent
 * object storage. This file must NEVER be imported by production application code.
 */
import assert from "node:assert/strict";
import { createServer as http } from "node:http";
import { createServer as https } from "node:https";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const env = process.env;
const server = new URL(env.DL01_PROOF_URL ?? "");
const pg = new URL(env.DATABASE_URL ?? "");
assert.equal(env.CI, "true");
assert.equal(env.GITHUB_ACTIONS, "true");
assert.equal(env.TENANT_DL01_CLOSURE_PROOF, "isolated-ci-only");
assert.equal(server.href, "http://127.0.0.1:3011/");
assert.equal(pg.href, "postgresql://postgres:postgres@127.0.0.1:5432/payroll_dl01_test");
assert.equal(env.PAYMONGO_SECRET_KEY, "sk_test_synthetic_no_network");
assert.equal(env.PAYMONGO_DISBURSEMENTS_ENABLED, "true");
assert.equal(env.XENDIT_PAYOUTS_ENABLED, "false");
assert.equal(env.DOCUMENT_OBJECT_STORAGE_ENDPOINT, "https://127.0.0.1:8444/");
assert.equal(env.DOCUMENT_OBJECT_STORAGE_BUCKET, "dl01-fixture-bucket");
assert.equal(env.DOCUMENT_OBJECT_STORAGE_ACCESS_KEY_ID, "DL01_FAKE_ACCESS_ONLY");
assert.equal(env.DOCUMENT_OBJECT_STORAGE_SECRET_ACCESS_KEY, "DL01_FAKE_STORAGE_ONLY");
assert.equal(env.MALWARE_SCAN_TOKEN, "ci-dl01-fake-scanner-token");
const cert = readFileSync("/tmp/dl01-fixture.crt");
const key = readFileSync("/tmp/dl01-fixture.key");
const tls = { cert, key };
const fakeAuth = "Basic " + Buffer.from("sk_test_synthetic_no_network:").toString("base64");
const objects = new Map();
const stats = { provider: [], scans: [], objectPuts: [], objectGets: [] };

const respond = (res, status, payload) => {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(payload));
};
const bytes = async (req, max = 8192) => {
  const parts = [];
  let size = 0;
  for await (const part of req) {
    size += part.length;
    if (size > max) throw new Error("DL01_FIXTURE_BODY_TOO_LARGE");
    parts.push(part);
  }
  return Buffer.concat(parts);
};
const localHost = (req, port) =>
  req.headers.host === "127.0.0.1:" + port &&
  req.socket.localAddress === "127.0.0.1" &&
  req.socket.remoteAddress === "127.0.0.1";

const money = http(async (req, res) => {
  try {
    if (!localHost(req, 3012) || typeof req.url !== "string" ||
      !req.url.startsWith("/") || req.url.startsWith("//")) {
      respond(res, 403, { error: "DL01_MOCK_REJECTS_REAL_PROVIDER_HOST" }); return;
    }
    if (req.method === "GET" && req.url === "/__proof") {
      respond(res, 200, { ...stats, storedObjects: objects.size }); return;
    }
    if (req.headers.authorization !== fakeAuth) {
      respond(res, 403, { error: "Only fixed fictional credential accepted" }); return;
    }
    const url = new URL(req.url, "http://127.0.0.1:3012");
    if (req.method === "GET" && url.pathname === "/v2/transfers/receiving_institutions" &&
      ["instapay", "pesonet"].includes(url.searchParams.get("provider")) &&
      [...url.searchParams.keys()].every(x => x === "provider")) {
      stats.provider.push({ method: "GET", route: "institutions" });
      respond(res, 200, { data: [{ attributes: { name: "BPI", bic: "BOPIPHMM" } }] }); return;
    }
    if (req.method === "GET" && url.pathname === "/v2/wallets/wallet_synthetic" && !url.search) {
      stats.provider.push({ method: "GET", route: "wallet" });
      respond(res, 200, { data: { id: "wallet_synthetic", attributes: {
        status: "enabled", balance: { available: 999999999, pending: 0 },
        account: { account_number: "0000000001", account_name: "DL01 Fictional CI Wallet" },
      } } }); return;
    }
    if (req.method === "POST" && url.pathname === "/v2/batch_transfers" && !url.search) {
      assert.match(req.headers["idempotency-key"] ?? "", /^payroll-run-[1-9]\d*$/);
      const data = JSON.parse((await bytes(req)).toString("utf8"));
      assert.ok(Array.isArray(data.transfers) && data.transfers.length === 1,
        "Only a one-worker fictional batch may reach this test adapter");
      const transfer = data.transfers[0];
      assert.equal(transfer.destination_account.number, "000000000001");
      assert.ok(Number.isSafeInteger(transfer.amount) && transfer.amount > 0);
      const receipt = "batch_tr_dl01_" + stats.provider.length;
      stats.provider.push({
        method: "POST", route: "batch_transfers",
        idempotencyKey: req.headers["idempotency-key"],
        count: 1, amount: transfer.amount,
      });
      respond(res, 200, { data: { id: receipt, transfers: [{
        id: "tr_dl01_" + stats.provider.length,
        reference_number: transfer.reference_number,
        status: "succeeded", amount: transfer.amount,
        provider_reference_number: "CI_ZERO_MONEY", provider_error: null,
      }] } }); return;
    }
    respond(res, 403, { error: "DL01_UNREGISTERED_PAYMONGO_REQUEST" });
  } catch {
    respond(res, 422, { error: "DL01_MOCK_INVALID_REQUEST" });
  }
});

const pdfPrefix = "%PDF-1.4\nSYNTHETIC-PROOF-TENANT-QA:DL01-";
const scanner = https(tls, async (req, res) => {
  try {
    if (!localHost(req, 8443)) { respond(res, 403, { error: "Local scanner only" }); return; }
    if (req.method === "GET" && req.url === "/health") { respond(res, 200, { syntheticOnly: true }); return; }
    if (req.method !== "POST" || req.url !== "/scan" ||
      req.headers.authorization !== "Bearer ci-dl01-fake-scanner-token") {
      respond(res, 403, { error: "DL01_SCANNER_REJECTED" }); return;
    }
    const content = await bytes(req, 2048);
    const body = content.toString("utf8");
    const clean = body.startsWith(pdfPrefix) && body.endsWith("\n%%EOF\n") &&
      /^%PDF-1\.4\nSYNTHETIC-PROOF-TENANT-QA:DL01-[a-zA-Z0-9_-]+\n%%EOF\n$/.test(body);
    stats.scans.push({ clean, byteSize: content.length,
      hash: createHash("sha256").update(content).digest("hex") });
    respond(res, 200, { clean, engine: "CI-only synthetic signature guard (NOT antivirus)" });
  } catch {
    respond(res, 422, { error: "DL01_SCANNER_INVALID_REQUEST" });
  }
});

const store = https(tls, async (req, res) => {
  try {
    if (!localHost(req, 8444)) { respond(res, 403, { error: "Loopback storage only" }); return; }
    const url = new URL(req.url, "https://127.0.0.1:8444");
    const path = url.pathname;
    if (!/^\/dl01-fixture-bucket\/private-documents\/[1-9]\d*\/(?:[1-9]\d*|company)\/[0-9a-f-]{36}$/.test(path) ||
      !/^[a-f0-9]{64}$/.test(url.searchParams.get("X-Amz-Signature") ?? "") ||
      !(url.searchParams.get("X-Amz-Credential") ?? "").startsWith("DL01_FAKE_ACCESS_ONLY/")) {
      respond(res, 403, { error: "DL01_OBJECT_SCOPE_OR_SIGNATURE_REFUSED" }); return;
    }
    if (req.method === "PUT") {
      if (objects.has(path) || req.headers["if-none-match"] !== "*") {
        respond(res, 412, { error: "Cannot overwrite protected synthetic object" }); return;
      }
      const content = await bytes(req, 2048);
      if (!content.toString("utf8").startsWith(pdfPrefix)) {
        respond(res, 422, { error: "Only fictional DL01 object bytes allowed" }); return;
      }
      objects.set(path, content);
      stats.objectPuts.push({ path, sha256: createHash("sha256").update(content).digest("hex") });
      res.writeHead(200, { "cache-control": "no-store" }); res.end(); return;
    }
    if (req.method === "GET") {
      const content = objects.get(path);
      if (!content) { respond(res, 404, { error: "No fixture object" }); return; }
      stats.objectGets.push({ path, size: content.length });
      res.writeHead(200, { "content-type": "application/pdf", "cache-control": "no-store" });
      res.end(content); return;
    }
    respond(res, 405, { error: "Unsupported fixture storage operation" });
  } catch {
    respond(res, 422, { error: "DL01_STORE_INVALID_REQUEST" });
  }
});
for (const [server, port] of [[money, 3012], [scanner, 8443], [store, 8444]]) {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
}
console.log("DL01 fictional adapters ready: localhost 3012/8443/8444; zero-money and in-memory only");
