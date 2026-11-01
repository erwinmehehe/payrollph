import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
const read = (path) => readFileSync(path, "utf8");
const route = (name) => read("src/app/api/payroll-runs/[id]/" + name + "/route.ts");
const runner = read("scripts/qa/tenant-batches/payroll-runs-path-http.mjs");
const workflow = read(".github/workflows/tenant-payroll-run-path-boundaries.yml");

test("seven exact method keys, actual higher-ID victim, and explicit zero-credit classification", () => {
  const keys = [
    "POST payroll-runs/[id]/submit-review",
    "POST payroll-runs/[id]/exports",
    "POST payroll-runs/[id]/pilot-signoff",
    "POST payroll-runs/[id]/release",
    "GET payroll-runs/[id]/xendit-payout",
    "POST payroll-runs/[id]/xendit-payout",
    "POST payroll-runs/[id]/payout-reconciliation",
  ];
  for (const key of keys) {
    assert.ok(runner.includes('"' + key + '"'), "missing exact method " + key);
  }
  assert.match(runner, /for \(const label of \["ATTA", "ATTB", "VICTIM"\]\)/);
  assert.match(runner, /victim\.runs\[key\]\.id > attackers\[0\]\.runs\[key\]\.id/);
  assert.match(runner, /for \(const attacker of attackers\)/);
  assert.match(runner, /attacker\.runs\.sibling\.id/);
  assert.match(runner, /own\.json\.ledger\.rows\[0\]\.employeeNo/);
  assert.match(runner, /businessState\(victim\.org\.id\)/);
  assert.match(runner, /uncreditedDenials, 12/);
  assert.match(runner, /newMethodCredits: 0, productionCertified: false/);
  assert.doesNotMatch(runner, /submitXenditPayroll|createPaymongoPayrollRetry|preflightPaymongoPayrollDisbursement/);
});

test("disposable runtime explicitly refuses money, live providers, remote URLs and workers", () => {
  for (const guard of [
    "requireTenantTableDisposable(env)",
    'env.WORKER_ENABLED, "false"',
    'env.CENTRAL_SCHEDULER_ENABLED, "false"',
    'env.XENDIT_PAYOUTS_ENABLED, "true"',
    'env.XENDIT_PAYOUTS_LIVE_APPROVED, "true"',
    'env.PAYMONGO_DISBURSEMENTS_ENABLED, "true"',
    '!env.PAYMONGO_SECRET_KEY && !env.PAYMONGO_WALLET_ID',
    "!env.XENDIT_PAYOUT_SECRET_KEY",
    "!env.RESEND_API_KEY && !env.XENDIT_PAYOUT_CALLBACK_TOKEN",
    'env.NODE_ENV, "production"',
  ]) assert.ok(runner.includes(guard), "missing boundary assertion: " + guard);
  for (const flag of [
    "WORKER_ENABLED=false",
    "CENTRAL_SCHEDULER_ENABLED=false",
    "XENDIT_PAYOUTS_ENABLED=false",
    "PAYMONGO_DISBURSEMENTS_ENABLED=false",
    "XENDIT_PAYOUTS_LIVE_APPROVED=false",
    "PAYROLL_PAYOUT_PROVIDER=paymongo",
  ]) assert.ok(workflow.includes(flag), flag + " must remain disabled in CI");
  assert.match(workflow, /image: postgres:16/);
  assert.match(workflow, /npx tsx scripts\/qa\/tenant-batches\/payroll-runs-path-http\.mjs/);
  assert.match(workflow, /npm start -- -H 127\.0\.0\.1/);
  assert.match(workflow, /profile: \[default, multi-entity\]/);
  assert.match(workflow, /permissions:\n  contents: read/);
});

test("submit-review checks a currently active employer membership AND enabled user before assigning payroll checker", () => {
  const source = route("submit-review");
  assert.match(source, /eq\(userOrganizations\.organizationId, run\.organizationId\)/);
  assert.match(source, /eq\(userOrganizations\.active, true\)/);
  assert.match(source, /eq\(users\.id, approverUserId\)/);
  assert.match(source, /eq\(users\.active, true\)/);
  const checkerAt = source.indexOf("const [checker] = await db");
  const readyAt = source.indexOf("const reviewReadiness = await buildPayrollReleaseChecklist");
  assert.ok(checkerAt > 0 && readyAt > checkerAt, "checker grant must be validated before any approval task");
  assert.match(runner, /seedUnqualifiedCheckers/);
  assert.match(runner, /checkerDenials, 4/);
});

test("all seven addressed methods deny unauthorized legal-employer resources before sensitive operations", () => {
  for (const name of ["submit-review", "exports", "pilot-signoff", "release", "xendit-payout", "payout-reconciliation"]) {
    const source = route(name);
    assert.ok(source.includes("requireRunEmployer"), name + " must bind the run's actual legal entity");
    assert.ok(source.includes("legalEntityId: run.legalEntityId"), name + " must use persisted employer, never body selection");
    assert.ok(source.includes("assertOrganizationUnitAccess"), name + " must retain unit-grant checks");
  }
  const xendit = route("xendit-payout");
  const context = xendit.slice(xendit.indexOf("async function context("), xendit.indexOf("export async function GET("));
  assert.match(context, /await requireRunEmployer\(/);
  assert.ok(context.indexOf("await requireRunEmployer(") < context.indexOf("if (mutation) {\n    const mfaDenied"),
    "the shared xendit context must check legal employer for BOTH GET and POST");
  const recon = route("payout-reconciliation");
  const get = recon.slice(recon.indexOf("export async function GET("), recon.indexOf("export async function POST("));
  const post = recon.slice(recon.indexOf("export async function POST("));
  assert.match(get, /await requireRunEmployer\(/);
  assert.match(post, /await requireRunEmployer\(/);
  assert.ok(get.indexOf("await requireRunEmployer(") < get.indexOf("const events = await db"));
  assert.ok(post.indexOf("await requireRunEmployer(") < post.indexOf("if (!process.env.PAYMONGO_SECRET_KEY)"));
  assert.match(route("pilot-signoff"), /await requireRunEmployer\(/);
});

test("provider-disabled replies are never counted as successful money movement or certified writes", () => {
  const xendit = route("xendit-payout");
  const recon = route("payout-reconciliation");
  const exports = route("exports");
  assert.match(recon, /if \(!process\.env\.PAYMONGO_SECRET_KEY\)/);
  assert.match(recon, /PAYMONGO_DISBURSEMENTS_ENABLED !== "true"/);
  assert.match(exports, /PAYMONGO_DISBURSEMENTS_ENABLED !== "true"/);
  assert.match(xendit, /configuredPayrollPayoutProvider\(\) !== "xendit"/);
  assert.match(xendit, /if \(body\.confirm !== true\)/);
  assert.match(runner, /blockedPreconditionOnlyMutations: uncreditedDenials/);
  assert.match(runner, /providersContacted: 0, moneyMoved: false/);
});

test("release keeps exact legal-employer confirmation even in no-money negative fixtures", () => {
  const source = route("release");
  assert.match(source, /requireConfirmation: true/);
  assert.match(source, /confirmationBody\.confirmLegalEntityName/);
  assert.match(runner, /body: \(actor\) => \(\{ confirmLegalEntityName: actor\.entity\.legalName \}\)/);
  assert.match(runner, /run: "draft"/);
  assert.match(runner, /own: 409/);
});
