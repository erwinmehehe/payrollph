/**
 * Test-process-only scanner transport: no real scanner, network or customer files.
 * This preload is used ONLY for the Next server in the disposable CI job.
 */
"use strict";
const assert = require("node:assert/strict");
const SCAN = "https://scanner.fixture.invalid/scan";
assert.equal(process.env.CI, "true");
assert.equal(process.env.GITHUB_ACTIONS, "true");
assert.equal(process.env.TENANT_SECOND_PASS_MODE, "isolated-ci-only");
assert.equal(process.env.TENANT_DOCUMENT_UPLOAD_MODE, "fictional-pg16-http");
assert.equal(process.env.MALWARE_SCAN_URL, SCAN);
assert.equal(process.env.DATABASE_URL, "postgresql://postgres:postgres@127.0.0.1:5432/app_db");
const nativeFetch = globalThis.fetch;
assert.equal(typeof nativeFetch, "function");
globalThis.fetch = async function isolatedDocumentScanner(input, init = {}) {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (url.href === SCAN) {
    const headers = new Headers(init.headers ?? (input instanceof Request ? input.headers : undefined));
    const payload = Buffer.from(init.body ?? []);
    const token = process.env.MALWARE_SCAN_TOKEN;
    assert.ok(token && token.startsWith("ci-fictional-scanner-"));
    assert.equal(headers.get("authorization"), "Bearer " + token);
    assert.equal(headers.get("content-type"), "application/pdf");
    assert.ok(payload.length > 12 && payload.subarray(0, 4).equals(Buffer.from("%PDF")),
      "Only bounded fictional PDF fixtures may be marked clean");
    assert.ok(payload.length < 10000, "Refuse arbitrary document scanning");
    assert.ok(payload.includes(Buffer.from("FICTIONAL-DOCUMENT-TEST-ONLY")),
      "Refuse non-fixture content");
    return new Response(JSON.stringify({ clean: true, engine: "fictional-ci-scanner" }), {
      status: 200, headers: { "content-type": "application/json" },
    });
  }
  if (url.protocol === "http:" && (url.hostname === "127.0.0.1" || url.hostname === "localhost")) {
    return nativeFetch(input, init);
  }
  throw new Error("DOCUMENT_FIXTURE_EGRESS_REFUSED");
};
