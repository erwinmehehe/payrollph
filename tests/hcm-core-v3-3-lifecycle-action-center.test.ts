import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  buildEmploymentLifecycleRow,
  sortEmploymentLifecycleRows,
  summarizeEmploymentLifecycle,
} from "../src/lib/hcm-lifecycle-readiness";

const read = (path: string) => readFileSync(path, "utf8");

const employee = {
  employeeId: 10,
  employeeNo: "EMP-010",
  employeeName: "Ana Santos",
  employeeStatus: "Active",
  separation: null,
  today: "2026-10-06",
};

test("unconfigured workers surface a governed-terms action without changing employment state", () => {
  const row = buildEmploymentLifecycleRow({
    ...employee,
    term: null,
    decision: null,
  });
  assert.equal(row.state, "unconfigured");
  assert.equal(row.action, "configure_terms");
  assert.match(row.detail, /effective-dated employment terms/i);
});

test("probation review dates produce deterministic 30-day readiness without auto-regularization", () => {
  const row = buildEmploymentLifecycleRow({
    ...employee,
    term: {
      id: 1,
      termKind: "probationary",
      employmentType: "Probationary",
      effectiveFrom: "2026-06-01",
      probationReviewDate: "2026-10-10",
      status: "active",
    },
    decision: null,
  });
  assert.equal(row.state, "upcoming");
  assert.equal(row.action, "record_decision");
  assert.equal(row.daysUntil, 4);
  assert.match(row.detail, /will not infer regularization/i);
});

test("overdue fixed-term endings require an explicit decision", () => {
  const row = buildEmploymentLifecycleRow({
    ...employee,
    term: {
      id: 2,
      termKind: "fixed_term",
      employmentType: "Contractual",
      effectiveFrom: "2026-01-01",
      effectiveUntil: "2026-10-05",
      contractEndDate: "2026-10-05",
      status: "active",
    },
    decision: null,
  });
  assert.equal(row.state, "action_required");
  assert.equal(row.action, "record_decision");
  assert.equal(row.daysUntil, -1);
});

test("pending and failed decisions outrank raw lifecycle dates", () => {
  const term = {
    id: 3,
    termKind: "fixed_term",
    employmentType: "Contractual",
    effectiveFrom: "2026-01-01",
    contractEndDate: "2026-10-05",
    status: "active",
  };
  const pending = buildEmploymentLifecycleRow({
    ...employee,
    term,
    decision: {
      id: 20,
      decisionKind: "renew_term",
      status: "pending_approval",
      effectiveDate: "2026-10-05",
    },
  });
  assert.equal(pending.action, "review_decision");

  const failed = buildEmploymentLifecycleRow({
    ...employee,
    term,
    decision: {
      id: 21,
      decisionKind: "renew_term",
      status: "failed",
      effectiveDate: "2026-10-05",
      failure: "Activation conflict",
    },
  });
  assert.equal(failed.action, "retry_decision");
  assert.match(failed.detail, /Activation conflict/);
});

test("approved non-renewal becomes a Separation action, not an employee-status mutation", () => {
  const term = {
    id: 4,
    termKind: "fixed_term",
    employmentType: "Contractual",
    effectiveFrom: "2026-01-01",
    contractEndDate: "2026-10-31",
    status: "active",
  };
  const ready = buildEmploymentLifecycleRow({
    ...employee,
    term,
    decision: {
      id: 30,
      decisionKind: "non_renew",
      status: "applied",
      effectiveDate: "2026-10-01",
      proposedSeparationLastDay: "2026-10-31",
      separationHandoffStatus: "ready",
    },
  });
  assert.equal(ready.action, "start_separation");
  assert.equal(ready.state, "action_required");

  const started = buildEmploymentLifecycleRow({
    ...employee,
    term,
    decision: {
      id: 30,
      decisionKind: "non_renew",
      status: "applied",
      effectiveDate: "2026-10-01",
      proposedSeparationLastDay: "2026-10-31",
      separationHandoffStatus: "started",
      separationRecordId: 99,
    },
    separation: { id: 99, status: "draft", lastDay: "2026-10-31" },
  });
  assert.equal(started.action, "continue_separation");
  assert.equal(started.state, "in_progress");
});

test("lifecycle summary and sort put urgent employment actions first", () => {
  const rows = [
    buildEmploymentLifecycleRow({ ...employee, employeeId: 1, employeeName: "Clear Worker", term: {
      id: 1, termKind: "regular", employmentType: "Regular", effectiveFrom: "2026-01-01", status: "active",
    }, decision: null }),
    buildEmploymentLifecycleRow({ ...employee, employeeId: 2, employeeName: "Due Worker", term: {
      id: 2, termKind: "probationary", employmentType: "Probationary", effectiveFrom: "2026-01-01",
      probationReviewDate: "2026-10-06", status: "active",
    }, decision: null }),
  ];
  const sorted = sortEmploymentLifecycleRows(rows);
  assert.equal(sorted[0].employeeId, 2);
  assert.equal(summarizeEmploymentLifecycle(sorted).actionRequired, 1);
});

test("lifecycle readiness API is company-wide, read-only and payroll-aware", () => {
  const route = read("src/app/api/hcm/lifecycle-readiness/route.ts");
  const server = read("src/lib/hcm-lifecycle-readiness-server.ts");
  assert.ok(route.includes("PEOPLE_PAYROLL_ROLES"));
  assert.ok(route.includes("access?.companyWide"));
  assert.ok(route.includes("loadEmploymentLifecycleReadiness"));
  assert.ok(server.includes("hcmEmploymentTerms"));
  assert.ok(server.includes("hcmEmploymentTermDecisions"));
  assert.ok(server.includes("separationRecords"));
  assert.equal(route.includes("export async function POST"), false);
  assert.equal(route.includes("export async function PATCH"), false);
});

test("People exposes org-wide lifecycle action center and worker-level governed controls", () => {
  const people = read("src/components/workspace/people.tsx");
  assert.ok(people.includes("HcmEmploymentLifecycleActionCenter"));
  assert.ok(people.includes("HcmEmploymentLifecycleWorker"));
  assert.ok(people.includes('onOpenSeparation={() => onPage("separation")}'));
});

test("worker lifecycle UI routes all mutations through existing governed APIs", () => {
  const worker = read("src/components/hcm-employment-lifecycle-worker.tsx");
  assert.ok(worker.includes('"/api/hcm/employment-terms"'));
  assert.ok(worker.includes('"/api/hcm/employment-term-decisions"'));
  assert.ok(worker.includes("Four-eyes"));
  assert.ok(worker.includes("never auto-regularizes"));
  assert.ok(worker.includes("never auto-renews"));
  assert.ok(worker.includes("auto-separates"));
});

test("Separation surfaces ready non-renewals and submits the authoritative decision id", () => {
  const separation = read("src/components/separation-panel.tsx");
  assert.ok(separation.includes("/api/hcm/lifecycle-readiness"));
  assert.ok(separation.includes("GOVERNED NON-RENEWAL HANDOFFS"));
  assert.ok(separation.includes("employmentTermDecisionId"));
  assert.ok(separation.includes('separationType: "end_of_contract"'));
  assert.ok(separation.includes("Start linked Separation"));
  assert.ok(separation.includes("approved last day are locked"));
});
