import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  CHECKER_VARIANCE_CATEGORIES, isVerifiedPayrollCheckerVariance,
  readVerifiedPayrollCheckerVariance,
} from "../src/lib/payroll-checker-variance-read";

const expected = {
  id: 35, legalEntityId: 100, scopeOrgUnitId: null,
  periodLabel: "Oct 1–15 2026", periodStart: "2026-10-01",
  periodEnd: "2026-10-15", payDate: "2026-10-19", status: "Pending approval",
  employeeCount: 2, grossPay: "50000.00", netPay: "40000.00", ruleVersion: "PH-2026.10",
};
const employee = {
  organizationId: 11, employeeId: 21, employeeNo: "SYN-021",
  employeeName: "Synthetic Payroll Employee", employeeStatus: "Active",
  entryStatus: "Exception", categories: ["exception"],
  currentGross: 20000, previousGross: null, currentNet: 18000, previousNet: null,
  netDelta: null, netPercent: null, changedLines: [], payRevision: null,
};
const counts = Object.fromEntries(CHECKER_VARIANCE_CATEGORIES.map(category =>
  [category, category === "exception" ? 1 : 0]));
const valid = {
  organizationId: 11, legalEntityId: 100,
  run: {
    ...expected, organizationId: 11, grossPay: 50000, netPay: 40000,
    totalChunks: 2, processedChunks: 2,
  },
  previousRun: null,
  summary: {
    changedEmployees: 1, totalEmployeesReviewed: 2,
    calculatedEntries: 2, expectedEntries: 2, coverageComplete: true,
    exceptionCount: 1, grossDelta: 50000, netDelta: 40000, categoryCounts: counts,
  },
  rows: [employee],
};
const mock = (payload: unknown, status=200): typeof fetch =>
  (async () => Response.json(payload, { status })) as typeof fetch;

test("fully verified current-tenant payroll variance may display checker evidence", () => {
  assert.equal(isVerifiedPayrollCheckerVariance(valid, 11, expected), true);
  assert.equal(isVerifiedPayrollCheckerVariance({
    ...valid,
    rows: [], summary: { ...valid.summary, changedEmployees: 0, exceptionCount: 0,
      categoryCounts: Object.fromEntries(CHECKER_VARIANCE_CATEGORIES.map(c => [c, 0])) },
  }, 11, expected), true, "A genuine empty variance is allowed with complete run coverage");
});

test("missing, foreign and suppressed payroll values cannot make an approval-ready snapshot", () => {
  const bad = [
    {}, { ...valid, rows: null }, { ...valid, organizationId: 15 },
    { ...valid, run: { ...valid.run, organizationId: 99 } },
    { ...valid, run: { ...valid.run, id: 36 } },
    { ...valid, run: { ...valid.run, legalEntityId: 88 } },
    { ...valid, run: { ...valid.run, netPay: 0 } },
    { ...valid, run: { ...valid.run, employeeCount: 0 } },
    { ...valid, run: { ...valid.run, totalChunks: 0 } },
    { ...valid, run: { ...valid.run, processedChunks: 1 } },
    { ...valid, summary: { ...valid.summary, coverageComplete: false } },
    { ...valid, summary: { ...valid.summary, calculatedEntries: 1 } },
    { ...valid, summary: { ...valid.summary, changedEmployees: 0 } },
    { ...valid, summary: { ...valid.summary, expectedEntries: 1 } },
    { ...valid, summary: { ...valid.summary, exceptionCount: 0 } },
    { ...valid, summary: { ...valid.summary, netDelta: 0 } },
    { ...valid, summary: { ...valid.summary, categoryCounts: { ...counts, exception: 0 } } },
    { ...valid, summary: { ...valid.summary, categoryCounts: {} } },
    { ...valid, rows: [{ ...employee, organizationId: 22 }] },
    { ...valid, rows: [{ ...employee, employeeId: "21" }] },
    { ...valid, rows: [{ ...employee, categories: [] }] },
    { ...valid, rows: [{ ...employee, categories: ["unreviewed"] }] },
    { ...valid, rows: [{ ...employee, currentNet: "18000" }] },
    { ...valid, rows: [{ ...employee, changedLines: null }] },
    { ...valid, rows: [{ ...employee, payRevision: {} }] },
    { ...valid, rows: [employee, employee] },
  ];
  for (const value of bad) {
    assert.equal(isVerifiedPayrollCheckerVariance(value, 11, expected), false,
      JSON.stringify(value).slice(0, 130));
  }
});

test("previous payroll comparison must match legal employer, scoped unit and money reconciliation", () => {
  const prior = {
    id: 30, legalEntityId: 100, scopeOrgUnitId: null,
    periodLabel: "Sep 16–30 2026", payDate: "2026-10-07",
    employeeCount: 2, grossPay: 45000, netPay: 36000, ruleVersion: "PH-2026.09",
  };
  const withPrior = { ...valid, previousRun: prior,
    summary: { ...valid.summary, grossDelta: 5000, netDelta: 4000 } };
  assert.equal(isVerifiedPayrollCheckerVariance(withPrior, 11, expected), true);
  assert.equal(isVerifiedPayrollCheckerVariance({
    ...withPrior, previousRun: { ...prior, legalEntityId: 200 },
  }, 11, expected), false);
  assert.equal(isVerifiedPayrollCheckerVariance({
    ...withPrior, previousRun: { ...prior, scopeOrgUnitId: 99 },
  }, 11, expected), false);
  assert.equal(isVerifiedPayrollCheckerVariance({
    ...withPrior, summary: { ...withPrior.summary, grossDelta: 0 },
  }, 11, expected), false);
});

test("HTTP non-OK, HTML masquerading as 200, and malformed JSON do not authorize actions", async () => {
  const requests: Array<{ uri: string; init?: RequestInit }> = [];
  const fetcher = (async (uri: string | URL | Request, init?: RequestInit) => {
    requests.push({ uri: String(uri), init });
    return Response.json(valid);
  }) as typeof fetch;
  const abort = new AbortController();
  assert.deepEqual(await readVerifiedPayrollCheckerVariance(11, expected, fetcher, abort.signal), valid);
  assert.equal(requests[0].uri, "/api/payroll-runs/35/variance");
  assert.equal(requests[0].init?.signal, abort.signal);
  assert.equal(requests[0].init?.cache, "no-store");
  for (const status of [403, 404, 503]) {
    await assert.rejects(
      () => readVerifiedPayrollCheckerVariance(11, expected, mock({}, status)),
      /unavailable/,
    );
  }
  await assert.rejects(
    () => readVerifiedPayrollCheckerVariance(11, expected, mock({})), /incomplete/,
  );
  const html = (async () => new Response("<html>Login</html>", { status: 200 })) as typeof fetch;
  await assert.rejects(
    () => readVerifiedPayrollCheckerVariance(11, expected, html), /unreadable/,
  );
  await assert.rejects(
    () => readVerifiedPayrollCheckerVariance(0, expected, fetcher), /valid employer/,
  );
  assert.equal(requests.length, 1, "invalid scope must not send a request");
});

test("API and UI preserve independent payroll decision, exact run task matching and fail-closed Retry", () => {
  const api = readFileSync("src/app/api/payroll-runs/[id]/variance/route.ts", "utf8");
  const checker = readFileSync("src/components/workspace/checker-variance.tsx", "utf8");
  const approvals = readFileSync("src/components/workspace/approvals.tsx", "utf8");
  assert.match(api, /assertEntityResource\(entityContext\.context, run\.legalEntityId\)/);
  assert.match(api, /candidate\.legalEntityId === run\.legalEntityId/);
  assert.match(api, /isNull\(payrollRuns\.legalEntityId\)/);
  assert.match(api, /eq\(payrollRuns\.scopeOrgUnitId, run\.scopeOrgUnitId\)/);
  assert.ok(api.indexOf("run.legalEntityId == null") < api.indexOf(".limit(24)"),
    "Legal employer and unit must be filtered before taking the 24 prior-run candidates");
  assert.match(api, /organizationId: run\.organizationId/);
  assert.match(api, /Cache-Control": "private, no-store"/);
  assert.match(checker, /CheckerVarianceContent key=\{\[props\.organizationId/);
  assert.match(checker, /observation\?\.scopeKey === scopeKey/);
  assert.match(checker, /readVerifiedPayrollCheckerVariance\(organizationId, run, fetch, controller\.signal\)/);
  assert.match(checker, /controller\.abort\(\)/);
  assert.match(checker, /Retry payroll variance/);
  assert.match(checker, /disabled=\{busy \|\| !payload\.summary\.coverageComplete\}/);
  assert.doesNotMatch(checker, /setPayload\(body\)/);
  assert.match(approvals, /organizationId=\{data\.selectedOrganization\.id\}/);
  assert.match(approvals, /task\.payrollRunId === currentRun\.id/);
  assert.match(approvals, /new RegExp\("Payroll run #" \+ currentRun\.id \+ "\(\?!\[0-9\]\)"\)/);
  assert.equal(new RegExp("Payroll run #" + 9 + "(?![0-9])").test("Payroll run #99 review"), false);
  assert.equal(new RegExp("Payroll run #" + 9 + "(?![0-9])").test("Payroll run #9 review"), true);
});
