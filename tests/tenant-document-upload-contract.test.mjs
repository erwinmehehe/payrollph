import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  requireDisposableDocumentEnv, assertDeniedDocumentResponse,
  assertNoChanges, APP_ORIGIN, SCANNER_ORIGIN,
} from "../scripts/qa/tenant-document-upload-contract.mjs";

const fixture = {
  CI: "true", GITHUB_ACTIONS: "true",
  TENANT_SECOND_PASS_MODE: "isolated-ci-only",
  TENANT_DOCUMENT_UPLOAD_MODE: "fictional-pg16-http",
  NODE_ENV: "production", DOCUMENT_UPLOADS_ENABLED: "true",
  PAYMONGO_DISBURSEMENTS_ENABLED: "false", XENDIT_PAYOUTS_ENABLED: "false",
  WORKER_ENABLED: "false", CENTRAL_SCHEDULER_ENABLED: "false",
  MALWARE_SCAN_URL: SCANNER_ORIGIN,
  MALWARE_SCAN_TOKEN: "ci-fictional-scanner-token",
  DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
  SECURITY_SMOKE_URL: APP_ORIGIN,
};
test("refuses real networks, providers, worker or non-disposable upload flags", () => {
  assert.doesNotThrow(() => requireDisposableDocumentEnv(fixture));
  const invalid = [
    ["CI", "false"], ["GITHUB_ACTIONS", "false"],
    ["SECURITY_SMOKE_URL", "https://prod.example.com"],
    ["DATABASE_URL", "postgresql://prod.example.com/actual"],
    ["DOCUMENT_UPLOADS_ENABLED", "false"],
    ["EMPLOYEE_DOCUMENT_VAULT_ENABLED", "true"],
    ["MALWARE_SCAN_URL", "https://real-scanner.example/"],
    ["MALWARE_SCAN_TOKEN", "real-token"],
    ["WORKER_ENABLED", "true"], ["PAYMONGO_SECRET_KEY", "fake-prod-key"],
  ];
  for (const [name, value] of invalid) {
    assert.throws(() => requireDisposableDocumentEnv({ ...fixture, [name]: value }),
      undefined, "Must refuse " + name);
  }
});

test("denial oracle rejects success and foreign-employer leaks, including headers", () => {
  const response = (status, text = "", headers = {}) => ({
    status, text, headers: new Headers(headers),
  });
  assert.doesNotThrow(() => assertDeniedDocumentResponse(response(403, '{"error":"Denied"}'),
    403, ["VICTIM-PRIVATE-EXAMPLE"]));
  assert.throws(() => assertDeniedDocumentResponse(response(201), 403, []));
  assert.throws(() => assertDeniedDocumentResponse(response(403, "VICTIM-PRIVATE-EXAMPLE"), 403,
    ["VICTIM-PRIVATE-EXAMPLE"]));
  assert.throws(() => assertDeniedDocumentResponse(response(403, "Denied",
    { "x-info": "VICTIM-PRIVATE-EXAMPLE" }), 403, ["VICTIM-PRIVATE-EXAMPLE"]));
  assert.throws(() => assertNoChanges({ row: "v" }, { row: "changed" }, "veto"));
});

test("source is precisely pinned and cannot silently earn manifest credit", () => {
  const bytes = readFileSync("src/app/api/documents/route.ts");
  const gitSha = createHash("sha1").update("blob " + bytes.length + "\0")
    .update(bytes).digest("hex");
  assert.equal(gitSha, "cd8d559e9186ddae6c0f00e7af4bc4c4f5e37d38",
    "Source change requires independent review of the upload proof");
  const manifest = JSON.parse(readFileSync(
    "scripts/qa/tenant-isolation-coverage-manifest.json", "utf8"));
  const methods = manifest.allApiRouteFiles["src/app/api/documents/route.ts"].methods;
  const post = methods.find(method => method.name === "POST");
  assert.equal(post.status, "GAP");
  assert.equal(post.testedBy, null);
  assert.match(manifest.acceptanceStatus, /^NOT ACCEPTED/);
  const preload = readFileSync("scripts/qa/tenant-document-upload-scan-preload.cjs", "utf8");
  assert.ok(preload.includes("DOCUMENT_FIXTURE_EGRESS_REFUSED"));
  assert.ok(preload.includes("FICTIONAL-DOCUMENT-TEST-ONLY"));
  const workflow = readFileSync(".github/workflows/tenant-document-upload-http.yml", "utf8");
  assert.ok(workflow.includes("node --import tsx scripts/qa/tenant-document-upload-http.mjs"));
  assert.ok(workflow.includes("tenant-document-upload-scan-preload.cjs"));
});
