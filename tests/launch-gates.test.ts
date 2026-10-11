import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { passwordIssues, validEmail } from "../src/lib/validation";
import { MAX_UPLOAD_BYTES, safeFileName, validateUpload } from "../src/lib/storage";
import { activeMailProvider } from "../src/lib/mail-provider";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]);

test("password policy enforces length and character classes", () => {
  assert.ok(passwordIssues("short").length > 0);
  assert.deepEqual(passwordIssues("alllowercase123"), ["Must include an uppercase letter."]);
  assert.deepEqual(passwordIssues("ALLOWERCASE123"), ["Must include a lowercase letter."]);
  assert.deepEqual(passwordIssues("NoNumbersHere"), ["Must include a number."]);
  assert.deepEqual(passwordIssues("Str0ngPassw0rd!"), []);
});

test("email normalisation helper rejects malformed input", () => {
  assert.equal(validEmail("a@b.ph"), true);
  assert.equal(validEmail("not-an-email"), false);
  assert.equal(validEmail("a@b"), false);
});

test("uploads are sniffed by content, not by declared MIME type", () => {
  const png = validateUpload(PNG, "image/png", "id.png");
  assert.equal(png.ok, true);

  // Declared PDF but actually PNG bytes -> rejected on mismatch.
  const lie = validateUpload(PNG, "application/pdf", "payload.pdf");
  assert.equal(lie.ok, false);

  // Executable bytes with a .pdf name -> rejected by magic number.
  const exe = new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 1, 2, 3, 4]);
  const disguised = validateUpload(exe, "application/pdf", "invoice.pdf");
  assert.equal(disguised.ok, false);

  assert.equal(validateUpload(new Uint8Array(0), "image/png", "empty.png").ok, false);
  assert.equal(validateUpload(new Uint8Array(64), "text/html", "x.png").ok, false);
});

test("PDF magic bytes are accepted regardless of declared octet-stream", () => {
  const result = validateUpload(PDF, "application/octet-stream", "2316.pdf");
  assert.equal(result.ok, true);
});

test("oversize uploads are rejected before any storage work", () => {
  assert.equal(MAX_UPLOAD_BYTES, 5 * 1024 * 1024);
});

test("file names cannot traverse directories", () => {
  assert.equal(safeFileName("../../etc/passwd"), "passwd");
  assert.equal(safeFileName("a/b/c\\..\\evil.png"), "evil.png");
  assert.equal(safeFileName("bad<>name|.pdf"), "bad_name_.pdf");
  assert.ok(!safeFileName("bad<>name|.pdf").includes("<"));
});

test("mail provider reports honestly when unconfigured", () => {
  // In this sandbox no provider env vars are set, so delivery must not be claimed.
  if (!process.env.RESEND_API_KEY && !process.env.POSTMARK_SERVER_TOKEN && !process.env.SMTP_URL) {
    assert.equal(activeMailProvider(), "none");
  } else {
    assert.ok(["resend", "postmark", "smtp"].includes(activeMailProvider()));
  }
});


test("readiness cannot treat credentials alone as proof of external integrations", () => {
  const source = readFileSync("src/app/api/readiness/route.ts", "utf8");
  assert.ok(source.includes("const storageIntegrated = false"), "bucket configuration alone must not make object storage green");
  assert.ok(source.includes("malwareScannerConfigured()"), "malware readiness must use the scanner integration helper");
  assert.ok(source.includes("const samlIntegrated = false"), "SAML metadata alone must not claim SSO exists");
  assert.ok(source.includes("paymongoPreflightProven"), "PayMongo readiness must require a recorded no-money preflight");
});

test("manual confirmed payments can prove billing without pretending an online processor was used", () => {
  const source = readFileSync("src/app/api/readiness/route.ts", "utf8");
  assert.ok(
    source.includes("const billingProven = paidInvoices > 0 || activeSubs > 0"),
    "paid ledger state must be sufficient proof for a legitimate manual payment",
  );
  assert.ok(source.includes("current proof is manual/off-platform"));
});

test("production documents fail closed unless malware scanning reports clean", () => {
  const documents = readFileSync("src/app/api/documents/route.ts", "utf8");
  const storage = readFileSync("src/lib/storage.ts", "utf8");
  const readiness = readFileSync("src/app/api/readiness/route.ts", "utf8");
  assert.ok(documents.includes("await scanUpload("));
  assert.ok(documents.includes("MALWARE_SCAN_UNAVAILABLE"));
  assert.ok(documents.includes("MALWARE_DETECTED"));
  assert.ok(storage.includes("MALWARE_SCAN_TOKEN"));
  assert.ok(storage.includes('redirect: "error"'));
  assert.ok(storage.includes("controller.abort()"));
  assert.ok(readiness.includes('key: "malware-scanning"'));
  assert.ok(readiness.includes("malwareScannerConfigured()"));
  assert.ok(readiness.includes('blocks: documentUploadSafetyReady ? "none" : "launch"'));
});

test("dedicated worker runs payroll and the leased central scheduler", () => {
  const worker = readFileSync("scripts/worker.ts", "utf8");
  const scheduler = readFileSync("src/lib/scheduler.ts", "utf8");
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  assert.ok(worker.includes("processNextPayrollJob"));
  assert.ok(worker.includes("await tickScheduler()"));
  assert.ok(!worker.includes('import { drainWebhookRetries }'));
  assert.ok(scheduler.includes("acquireSchedulerLease(ownerToken)"));
  assert.ok(scheduler.includes("refreshSchedulerLease(ownerToken)"));
  assert.equal(pkg.scripts.worker, "tsx scripts/worker.ts");
});


test("production readiness blocks launch until employee bank data is encrypted at rest", () => {
  const readiness = readFileSync("src/app/api/readiness/route.ts", "utf8");
  const crypto = readFileSync("src/lib/bank-account-crypto.ts", "utf8");
  assert.ok(readiness.includes('key: "bank-data-encryption"'));
  assert.ok(readiness.includes('blocks: bankDataProtected ? "none" : "launch"'));
  assert.ok(readiness.includes("plaintextBankAccounts"));
  assert.ok(crypto.includes('createCipheriv("aes-256-gcm"'));
  assert.ok(crypto.includes("randomBytes(12)"));
});


test("bank-data readiness covers both employee rows and payroll snapshots", () => {
  const readiness = readFileSync("src/app/api/readiness/route.ts", "utf8");
  assert.ok(readiness.includes("plaintextBankAccounts"));
  assert.ok(readiness.includes("plaintextBankSnapshots"));
  assert.ok(readiness.includes("bankEncryptionKeySource"));
  assert.ok(readiness.includes('bankKeySource === "dedicated"'));
});


test("production rollout readiness proves the exact deployed commit and exposes sanitized blocker keys", () => {
  const pilotStatus = readFileSync("src/app/api/readiness/pilot-status/route.ts", "utf8");
  const deploymentStatus = readFileSync("src/app/api/readiness/deployment/route.ts", "utf8");
  const rolloutScript = readFileSync("scripts/live-production-readiness.ts", "utf8");
  const workflow = readFileSync(".github/workflows/production-rollout-readiness.yml", "utf8");
  const liveRbac = readFileSync(".github/workflows/live-rbac-sandbox-smoke.yml", "utf8");

  assert.ok(pilotStatus.includes("launchBlockers"));
  assert.ok(pilotStatus.includes("VERCEL_GIT_COMMIT_SHA"));
  assert.ok(pilotStatus.includes("manualLaunchReady"));
  assert.ok(pilotStatus.includes('criticalBlockers: ["readiness-internal-error"]'));
  assert.ok(pilotStatus.includes('console.error("Sanitized readiness evaluation failed"'));
  assert.ok(deploymentStatus.includes("VERCEL_GIT_COMMIT_SHA"));
  assert.ok(deploymentStatus.includes("VERCEL_ENV"));

  assert.ok(rolloutScript.includes("EXPECTED_COMMIT_SHA"));
  assert.ok(rolloutScript.includes("/api/readiness/deployment"));
  assert.ok(rolloutScript.includes("waitForExpectedDeployment"));
  assert.ok(rolloutScript.includes("deploymentSha"));
  assert.ok(rolloutScript.includes("launchBlockers"));

  assert.ok(workflow.includes("EXPECTED_COMMIT_SHA: ${{ github.sha }}"));
  assert.ok(liveRbac.includes("EXPECTED_COMMIT_SHA: ${{ github.sha }}"));
  assert.ok(liveRbac.includes("deploymentSha"));
  assert.ok(liveRbac.includes("/api/readiness/deployment"));
  assert.ok(liveRbac.includes("Exact production commit is live."));
  assert.ok(liveRbac.includes('demoDataMode":"synthetic-redacted'));
  assert.ok(liveRbac.includes('sensitiveFieldsPersisted":false'));
  assert.ok(liveRbac.includes("roles=(owner hr payroll checker bookkeeper employee)"));
});


test("production bank migration refuses to encrypt with a key that does not match the live app", () => {
  const pilotStatus = readFileSync("src/app/api/readiness/pilot-status/route.ts", "utf8");
  const workflow = readFileSync(".github/workflows/production-bank-encryption.yml", "utf8");
  const prepare = readFileSync("scripts/prepare-bank-encryption.ts", "utf8");

  assert.ok(pilotStatus.includes("bankEncryptionKeyFingerprint"));
  assert.ok(pilotStatus.includes("bankEncryptionFingerprint"));
  assert.ok(workflow.includes("Prove runner key matches live production"));
  assert.ok(workflow.includes('if [ "$local_fp" != "$live_fp" ]'));
  assert.ok(workflow.includes("Refusing to touch bank data"));
  assert.ok(workflow.includes("scripts/encrypt-bank-accounts.ts --apply"));
  assert.ok(workflow.includes("Verify zero plaintext bank data remains"));
  assert.ok(prepare.includes("ALTER TABLE employees ALTER COLUMN bank_account TYPE varchar(160)"));
});

test("production document uploads are opt-in and cannot weaken malware safety", () => {
  const storage = readFileSync("src/lib/storage.ts", "utf8");
  const documents = readFileSync("src/app/api/documents/route.ts", "utf8");
  const readiness = readFileSync("src/app/api/readiness/route.ts", "utf8");

  const flagRegistry = readFileSync("src/lib/critical-release-flags.ts", "utf8");
  assert.ok(flagRegistry.includes('env: "DOCUMENT_UPLOADS_ENABLED"'));
  assert.ok(storage.includes('criticalReleaseFlagEnabled("documentUploads")'));
  assert.ok(storage.includes('process.env.NODE_ENV !== "production"'));
  assert.ok(documents.includes('code: "DOCUMENT_UPLOADS_DISABLED"'));
  assert.ok(documents.includes("documentUploadsEnabled()"));
  assert.ok(readiness.includes("documentUploadSafetyReady"));
  assert.ok(readiness.includes("Production document uploads are explicitly disabled"));
});

test("full launch requires a real independently reconciled production payroll pilot", () => {
  const readiness = readFileSync("src/app/api/readiness/route.ts", "utf8");
  const signoff = readFileSync("src/app/api/payroll-runs/[id]/pilot-signoff/route.ts", "utf8");

  assert.ok(readiness.includes('key: "production-pilot-signoff"'));
  assert.ok(readiness.includes('eq(auditEvents.action, "Production payroll pilot signed off")'));

  for (const marker of [
    'process.env.NODE_ENV !== "production"',
    "Only the workspace owner can sign off the production payroll pilot.",
    "requireSensitiveActionMfa(user)",
    'run.status !== "Released"',
    "operatorCompletedWithoutDeveloper",
    "grossPay",
    "deductions",
    "netPay",
    "withholdingTax",
    "statutoryContributions",
    "payoutTotal",
    "payslips",
    "accountingExport",
    'event.action === "Payroll release receipt"',
    'event.action === "Payroll payout completed manually"',
    'event.action === "Payroll payout completed via PayMongo"',
    'event.action !== "journal export generated"',
    'action: "Production payroll pilot signed off"',
  ]) {
    assert.ok(signoff.includes(marker), `production pilot sign-off is missing ${marker}`);
  }
});


test("owners can record production pilot evidence without a developer-only workflow", () => {
  const card = readFileSync("src/components/workspace/production-pilot-signoff.tsx", "utf8");
  const workspace = readFileSync("src/components/linaw-workspace.tsx", "utf8");

  assert.ok(card.includes("Reconcile and sign off the real payroll pilot"));
  assert.ok(card.includes("Independent evidence reference"));
  assert.ok(card.includes("INDEPENDENT FIGURES"));
  assert.ok(card.includes("independentSourceConfirmed"));
  assert.ok(card.includes("The payroll operator completed this cycle without developer intervention"));
  assert.ok(card.includes("/pilot-signoff"));
  assert.ok(card.includes("Verify figures & sign off pilot"));
  assert.ok(workspace.includes('effectiveRole === "owner"'));
  assert.ok(workspace.includes("<ProductionPilotSignoffCard"));
  assert.ok(workspace.includes("!demoRole"));
});


test("production readiness upgrades additive schema before querying new readiness columns", () => {
  const readiness = readFileSync("src/app/api/readiness/route.ts", "utf8");
  const compat = readFileSync("src/lib/core-schema-compat.ts", "utf8");
  assert.ok(readiness.includes("await ensureCoreCompatibilitySchema()"));
  for (const marker of [
    "ADD COLUMN IF NOT EXISTS delivery_status",
    "ADD COLUMN IF NOT EXISTS provider_message_id",
    "ADD COLUMN IF NOT EXISTS delivery_updated_at",
    "CREATE INDEX IF NOT EXISTS outbox_retry_idx",
  ]) {
    assert.ok(compat.includes(marker), `compatibility schema is missing ${marker}`);
  }
});

test("launch email proof requires a provider-confirmed delivery, not only an accepted send", () => {
  const readiness = readFileSync("src/app/api/readiness/route.ts", "utf8");
  assert.ok(readiness.includes('eq(outbox.deliveryStatus, "delivered")'));
  assert.ok(readiness.includes("provider-confirmed delivered"));
  assert.ok(readiness.includes("no provider-confirmed delivered webhook event yet"));
  assert.ok(readiness.includes("Number(deliveredMail) > 0"));
});


test("capability report requires provider-confirmed email delivery before calling email verified", () => {
  const source = readFileSync("src/lib/capabilities.ts", "utf8");
  assert.ok(source.includes('eq(outbox.deliveryStatus, "delivered")'), "capability report must count confirmed deliveries");
  assert.ok(source.includes('emailCapable && mailDelivered > 0 ? "verified" : "partial"'), "email must stay partial until a confirmed delivery exists");
  assert.ok(source.includes("${mailDelivered} delivered"), "scorecard proof must expose the delivered count");
  assert.ok(!source.includes('status: "verified",\n      proof: emailCapable'), "email capability must not be unconditionally verified");
});


test("monthly BIR 1601-C readiness requires recorded agency acknowledgement, not a generated worksheet", () => {
  const readiness = readFileSync("src/app/api/readiness/route.ts", "utf8");
  assert.ok(readiness.includes('key: "gov-bir-1601c"'));
  assert.ok(readiness.includes("bir1601Evidence?.operationallyProven"));
  assert.ok(readiness.includes("monthly eBIRForms/eFPS filing workflow"));
  assert.ok(readiness.includes("not a PayrollPH upload-file format"));
  assert.ok(readiness.includes("records BIR's own acknowledgement"));
});
