import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  evaluatePayrollPreRunReadiness, type PreRunReadinessInput,
} from "../src/lib/payroll-pre-run-readiness";
import { buildStatutoryRuleWatch, type RuleWatchItem } from "../src/lib/statutory-rule-watch";

function fixture(overrides: Partial<PreRunReadinessInput> = {}): PreRunReadinessInput {
  return {
    run: {
      id: 101, organizationId: 12, legalEntityId: 8,
      periodStart: "2026-10-01", periodEnd: "2026-10-15", payDate: "2026-10-20",
    },
    employer: { id: 8, payrollCalendarMode: "ph_semi_monthly", active: true },
    employees: [{ id: 21, employeeNo: "FIC-21", legalEntityId: 8 }],
    profiles: [{ employeeId: 21 }],
    timesheets: [{
      employeeId: 21, periodStart: "2026-10-01", periodEnd: "2026-10-15",
      version: 2, status: "approved", decidedAt: "2026-10-19T12:00:00.000Z",
    }],
    punchEmployees: [{ employeeId: 21 }],
    attendanceCorrections: [],
    restDayRevisions: [],
    scheduleAssignments: [],
    scheduleOverrides: [],
    scheduleSwaps: [],
    periodConflict: null,
    ruleWatch: [
      item("sss", "current"),
      item("philhealth", "current"),
      item("pagibig", "current"),
      item("bir-withholding", "current"),
      item("wage-orders", "current"),
    ],
    ...overrides,
  };
}
const codes = (input: PreRunReadinessInput) =>
  evaluatePayrollPreRunReadiness(input).findings.map(f => f.code);
const has = (input: PreRunReadinessInput, code: string) => codes(input).includes(code);
const item = (family: RuleWatchItem["family"], status: RuleWatchItem["status"]): RuleWatchItem => ({
  family, status, label: family, currentVersion: "Fictional pack",
  sourceDocument: "Synthetic agency circular",
  lastVerifiedOn: status === "verification-unrecorded" || status === "no-coverage"
    ? null : status === "review-due" ? "2026-01-01" : "2026-10-19",
  detail: "Fictional rule status requiring manual review.",
});

test("clean fictional cutoff is ready and uses the release AssuranceFinding wire shape", () => {
  const result = evaluatePayrollPreRunReadiness(fixture());
  assert.deepEqual(result.findings, []);
  assert.equal(result.ready, true);
  assert.deepEqual(result.summary, { high: 0, medium: 0, info: 0, blocking: 0 });
  const finding = evaluatePayrollPreRunReadiness(fixture({ profiles: [] })).findings[0];
  assert.deepEqual(Object.keys(finding).sort(), ["blocking", "code", "detail", "employeeId", "severity", "title"]);
  assert.equal(finding.severity, "high");
  assert.equal(finding.blocking, true);
});

test("all four synthetic unrecorded statutory families block before calculation", () => {
  // Must remain valid after a reviewer eventually certifies the real packs.
  // Never treat a future legitimate rule verification as a regression.
  const watch = [
    item("sss", "verification-unrecorded"),
    item("philhealth", "verification-unrecorded"),
    item("pagibig", "verification-unrecorded"),
    item("bir-withholding", "verification-unrecorded"),
    item("wage-orders", "current"),
  ];
  const result = evaluatePayrollPreRunReadiness(fixture({ ruleWatch: watch }));
  const unverified = result.findings.filter(f => f.code === "PRERUN_STATUTORY_VERIFICATION_UNRECORDED");
  assert.equal(unverified.length, 4);
  assert.ok(unverified.every(f => f.blocking && f.severity === "high"));
  assert.equal(result.ready, false);
  assert.equal(result.summary.blocking, 4);
});

test("actual statutory watch is evaluated, never silently ignored", () => {
  const watch = buildStatutoryRuleWatch("2026-10-23");
  assert.equal(new Set(watch.map(row => row.family)).size, 5,
    "All five watch families must remain represented, including optional forthcoming changes");
  const found = evaluatePayrollPreRunReadiness(fixture({ ruleWatch: watch }));
  const mapping: Record<string, string> = {
    "verification-unrecorded": "PRERUN_STATUTORY_VERIFICATION_UNRECORDED",
    "review-due": "PRERUN_STATUTORY_REVIEW_DUE",
    "update-overdue": "PRERUN_STATUTORY_UPDATE_OVERDUE",
    "no-coverage": "PRERUN_STATUTORY_NO_COVERAGE",
  };
  const expected = watch.map(row => mapping[row.status]).filter(Boolean).sort();
  const actual = found.findings.filter(row => row.code.startsWith("PRERUN_STATUTORY_")).map(row => row.code).sort();
  assert.deepEqual(actual, expected);
  assert.equal(found.ready, expected.length === 0);
});

test("review-due, overdue update and uncovered rule pack have distinct blocking finding codes", () => {
  // An update-overdue item is a supplemental pending-change advisory, not
  // the agency pack's baseline. Keep the real baseline in this synthetic fixture
  // so this test isolates each intended status without masking a missing pack.
  const rules = [item("sss", "review-due"), item("philhealth", "current"),
    item("philhealth", "update-overdue"), item("pagibig", "no-coverage"),
    item("bir-withholding", "current"), item("wage-orders", "current")];
  const result = evaluatePayrollPreRunReadiness(fixture({ ruleWatch: rules }));
  assert.deepEqual(result.findings.map(f => f.code), [
    "PRERUN_STATUTORY_REVIEW_DUE",
    "PRERUN_STATUTORY_UPDATE_OVERDUE",
    "PRERUN_STATUTORY_NO_COVERAGE",
  ]);
  assert.ok(result.findings.every(f => f.blocking));
  assert.ok(!result.findings.some(f => f.code === "PRERUN_STATUTORY_WATCH_INCOMPLETE"),
    "An overdue advisory accompanied by its current baseline must not look like missing rule evidence");
  assert.ok(!has(fixture({ employees: [], ruleWatch: rules }), "PRERUN_STATUTORY_REVIEW_DUE"),
    "rule status for an empty cohort is not incorrectly attributed to workers");
});

test("missing or duplicate statutory rule-watch records fail closed for populated runs", () => {
  const fullWatch = fixture().ruleWatch;
  const missing = fixture({ ruleWatch: fullWatch.filter(item => item.family !== "sss") });
  const duplicate = fixture({ ruleWatch: [...fullWatch, item("pagibig", "current")] });
  assert.equal(evaluatePayrollPreRunReadiness(missing).ready, false);
  assert.ok(has(missing, "PRERUN_STATUTORY_WATCH_INCOMPLETE"));
  assert.ok(has(duplicate, "PRERUN_STATUTORY_WATCH_INCOMPLETE"));
  assert.equal(evaluatePayrollPreRunReadiness(duplicate).summary.blocking, 1);
  const advisory = fixture({ ruleWatch: [...fullWatch, item("wage-orders", "change-upcoming")] });
  assert.equal(evaluatePayrollPreRunReadiness(advisory).ready, true,
    "A legitimate extra forthcoming wage advisory is not a duplicate baseline");
  const overdue = fixture({ ruleWatch: [...fullWatch, item("sss", "update-overdue")] });
  assert.ok(!has(overdue, "PRERUN_STATUTORY_WATCH_INCOMPLETE"),
    "An overdue source alert must not be mistaken for a duplicate baseline");
  assert.ok(has(overdue, "PRERUN_STATUTORY_UPDATE_OVERDUE"),
    "Overdue source alerts must continue to block calculation");
  assert.ok(!has(fixture({ employees: [], ruleWatch: [] }), "PRERUN_STATUTORY_WATCH_INCOMPLETE"));
});

test("nonblocking rule-watch labels never excuse missing source verification dates", () => {
  for (const status of ["current", "coverage-ending"] as const) {
    const ruleWatch = fixture().ruleWatch.map(row => row.family === "philhealth"
      ? { ...row, status, lastVerifiedOn: null } : row);
    assert.ok(has(fixture({ ruleWatch }), "PRERUN_STATUTORY_VERIFICATION_UNRECORDED"),
      status + " must not bypass missing official-source review evidence");
  }
  const malformed = fixture().ruleWatch.map(row => row.family === "sss"
    ? { ...row, lastVerifiedOn: "not-a-date" } : row);
  assert.ok(has(fixture({ ruleWatch: malformed }), "PRERUN_STATUTORY_VERIFICATION_UNRECORDED"));
});

test("missing or invalid approval and revision timestamps fail closed", () => {
  const original = fixture().timesheets[0];
  for (const decidedAt of [null, "not-a-date"]) {
    assert.ok(has(fixture({ timesheets: [{ ...original, decidedAt }] }),
      "PRERUN_ATTENDANCE_UNREVIEWED"));
  }
  assert.ok(has(fixture({ restDayRevisions: [{
    employeeId: 21, effectiveDate: "2026-10-08", createdAt: "not-a-date",
  }] }), "PRERUN_REST_DAY_REVISION_UNRESOLVED"));
  assert.ok(has(fixture({ scheduleAssignments: [{
    employeeId: 21, effectiveFrom: "2026-10-08", createdAt: "not-a-date",
  }] }), "PRERUN_SCHEDULE_REVISION_UNRESOLVED"));
});

test("missing pay profile and missing legal-entity attribution are per-employee findings", () => {
  const input = fixture({
    employees: [
      { id: 21, employeeNo: "FIC-21", legalEntityId: 8 },
      { id: 22, employeeNo: "FIC-22", legalEntityId: null },
    ],
    profiles: [{ employeeId: 21 }],
    timesheets: [
      ...fixture().timesheets,
      { employeeId: 22, periodStart: "2026-10-01", periodEnd: "2026-10-15",
        version: 1, status: "approved", decidedAt: new Date("2026-10-20T01:00:00Z") },
    ],
  });
  const findings = evaluatePayrollPreRunReadiness(input).findings;
  assert.deepEqual(findings.filter(f => f.employeeId === 22).map(f => f.code),
    ["PRERUN_LEGAL_ENTITY_UNASSIGNED", "PRERUN_PAY_PROFILE_MISSING"]);
  assert.ok(!findings.some(f => f.employeeId === 21));
});

test("missing, unreconciled and stale attendance are distinguished by exact period and latest version", () => {
  assert.ok(has(fixture({ timesheets: [], punchEmployees: [] }), "PRERUN_ATTENDANCE_MISSING"));
  assert.ok(has(fixture({ timesheets: [], punchEmployees: [{ employeeId: 21 }] }), "PRERUN_ATTENDANCE_UNREVIEWED"));
  assert.ok(has(fixture({ timesheets: [{
    ...fixture().timesheets[0], periodStart: "2026-09-16",
  }] }), "PRERUN_ATTENDANCE_UNREVIEWED"));
  assert.ok(has(fixture({ timesheets: [
    fixture().timesheets[0], { ...fixture().timesheets[0], version: 3, status: "stale" },
  ] }), "PRERUN_ATTENDANCE_STALE"));
  assert.ok(has(fixture({ attendanceCorrections: [
    { employeeId: 21, workDate: "2026-10-08", status: "pending" },
  ] }), "PRERUN_ATTENDANCE_STALE"));
  assert.ok(!has(fixture({ attendanceCorrections: [
    { employeeId: 21, workDate: "2026-09-30", status: "pending" },
    { employeeId: 21, workDate: "2026-10-08", status: "approved" },
  ] }), "PRERUN_ATTENDANCE_STALE"));
});

test("mid-period rest-day change is blocked until a later timesheet approval", () => {
  const revision = { employeeId: 21, effectiveDate: "2026-10-08",
    createdAt: new Date("2026-10-19T13:00:00Z") };
  assert.ok(has(fixture({ restDayRevisions: [revision] }), "PRERUN_REST_DAY_REVISION_UNRESOLVED"));
  assert.ok(!has(fixture({ restDayRevisions: [{ ...revision,
    createdAt: new Date("2026-10-18T00:00:00Z") }] }), "PRERUN_REST_DAY_REVISION_UNRESOLVED"));
  assert.ok(!has(fixture({ restDayRevisions: [
    { ...revision, effectiveDate: "2026-10-16" },
  ] }), "PRERUN_REST_DAY_REVISION_UNRESOLVED"));
});

test("mid-period schedule reassignment, pending override and either swap party require resolution", () => {
  const schedule = { employeeId: 21, effectiveFrom: "2026-10-10",
    createdAt: new Date("2026-10-20T00:00:00Z") };
  const swap = { requesterEmployeeId: 99, counterpartyEmployeeId: 21,
    requesterWorkDate: "2026-09-30", counterpartyWorkDate: "2026-10-13", status: "pending" };
  assert.ok(has(fixture({ scheduleAssignments: [schedule] }), "PRERUN_SCHEDULE_REVISION_UNRESOLVED"));
  assert.ok(has(fixture({ scheduleOverrides: [{
    employeeId: 21, workDate: "2026-10-07", status: "pending",
  }] }), "PRERUN_SCHEDULE_REVISION_UNRESOLVED"));
  assert.ok(has(fixture({ scheduleSwaps: [swap] }), "PRERUN_SCHEDULE_REVISION_UNRESOLVED"));
  assert.ok(!has(fixture({ scheduleSwaps: [{ ...swap, status: "Approved" }] }),
    "PRERUN_SCHEDULE_REVISION_UNRESOLVED"));
  assert.ok(!has(fixture({ scheduleAssignments: [{
    ...schedule, createdAt: new Date("2026-10-17T00:00:00Z"),
  }] }), "PRERUN_SCHEDULE_REVISION_UNRESOLVED"));
  assert.ok(!has(fixture({ scheduleOverrides: [{
    employeeId: 9999, workDate: "2026-10-07", status: "pending",
  }] }), "PRERUN_SCHEDULE_REVISION_UNRESOLVED"));
});

test("invalid period, invalid pay date, pay date preceding end, overlap and canonical rules are separate", () => {
  assert.ok(has(fixture({ run: { ...fixture().run,
    periodStart: "2026-10-31", periodEnd: "2026-10-01",
  } }), "PRERUN_INVALID_PERIOD"));
  assert.ok(has(fixture({ run: { ...fixture().run,
    periodStart: "2026-02-30",
  } }), "PRERUN_INVALID_PERIOD"));
  assert.ok(has(fixture({ run: { ...fixture().run,
    payDate: "2026-13-01",
  } }), "PRERUN_INVALID_PAY_DATE"));
  assert.ok(has(fixture({ run: { ...fixture().run,
    payDate: "2026-10-14",
  } }), "PRERUN_PAY_DATE_BEFORE_END"));
  assert.ok(has(fixture({ periodConflict: {
    id: 8, periodLabel: "Fictional other run", status: "Processing",
  } }), "PRERUN_PERIOD_OVERLAP"));
  assert.ok(has(fixture({ run: {
    ...fixture().run, periodStart: "2026-10-05",
  } }), "PRERUN_NONCANONICAL_PERIOD"));
  assert.ok(!has(fixture({
    employer: { id: 8, active: true, payrollCalendarMode: "flexible" },
    run: { ...fixture().run, periodStart: "2026-10-05" },
  }), "PRERUN_NONCANONICAL_PERIOD"));
  assert.ok(has(fixture({ employer: null }), "PRERUN_EMPLOYER_UNRESOLVED"));
  assert.ok(has(fixture({ employees: [] }), "PRERUN_NO_EMPLOYEES"));
});

test("preflight cannot duplicate post-calculation assurance codes or modify release gate", () => {
  const preflight = readFileSync("src/lib/payroll-pre-run-readiness.ts", "utf8");
  const process = readFileSync("src/app/api/payroll-runs/[id]/process/route.ts", "utf8");
  const release = readFileSync("src/app/api/payroll-runs/[id]/release/route.ts", "utf8");
  const get = readFileSync("src/app/api/payroll-runs/[id]/pre-run-readiness/route.ts", "utf8");
  const ui = readFileSync("src/components/workspace/payroll-run.tsx", "utf8");
  assert.ok(!/code:\s*"(WAGE_FLOOR|NONPOSITIVE_NET|MISSING_BANK_DETAILS|UNUSUAL_OVERTIME|DUPLICATE_EARNING|MISSING_STATUTORY)"/.test(preflight));
  assert.ok(process.indexOf("loadPayrollPreRunReadiness(run)") < process.indexOf("db.transaction("));
  assert.ok(process.includes("PAYROLL_PRE_RUN_READINESS_BLOCKED"));
  assert.ok(release.includes("buildPayrollAssurance(runId)"));
  assert.ok(release.includes("assuranceResult?.assurance.findings.filter("));
  assert.ok(get.includes("PAYROLL_OPERATOR_ROLES"));
  assert.ok(get.includes("assertOrganizationUnitAccess"));
  assert.ok(get.includes("requireRunEmployer"));
  assert.ok(ui.includes("/pre-run-readiness"));
  assert.ok(ui.includes("checkPreRunAndMaybeCalculate(run.id, true)"));
});
