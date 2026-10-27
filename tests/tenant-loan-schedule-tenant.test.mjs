import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  requireDisposableLoanPreview, requirePrivateNoStore,
  previewInputs, proveCompany, proveAgency, proveFloor,
} from "../scripts/qa/tenant-loan-schedule-tenant-proof.mjs";

const safe = Object.freeze({
  CI: "true", TENANT_SECOND_PASS_MODE: "isolated-ci-only",
  NODE_ENV: "production", DEMO_MODE: "false",
  SECURITY_SMOKE_URL: "http://127.0.0.1:3000",
  DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
  LOAN_SCHEDULE_PREVIEW_ENABLED: "true",
  PAYROLL_LOAN_DEDUCTION_ACTIVATION_ENABLED: "false",
  EXACT_PAYROLL_LOAN_SETTLEMENT_ENABLED: "false",
  PAYMONGO_DISBURSEMENTS_ENABLED: "false",
  XENDIT_PAYOUTS_ENABLED: "false",
  PAYMONGO_SECRET_KEY: "", XENDIT_SECRET_KEY: "", RESEND_API_KEY: "",
});
const marker = "TTBL-ATTA-012345abcd";
const companyResult = rank => {
  const principal = rank * 100000 + 1;
  return { mode: "preview_only",
    interestBasis: "explicit flat simple interest; NOT automatic payroll deduction",
    schedule: {
      totalPrincipalCents: principal, totalInterestCents: 0,
      totalPayableCents: principal,
      installments: [
        { principalCents: 0, dueCents: 0 },
        { principalCents: 0, dueCents: 0 },
        { principalCents: 0, dueCents: 0 },
        { principalCents: principal, dueCents: principal,
          remainingPrincipalCents: 0, remainingPayableCents: 0 },
      ],
    },
  };
};
const agencyResult = (rank, ownMarker) => ({
  mode: "preview_only",
  imported: {
    agency: "SSS", loanReference: ownMarker + "-LOAN",
    scheduledTotalCents: (100 + rank) * 100 + 25,
    rows: [{ dueDate: "2099-01-15",
      amount: String(100 + rank) + ".25",
      sourceRowId: ownMarker + "-ROW1", cents: (100 + rank) * 100 + 25 }],
  },
});
const floorResult = rank => {
  const disposable = 12000 + 2000 * rank;
  const deducted = Math.min(10000, 4000 + 2000 * rank);
  return { mode: "preview_only", deductedCents: deducted, deferredCents: 10000 - deducted,
    netAfterCents: disposable - deducted, overrideUsed: false };
};

test("disposable proof rejects hosted targets, unsafe PG and any money activation", () => {
  assert.equal(requireDisposableLoanPreview(safe), true);
  for (const [field, value] of [
    ["CI", "false"], ["TENANT_SECOND_PASS_MODE", "local"], ["NODE_ENV", "development"],
    ["DEMO_MODE", "true"], ["LOAN_SCHEDULE_PREVIEW_ENABLED", "false"],
    ["PAYROLL_LOAN_DEDUCTION_ACTIVATION_ENABLED", "true"],
    ["EXACT_PAYROLL_LOAN_SETTLEMENT_ENABLED", "true"],
    ["SECURITY_SMOKE_URL", "https://payroll.example.test"],
    ["SECURITY_SMOKE_URL", "http://localhost:3000"],
    ["SECURITY_SMOKE_URL", "http://127.0.0.1.evil:3000"],
    ["DATABASE_URL", "postgresql://postgres:postgres@localhost:5432/app_db"],
    ["DATABASE_URL", "postgresql://postgres:postgres@127.0.0.1:5433/app_db"],
    ["DATABASE_URL", "postgresql://postgres:postgres@127.0.0.1:5432/customer"],
    ["DATABASE_URL", "postgresql://other:secret@127.0.0.1:5432/app_db"],
    ["PAYMONGO_DISBURSEMENTS_ENABLED", "true"],
    ["XENDIT_PAYOUTS_ENABLED", "true"],
    ["PAYMONGO_SECRET_KEY", "external"], ["XENDIT_SECRET_KEY", "external"],
    ["RESEND_API_KEY", "external"],
  ]) {
    assert.throws(() => requireDisposableLoanPreview({ ...safe, [field]: value }),
      /LOAN_PREVIEW_PROOF_REFUSED/, field);
  }
  assert.throws(() => requireDisposableLoanPreview({ ...safe, DATABASE_URL: undefined }),
    /LOAN_PREVIEW_PROOF_REFUSED/);
});

test("all three read-only preview inputs carry distinct employer evidence", () => {
  const a = previewInputs(1, marker);
  const b = previewInputs(2, "TTBL-ATTB-012345abcd");
  const v = previewInputs(4, "TTBL-VICTIM-012345abcd");
  for (const kind of ["company", "agency", "floor"]) {
    assert.notDeepEqual(a[kind], b[kind], kind);
    assert.notDeepEqual(b[kind], v[kind], kind);
  }
  assert.equal(a.company.principal, "1000.01");
  assert.equal(a.agency.rows[0].sourceRowId, marker + "-ROW1");
  assert.equal(v.floor.disposablePayCents, 20000);
  assert.throws(() => previewInputs(1, "MADE-UP-EMPLOYER"));
});

test("company schedule proof rejects a real response assigned to another employer", () => {
  assert.equal(proveCompany(companyResult(1), 1), true);
  assert.throws(() => proveCompany(companyResult(1), 2));
  for (const mutate of [
    x => { x.mode = "applied"; },
    x => { x.schedule.totalPrincipalCents++; },
    x => { x.schedule.totalPayableCents--; },
    x => { x.schedule.totalInterestCents = 100; },
    x => { x.schedule.installments[3].remainingPrincipalCents = 1; },
    x => { x.schedule.installments[3].dueCents = 0; },
    x => { x.schedule.installments = []; },
    x => { x.paymentPosted = true; },
  ]) {
    const result = structuredClone(companyResult(1)); mutate(result);
    assert.throws(() => proveCompany(result, 1));
  }
});

test("agency imported schedule must match own marker, row identity and exact cents", () => {
  assert.equal(proveAgency(agencyResult(1, marker), 1, marker), true);
  assert.throws(() => proveAgency(agencyResult(1, marker), 2, "TTBL-ATTB-012345abcd"));
  for (const mutate of [
    x => { x.imported.loanReference = "foreign-reference"; },
    x => { x.imported.rows[0].sourceRowId = "foreign-row"; },
    x => { x.imported.rows[0].amount = "101.26"; },
    x => { x.imported.rows[0].cents = 10126; },
    x => { x.imported.scheduledTotalCents = 9999; },
    x => { x.imported.rows = []; },
  ]) {
    const result = structuredClone(agencyResult(1, marker)); mutate(result);
    assert.throws(() => proveAgency(result, 1, marker));
  }
});

test("floor preview never authorizes a deduction override or leaks another employer's result", () => {
  assert.equal(proveFloor(floorResult(1), 1), true);
  assert.throws(() => proveFloor(floorResult(1), 2));
  for (const mutate of [
    x => { x.mode = "applied"; },
    x => { x.deductedCents++; },
    x => { x.deferredCents--; },
    x => { x.netAfterCents--; },
    x => { x.overrideUsed = true; },
    x => { x.approved = true; },
  ]) {
    const result = structuredClone(floorResult(1)); mutate(result);
    assert.throws(() => proveFloor(result, 1));
  }
});

test("actual authenticated loan previews must be non-cacheable", () => {
  for (const value of ["private, no-store", "no-store, max-age=0", "NO-STORE, MAX-AGE=0"]) {
    assert.equal(requirePrivateNoStore(new Headers({ "cache-control": value })), true);
  }
  for (const value of [undefined, "private", "no-cache", "public, no-store",
    "no-store, max-age=120", "no-store, s-maxage=0", "no-store, immutable"]) {
    assert.throws(() => requirePrivateNoStore(
      new Headers(value === undefined ? undefined : { "cache-control": value })),
    /LOAN_PREVIEW_CACHE_UNSAFE/, String(value));
  }
});

test("Loan family owns exactly two targeted GAPs with real focused PG16 HTTP workflow", () => {
  const manifest = JSON.parse(readFileSync("scripts/qa/tenant-isolation-coverage-manifest.json", "utf8"));
  const values = Object.values(manifest.allApiRouteFiles).flatMap(x =>
    x.methods.map(m => ({ key: m.name + " " + x.route, status: m.status })));
  for (const method of ["PATCH loans", "POST loans/schedule-preview"]) {
    assert.equal(values.find(x => x.key === method)?.status, "GAP", method);
  }
  const writeRow = readFileSync("scripts/qa/tenant-table-rows/write/loans.mjs", "utf8");
  assert.match(writeRow, /key: "PATCH loans"/);
  assert.match(writeRow, /action: "pause"/);
  assert.match(writeRow, /c\.victimSeeded\.id/);
  assert.match(writeRow, /assert\.deepEqual\(after\.loans\.filter/);
  const handler = readFileSync("src/app/api/loans/schedule-preview/route.ts", "utf8");
  assert.match(handler, /criticalReleaseFlagEnabled\("loanSchedulePreview"\)/);
  assert.match(handler, /assertOrganizationRole\(user\.id, organizationId, PAYROLL_OPERATOR_ROLES/);
  assert.match(handler, /mode: "preview_only"/);
  const wf = readFileSync(".github/workflows/tenant-loan-gap-recovery.yml", "utf8");
  const runner = readFileSync("scripts/qa/tenant-loan-schedule-tenant-http.mjs", "utf8");
  assert.match(wf, /image: postgres:16/);
  assert.match(wf, /npm run db:push/);
  assert.match(wf, /apply-isolated-baseline\.mjs/);
  assert.match(wf, /npm run build/);
  assert.match(wf, /TENANT_TABLE_FAMILY=loans npx tsx scripts\/qa\/tenant-write-table-http\.mjs/);
  assert.match(wf, /node --import tsx scripts\/qa\/tenant-loan-schedule-tenant-http\.mjs/);
  assert.match(runner, /requireDisposableLoanPreview\(\)/);
  assert.match(runner, /seedEmployer\("VICTIM"/);
  assert.match(runner, /assert\.deepEqual\(after, baseline,/);
  assert.match(runner, /foreign real employer company preview/);
  assert.match(runner, /deductionsEnabled: false/);
  assert.match(runner, /credited: 0/);
});
