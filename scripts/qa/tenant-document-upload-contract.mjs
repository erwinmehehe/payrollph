/**
 * Independent DL-01 legacy multipart upload proof. No production traffic,
 * malware certification or method-level tenant coverage credit.
 */
import assert from "node:assert/strict";
export const ENDPOINT = "/api/documents";
export const APP_ORIGIN = "http://127.0.0.1:3000";
export const SCANNER_ORIGIN = "https://scanner.fixture.invalid/scan";

export function requireDisposableDocumentEnv(env = process.env) {
  for (const [key, value] of Object.entries({
    CI: "true", GITHUB_ACTIONS: "true",
    TENANT_SECOND_PASS_MODE: "isolated-ci-only",
    TENANT_DOCUMENT_UPLOAD_MODE: "fictional-pg16-http",
    NODE_ENV: "production", DOCUMENT_UPLOADS_ENABLED: "true",
    PAYMONGO_DISBURSEMENTS_ENABLED: "false",
    XENDIT_PAYOUTS_ENABLED: "false", WORKER_ENABLED: "false",
    CENTRAL_SCHEDULER_ENABLED: "false",
    MALWARE_SCAN_URL: SCANNER_ORIGIN,
    DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
    SECURITY_SMOKE_URL: APP_ORIGIN,
  })) assert.equal(env[key], value, "Refusing non-disposable setting: " + key);
  assert.notEqual(env.EMPLOYEE_DOCUMENT_VAULT_ENABLED, "true",
    "Private object uploads are not part of this legacy database proof");
  assert.ok((env.MALWARE_SCAN_TOKEN ?? "").startsWith("ci-fictional-scanner-"),
    "Only a fixture scanner token is allowed");
  for (const name of ["PAYMONGO_SECRET_KEY", "XENDIT_SECRET_KEY",
    "XENDIT_PAYOUT_SECRET_KEY", "RESEND_API_KEY", "POSTMARK_SERVER_TOKEN",
    "SMTP_URL", "STRIPE_SECRET_KEY", "OPENAI_API_KEY"]) {
    assert.ok(!env[name], "Refusing external provider credentials: " + name);
  }
}

export function assertDeniedDocumentResponse(response, status, hidden = []) {
  assert.equal(response.status, status,
    "Unexpected denial: " + response.status + " " + String(response.text ?? "").slice(0, 240));
  for (const marker of hidden) {
    assert.ok(typeof marker === "string" && marker.length > 4, "Negative control requires a real marker");
    assert.ok(!String(response.text ?? "").includes(marker), "Denied response disclosed a foreign marker");
    for (const [key, value] of response.headers ?? []) {
      assert.ok(!(key + ": " + value).includes(marker), "Denied headers disclosed a foreign marker");
    }
  }
}

export function assertStoredDocument(response, subject, expected) {
  assert.equal(response.status, 201, "Authorized upload must return HTTP 201");
  assert.ok(response.json && Number.isSafeInteger(response.json.id) && response.json.id > 0);
  assert.equal(response.json.fileName, expected.fileName);
  assert.equal(response.json.sha256, expected.sha256);
  assert.equal(response.json.byteSize, expected.byteSize);
  assert.equal(response.json.detectedMime, "application/pdf");
  assert.equal(response.json.scan?.scannedClean, true,
    "The stubbed clean scan must be explicitly reported (not a production AV acceptance)");
  assert.equal(response.json.scan?.engine, "fictional-ci-scanner");
  assert.ok(!response.text.includes(expected.forbiddenMarker),
    "Own-success response must not contain another employer's marker");
  if (expected.requirementId != null) {
    assert.equal(response.json.compliance?.organizationId, subject.org.id);
    assert.equal(response.json.compliance?.employeeId, subject.worker.id);
    assert.equal(response.json.compliance?.requirementId, expected.requirementId);
    assert.equal(response.json.compliance?.status, "submitted");
    assert.equal(response.json.compliance?.documentId, response.json.id);
  }
}

export function assertNoChanges(before, after, description) {
  assert.deepEqual(after, before, "Denied/vetoed upload changed persisted tenant data: " + description);
}
