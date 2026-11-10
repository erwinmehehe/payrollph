import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { requireDisposableScheduleReceipt } from "../scripts/qa/tenant-self-schedule-receipts-contract.mjs";

const page = readFileSync("src/app/self/schedule-receipts/page.tsx", "utf8");
const proof = readFileSync("scripts/qa/tenant-self-schedule-page-http.mjs", "utf8");
const workflow = readFileSync(".github/workflows/tenant-self-schedule-page-http.yml", "utf8");

test("PII-02 page keeps employee identity, role, membership and feature guards ahead of client mount", () => {
  const steps = [
    'process.env.WFM_SCHEDULE_RECEIPTS_ENABLED !== "true"',
    "await getSessionUser()",
    'session.role !== "employee"',
    'validReceiptId(session.employeeId)',
    "const params = await searchParams",
    "key => Object.prototype.hasOwnProperty.call(params, key)",
    "eq(employees.id, session.employeeId)",
    'employee.status !== "Active"',
    "await getAccess(session.id, employee.organizationId)",
    'access.role !== "employee"',
    "await assertMembership(session.id, employee.organizationId)",
    "receiptPilotAllowed(employee.organizationId,",
    "<EmployeeScheduleReceipts",
  ];
  let cursor = -1;
  for (const marker of steps) {
    const at = page.indexOf(marker);
    assert.ok(at > cursor, "Missing or incorrectly ordered boundary: " + marker);
    cursor = at;
  }
  assert.match(page, /data-organization-id=\{employee\.organizationId\}/);
  for (const key of ["organizationId", "employeeId", "userId", "orgUnitId", "workDate"]) {
    assert.ok(page.includes('"' + key + '"'), "Refuse query-supplied " + key);
  }
  assert.doesNotMatch(page, /Number\(.*organizationId/);
  assert.ok(!page.includes("primaryOrganizationId("), "No silent employer fallback");
});

test("new page proof rejects fake evidence and keeps existing receipt API ledger unchanged", () => {
  const manifest = JSON.parse(readFileSync("scripts/qa/tenant-isolation-coverage-manifest.json", "utf8"));
  const entry = manifest.scopedPages.find(row => row.path === "src/app/self/schedule-receipts/page.tsx");
  assert.equal(entry.status, "GAP", "No new page coverage credit is accepted");
  assert.equal(entry.testedBy, undefined);
  assert.equal(entry.reviewedUncertified?.pageActionCredits, 0);
  assert.equal(entry.reviewedUncertified?.apiMethodCredits, 0);
  assert.equal(entry.reviewedUncertified?.productionCertified, false);
  const api = manifest.allApiRouteFiles["src/app/api/self/schedule-receipts/route.ts"];
  for (const method of api.methods) {
    assert.equal(method.status, "COVERED", "Preserve already-source-pinned API proof");
    assert.equal(method.testedBy?.prNumber, 1520);
  }
  const guard = proof.indexOf("requireDisposableScheduleReceipt();");
  const db = proof.indexOf('import("../../src/db/index.ts")');
  assert.ok(guard >= 0 && db > guard, "Refuse non-disposable env before DB imports");
  for (const marker of [
    'seed("ATTA", nonce)', 'seed("ATTB", nonce)', 'seed("VICTIM", nonce)',
    "assertOwnPage(", "assertDeniedPage(", "snapshot(e.org.id)",
    "await snapshot(subjects[i].org.id)",
    '"owner"', 'status: "Inactive"', "active: false",
    '"/self/schedule-receipts"', 'pageActionCredits: 0, apiMethodCredits: 0',
  ]) assert.ok(proof.includes(marker), "Missing genuine feature-ON page proof: " + marker);
  assert.ok(!proof.includes("method: \"POST\""), "New page proof must never send a write");
  assert.ok(!proof.includes("db.insert(s.payrollRuns)"), "No money/payroll fixture writes");
  for (const marker of [
    "image: postgres:16", "node --import tsx scripts/qa/tenant-self-schedule-page-http.mjs",
    "tests/tenant-self-schedule-page-contract.test.mjs", "npm run build",
    "apply-isolated-baseline.mjs", "persist-credentials: false",
    "src/app/self/schedule-receipts/page.tsx",
  ]) assert.ok(workflow.includes(marker), "Focused CI must retain " + marker);
});

test("disposable schedule-page probe cannot target providers or production", () => {
  const safe = {
    GITHUB_ACTIONS: "true", CI: "true", NODE_ENV: "production", DEMO_MODE: "false",
    TENANT_SECOND_PASS_MODE: "isolated-ci-only", TENANT_RECEIPT_MODE: "fictional-only",
    DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
    SECURITY_SMOKE_URL: "http://127.0.0.1:3000",
    WFM_SCHEDULE_RECEIPTS_ENABLED: "true",
    WFM_SCHEDULE_RECEIPTS_ALLOWED_ORGANIZATION_IDS: "1,2,3",
    WORKER_ENABLED: "false", CENTRAL_SCHEDULER_ENABLED: "false",
    PAYMONGO_DISBURSEMENTS_ENABLED: "false", XENDIT_PAYOUTS_ENABLED: "false",
    XENDIT_BILLING_ENABLED: "false", HCM_OVERPAYMENT_PREVIEW_ENABLED: "false",
    PAYROLL_OVERPAYMENT_REVIEW_ENABLED: "false", WORKER_TOKEN: "ci-worker-token-page",
  };
  assert.doesNotThrow(() => requireDisposableScheduleReceipt(safe));
  for (const change of [
    { GITHUB_ACTIONS: "" }, { CI: "false" }, { DEMO_MODE: "true" },
    { DATABASE_URL: "postgresql://prod-db.example.invalid/app_db" },
    { SECURITY_SMOKE_URL: "https://production.example.invalid" },
    { WFM_SCHEDULE_RECEIPTS_ENABLED: "false" },
    { WFM_SCHEDULE_RECEIPTS_ALLOWED_ORGANIZATION_IDS: "1,2,4" },
    { WORKER_ENABLED: "true" }, { PAYMONGO_DISBURSEMENTS_ENABLED: "true" },
    { XENDIT_PAYOUTS_ENABLED: "true" }, { RESEND_API_KEY: "non-disposable" },
  ]) assert.throws(() => requireDisposableScheduleReceipt({ ...safe, ...change }),
    /SCHEDULE_RECEIPT_TENANT_REFUSED/);
});
