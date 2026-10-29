import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// Every secret the runtime reads must be discoverable by an operator. Two real
// gaps shipped undocumented: PII_ENCRYPTION_KEY (every employee/contractor write
// with a TIN/SSS number threw without it) and the five DOCUMENT_OBJECT_STORAGE_*
// values (uploads fail with "not configured"). All of these fail closed, so the
// failure is safe but opaque. This keeps new secrets from repeating that.
const SECRET_LIKE = /(KEY|SECRET|TOKEN|PASSWORD|CREDENTIAL|PEPPER)$|DATABASE_URL$/;

// Secrets that are documented in a dedicated runbook instead of the generic
// example/README. Each entry must name that document, the document must still
// mention the variable, and src must still read it (so the list cannot rot).
// Money-moving provider credentials are kept out of the generic example on
// purpose: they should only be introduced by following their runbook.
const DOCUMENTED_ELSEWHERE = new Map([
  ["AUDIT_SEALER_DATABASE_URL", "docs/engineering/issue908-audit-role-isolation-plan.md"],
  ["COMPENSATION_RECOVERY_APPROVER_PUBLIC_KEY", "docs/compensation-automation-recovery.md"],
  ["PII_LEGACY_GOVERNMENT_ID_KEY", "docs/security/pii-dedicated-key-transition.md"],
  ["PII_LEGACY_PHOTO_KEY", "docs/security/pii-dedicated-key-transition.md"],
  ["WFM_LOYVERSE_ACCESS_TOKEN", "docs/wfm-loyverse-pos-aggregate-demand.md"],
  ["WFM_SQUARE_SANDBOX_ACCESS_TOKEN", "docs/wfm-square-sandbox-demand-adapter.md"],
  // Guard-only credential marker; never configure it for the disposable salary proof.
  ["STRIPE_SECRET_KEY", "docs/qa/hcm-salary-correction-entity-tenant.md"],
  ["XENDIT_SECRET_KEY", "docs/launch/self-service-billing-runbook.md"],
  ["XENDIT_CALLBACK_TOKEN", "docs/launch/self-service-billing-runbook.md"],
  ["XENDIT_PAYOUT_SECRET_KEY", "docs/xendit-default-payroll-payout.md"],
  ["XENDIT_PAYOUT_CALLBACK_TOKEN", "docs/xendit-default-payroll-payout.md"],
]);

function sourceFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...sourceFiles(path));
    else if (/\.(ts|tsx|mjs)$/.test(name)) out.push(path);
  }
  return out;
}

function envNamesRead() {
  const names = new Set();
  const direct = /(?:process\.env|\benv)(?:\.|\[["'])([A-Z][A-Z0-9_]{3,})/g;
  const constant = /\b[A-Z0-9_]*ENV\s*[=:]\s*["']([A-Z][A-Z0-9_]{3,})["']/g;
  for (const file of sourceFiles("src")) {
    const text = readFileSync(file, "utf8");
    for (const match of text.matchAll(direct)) names.add(match[1]);
    for (const match of text.matchAll(constant)) names.add(match[1]);
  }
  return names;
}

const example = readFileSync(".env.local.example", "utf8");
const readme = readFileSync("README.md", "utf8");
const inExample = (name) => new RegExp("^#? ?" + name + "=", "m").test(example);
const inReadme = (name) => new RegExp("\\b" + name + "\\b").test(readme);

test("every secret-like environment variable the runtime reads is documented", () => {
  const read = [...envNamesRead()].filter((name) => SECRET_LIKE.test(name));
  assert.ok(read.length >= 20, "expected to find the runtime's secret variables, saw " + read.length);
  const undocumented = read
    .filter((name) => !inExample(name) && !inReadme(name) && !DOCUMENTED_ELSEWHERE.has(name))
    .sort();
  assert.deepEqual(undocumented, [],
    "add these to .env.local.example and the README environment table, or to DOCUMENTED_ELSEWHERE with their runbook: "
    + undocumented.join(", "));
});

test("the 'documented elsewhere' allowlist is not stale", () => {
  const read = envNamesRead();
  for (const [name, doc] of DOCUMENTED_ELSEWHERE) {
    assert.ok(read.has(name), name + " is no longer read by src; remove it from the allowlist");
    assert.ok(existsSync(doc), doc + " does not exist");
    assert.match(readFileSync(doc, "utf8"), new RegExp("\\b" + name + "\\b"), doc + " no longer mentions " + name);
    assert.ok(!inExample(name) && !inReadme(name), name + " is now in the example/README; drop it from the allowlist");
  }
});

test("the previously missing secrets stay documented in both places", () => {
  for (const name of [
    "PII_ENCRYPTION_KEY", "DOCUMENT_OBJECT_STORAGE_ENDPOINT", "DOCUMENT_OBJECT_STORAGE_BUCKET",
    "DOCUMENT_OBJECT_STORAGE_REGION", "DOCUMENT_OBJECT_STORAGE_ACCESS_KEY_ID",
    "DOCUMENT_OBJECT_STORAGE_SECRET_ACCESS_KEY", "PUBLIC_INTAKE_PROOF_SECRET",
    "PUNCH_DEVICE_HASH_KEY", "HEALTH_TOKEN", "HCM_SLA_CRON_SECRET",
    "BANK_DATA_ENCRYPTION_KEY_PREVIOUS", "TOTP_ENCRYPTION_KEY_PREVIOUS",
  ]) {
    assert.ok(inExample(name), name + " missing from .env.local.example");
    assert.ok(inReadme(name), name + " missing from README.md");
  }
});
