import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const workflow = readFileSync(".github/workflows/bootstrap-production-security.yml", "utf8");

test("production security bootstrap is one-shot on merge and can be manually retried", () => {
  assert.ok(workflow.includes('paths:'));
  assert.ok(workflow.includes('".github/workflows/bootstrap-production-security.yml"'));
  assert.ok(workflow.includes("workflow_dispatch:"));
  assert.ok(!workflow.includes("cancel-in-progress: true"));
});

test("bootstrap fails before mutation when protected credentials are unavailable", () => {
  const validate = workflow.indexOf("Validate bootstrap credentials before any mutation");
  const appBase = workflow.indexOf("Configure canonical production origin");
  assert.ok(validate >= 0 && appBase > validate);
  assert.ok(workflow.includes("No PRODUCTION_VERCEL_TOKEN or VERCEL_TOKEN GitHub secret is configured. No production changes were made."));
  assert.ok(workflow.includes("No PRODUCTION_TOTP_ENCRYPTION_KEY or TOTP_ENCRYPTION_KEY GitHub secret is configured. No production changes were made."));
  assert.ok(workflow.includes("parseBankEncryptionKey"));
});

test("bootstrap never overwrites an existing production TOTP master", () => {
  assert.ok(workflow.includes('totp_exists=true'));
  assert.ok(workflow.includes("steps.environment.outputs.totp_exists == 'true'"));
  assert.ok(workflow.includes("Refusing to overwrite it."));
  assert.ok(workflow.includes("steps.environment.outputs.totp_exists == 'false'"));
  assert.ok(workflow.includes("upsert=false"));
  assert.ok(!workflow.includes('TOTP_ENCRYPTION_KEY",\n            value: $value,\n            type: "plain"'));
});

test("existing production encryption key must match the protected GitHub master", () => {
  assert.ok(workflow.includes("bankEncryptionKeyFingerprint"));
  assert.ok(workflow.includes("bankEncryptionFingerprint"));
  assert.ok(workflow.includes('if [ -z "$live" ] || [ "$expected" != "$live" ]'));
});

test("bootstrap only claims success after production and both encryption gates are green", () => {
  assert.ok(workflow.includes('"production-security-config"'));
  assert.ok(workflow.includes('"bank-data-encryption"'));
  assert.ok(workflow.includes('"government-id-encryption"'));
  assert.ok(workflow.includes('sha" = "$GITHUB_SHA"'));
  assert.ok(workflow.includes("Production origin and encryption-at-rest gates are green."));
});
