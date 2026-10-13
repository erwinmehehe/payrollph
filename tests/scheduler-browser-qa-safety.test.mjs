import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("synthetic HRIS browser production runtime meets the dedicated PII boot requirement", () => {
  const workflow = readFileSync(".github/workflows/hris-journey-browser-qa.yml", "utf8");
  const instrumentation = readFileSync("src/instrumentation.ts", "utf8");
  const keyPolicy = readFileSync("src/lib/pii-key-policy.ts", "utf8");
  assert.match(instrumentation, /assertProductionPiiKey\(\)/);
  assert.match(keyPolicy, /PII_ENCRYPTION_KEY must be a dedicated 32-byte key before production boot/);
  assert.match(workflow, /PII_ENCRYPTION_KEY=\$pii_key/);
  assert.match(workflow, /BANK_DATA_ENCRYPTION_KEY=\$bank_key/);
  assert.match(workflow, /pii_key=\$\(openssl rand -hex 32\)/);
  assert.match(workflow, /bank_key=\$\(openssl rand -hex 32\)/);
  assert.match(workflow, /::add-mask::\$pii_key/);
  assert.match(workflow, /::add-mask::\$bank_key/);
  assert.match(workflow, /postgresql:\/\/postgres:postgres@127\.0\.0\.1:5432\/app_db/);
  assert.match(workflow, /PAYMONGO_DISBURSEMENTS_ENABLED: "false"/);
  assert.match(workflow, /XENDIT_PAYOUTS_ENABLED: "false"/);
  assert.doesNotMatch(workflow, /PII_ENCRYPTION_KEY:\s*["']?(?:222|444)/);
});

test("intentionally disabled scheduler is informational, real failure is announced", () => {
  const banner = readFileSync("src/components/workspace/scheduler-admin-banner.tsx", "utf8");
  assert.match(banner, /const disabled = health\.state === "scheduler-disabled"/);
  assert.match(banner, /const alert = !health\.ok && !disabled/);
  assert.match(banner, /role=\{alert \? "alert" : "status"\}/);
  assert.match(banner, /Scheduler is disabled \(development mode\)/);
  assert.match(banner, /Attention required/);
});
