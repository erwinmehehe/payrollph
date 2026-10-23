import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  parseHcmGovernanceReadinessResponse,
  type HcmGovernanceReport,
} from "../src/lib/hcm-governance-verified-read";

const PROCESS_TYPES = [
  "hire", "change_job", "promotion", "transfer",
  "compensation_change", "termination", "create_position", "close_position",
];

function validReport(): HcmGovernanceReport {
  return {
    organizationId: 23,
    asOf: "2026-10-20",
    status: "inventory_only",
    summary: {
      employeeCount: 6, currentWorkers: 5, highPriorityCategories: 0,
      reviewCategories: 0, inProgressBusinessProcesses: 0,
      pendingHcmSteps: 0, overdueHcmSteps: 0,
    },
    findings: [],
    processes: PROCESS_TYPES.map(processType => ({
      processType, configuredDefinitions: 0, currentActiveDefinitions: 0,
      scopedDefinitions: 0, policyState: "system_default_or_not_configured",
    })),
    limitations: ["Aggregate inventory only; not payroll certification."],
  };
}

function mutate(update: (report: HcmGovernanceReport) => void) {
  const report = validReport();
  update(report);
  return report;
}

test("complete current-employer empty inventory is allowed but not a compliance certificate", () => {
  const verified = parseHcmGovernanceReadinessResponse(200, validReport(), 23);
  assert.equal(verified.status, "inventory_only");
  assert.equal(verified.findings.length, 0);
  assert.equal(verified.summary.employeeCount, 6);
  assert.equal(verified.processes.length, 8);
});

test("accepts verified high-priority and review findings with matching counts", () => {
  const candidate = mutate(report => {
    report.status = "manual_review_required";
    report.summary.highPriorityCategories = 1;
    report.summary.reviewCategories = 1;
    report.findings = [
      { code: "UNKNOWN_WAGE_REGION", severity: "high", affected: 2, title: "Wage region", nextAction: "Review the record" },
      { code: "REST_DAY_NOT_CONFIGURED", severity: "review", affected: 1, title: "Rest day", nextAction: "Review the schedule" },
    ];
  });
  const verified = parseHcmGovernanceReadinessResponse(200, candidate, 23);
  assert.equal(verified.findings.length, 2);
  assert.equal(verified.summary.highPriorityCategories, 1);
});

test("missing, foreign and invalid HTTP 200 cannot render a false clean inventory", () => {
  const valid = validReport();
  for (const value of [null, {}, [], { ...valid, organizationId: 24 },
    { ...valid, organizationId: undefined }, { ...valid, summary: {} },
    { ...valid, findings: undefined }, { ...valid, processes: undefined },
    { ...valid, limitations: [] }]) {
    assert.throws(() => parseHcmGovernanceReadinessResponse(200, value, 23), /response|employer/);
  }
  assert.throws(() => parseHcmGovernanceReadinessResponse(200, valid, 0), /incomplete/);
});

test("rejects missing, negative, nonnumeric or contradictory source counts", () => {
  for (const bad of [-1, "0", null, 1.5, NaN, Number.POSITIVE_INFINITY]) {
    const candidate = mutate(report => { report.summary.pendingHcmSteps = bad as number; });
    assert.throws(() => parseHcmGovernanceReadinessResponse(200, candidate, 23), /incomplete/);
  }
  const tooManyCurrent = mutate(report => { report.summary.currentWorkers = 7; });
  assert.throws(() => parseHcmGovernanceReadinessResponse(200, tooManyCurrent, 23), /inconsistent/);
  const overdueWithoutPending = mutate(report => { report.summary.overdueHcmSteps = 1; });
  assert.throws(() => parseHcmGovernanceReadinessResponse(200, overdueWithoutPending, 23), /inconsistent/);
});

test("rejects incomplete findings and unexpected green readiness claims", () => {
  const wrongCount = mutate(report => { report.summary.highPriorityCategories = 1; });
  assert.throws(() => parseHcmGovernanceReadinessResponse(200, wrongCount, 23), /inconsistent/);
  const wrongStatus = mutate(report => { report.status = "manual_review_required"; });
  assert.throws(() => parseHcmGovernanceReadinessResponse(200, wrongStatus, 23), /inconsistent/);
  const unknownFinding = mutate(report => {
    report.findings = [
      { code: "UNRECOGNIZED", severity: "high", affected: 1, title: "Unknown", nextAction: "Review" },
    ];
    report.summary.highPriorityCategories = 1;
    report.status = "manual_review_required";
  });
  assert.throws(() => parseHcmGovernanceReadinessResponse(200, unknownFinding, 23), /incomplete/);
});

test("rejects missing or contradictory business-process evidence", () => {
  const missing = mutate(report => { report.processes.pop(); });
  assert.throws(() => parseHcmGovernanceReadinessResponse(200, missing, 23), /incomplete/);
  const duplicate = mutate(report => { report.processes[1].processType = "hire"; });
  assert.throws(() => parseHcmGovernanceReadinessResponse(200, duplicate, 23), /incomplete/);
  const falseActive = mutate(report => { report.processes[0].policyState = "active_definition_exists"; });
  assert.throws(() => parseHcmGovernanceReadinessResponse(200, falseActive, 23), /incomplete/);
  const impossibleCounts = mutate(report => { report.processes[0].currentActiveDefinitions = 1; });
  assert.throws(() => parseHcmGovernanceReadinessResponse(200, impossibleCounts, 23), /incomplete/);
});

test("rejects malformed dates and does not forward unexpected worker-level fields", () => {
  for (const asOf of ["2026-02-30", "2026-10-20T00:00", "tomorrow"]) {
    const candidate = mutate(report => { report.asOf = asOf; });
    assert.throws(() => parseHcmGovernanceReadinessResponse(200, candidate, 23), /incomplete/);
  }
  const payload = { ...validReport(), employees: [{ name: "Fictional Private Employee" }] };
  const parsed = parseHcmGovernanceReadinessResponse(200, payload, 23);
  assert.equal("employees" in parsed, false);
  assert.doesNotMatch(JSON.stringify(parsed), /Fictional Private Employee/);
});

test("HTTP denial/server responses never become green and do not print source error details", () => {
  const raw = { error: "sensitive-database-detail", ...validReport() };
  for (const [statusCode, expected] of [
    [401, /Sign in/], [403, /administrator access/],
    [404, /not enabled/], [500, /could not be loaded/], [503, /could not be loaded/],
  ] as const) {
    assert.throws(() => parseHcmGovernanceReadinessResponse(statusCode, raw, 23), expected);
  }
  assert.throws(() => parseHcmGovernanceReadinessResponse(204, raw, 23), /could not be loaded/);
});

test("source wiring carries employer identity and abortable failed-read / retry safeguards", () => {
  const route = readFileSync("src/app/api/hcm/governance-readiness/route.ts", "utf8");
  const panel = readFileSync("src/components/hcm-governance-readiness-panel.tsx", "utf8");
  assert.match(route, /organizationId,\s*\.\.\.await loadHcmGovernanceReadiness\(organizationId\)/);
  assert.match(panel, /parseHcmGovernanceReadinessResponse\(/);
  assert.match(panel, /signal: controller\.signal/);
  assert.match(panel, /controller\.abort\(\)/);
  assert.match(panel, /requestId !== requestGeneration\.current/);
  assert.match(panel, /setReport\(null\)/);
  assert.match(panel, /setRefreshNonce\(\(current\) => current \+ 1\)/);
  assert.doesNotMatch(panel, /setReport\(payload as HcmGovernanceReport\)/);
  assert.match(panel, /Unavailable, retry/);
  assert.match(panel, /onClick=\{retryRead\}>Retry<\/button>/);
});
