import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  buildHcmGovernanceReadiness,
  HCM_REVIEW_TYPES,
  type HcmGovernanceCounters,
  type HcmGovernancePolicy,
} from "../src/lib/hcm-governance-readiness";

const empty: HcmGovernanceCounters = {
  employees: 0,
  activeWorkers: 0,
  futureStartDates: 0,
  missingRestDays: 0,
  missingPayProfiles: 0,
  unsupportedWageRegions: 0,
  duplicateEmployeeNumbers: 0,
  approvedSeparationsWithoutClearance: 0,
  releasedSeparationsWithoutReference: 0,
  releasedSeparationsWorkerNotSeparated: 0,
  separatedWorkersWithOpenAssignments: 0,
  inProgressBusinessProcesses: 0,
  pendingHcmSteps: 0,
  overdueHcmSteps: 0,
  pendingHcmApprovalTaskMismatch: 0,
  hcmProcessesWithoutPendingCurrentStep: 0,
};

function evaluate(
  changes: Partial<HcmGovernanceCounters> = {},
  definitions: HcmGovernancePolicy[] = [],
) {
  return buildHcmGovernanceReadiness({
    asOf: "2026-10-09",
    counters: { ...empty, ...changes },
    definitions,
  });
}

test("clean HCM inventory is not presented as payroll or statutory certification", () => {
  const result = evaluate();
  assert.equal(result.status, "inventory_only");
  assert.deepEqual(result.findings, []);
  assert.equal(result.processes.length, HCM_REVIEW_TYPES.length);
  assert.ok(result.processes.every(row => row.policyState === "system_default_or_not_configured"));
  assert.match(result.limitations.join(" "), /not a compliance certificate/);
  assert.match(result.limitations.join(" "), /bank settlement/);
});

test("different types of exception remain actionable without revealing employee PII", () => {
  const result = evaluate({
    employees: 30, activeWorkers: 27,
    unsupportedWageRegions: 2, duplicateEmployeeNumbers: 1,
    missingRestDays: 3, futureStartDates: 2,
    approvedSeparationsWithoutClearance: 2,
    releasedSeparationsWithoutReference: 1,
    releasedSeparationsWorkerNotSeparated: 1,
    separatedWorkersWithOpenAssignments: 2,
  });
  assert.equal(result.status, "manual_review_required");
  assert.equal(result.summary.employeeCount, 30);
  assert.equal(result.summary.highPriorityCategories, 5);
  assert.equal(result.summary.reviewCategories, 3);
  assert.equal(result.findings.find(row => row.code === "UNKNOWN_WAGE_REGION")?.affected, 2);
  assert.equal(result.findings.find(row => row.code === "FINAL_PAY_EMPLOYEE_STATUS_MISMATCH")?.severity, "high");
  assert.equal(JSON.stringify(result).includes("employeeNo"), false);
  assert.equal(JSON.stringify(result).includes("bankAccount"), false);
  assert.equal(JSON.stringify(result).includes("netPay"), false);
});

test("stalled, overdue and broken approval links generate review guidance without exposing work items", () => {
  const result = evaluate({
    inProgressBusinessProcesses: 4,
    pendingHcmSteps: 3,
    overdueHcmSteps: 2,
    pendingHcmApprovalTaskMismatch: 1,
    hcmProcessesWithoutPendingCurrentStep: 1,
  });
  assert.equal(result.summary.pendingHcmSteps, 3);
  assert.equal(result.summary.overdueHcmSteps, 2);
  assert.equal(result.findings.find(row => row.code === "HCM_APPROVAL_TASK_MISMATCH")?.severity, "high");
  assert.equal(result.findings.find(row => row.code === "HCM_PROCESS_NO_ACTIVE_STEP")?.affected, 1);
  assert.equal(result.findings.find(row => row.code === "HCM_OVERDUE_WORK_ITEMS")?.severity, "review");
  assert.equal(result.summary.highPriorityCategories, 2);
  assert.equal(result.summary.reviewCategories, 1);
  assert.match(result.limitations.join(" "), /diagnostic leads/);
  assert.doesNotMatch(JSON.stringify(result), /employeeId|approverEmail|bankAccount|sourceKey/);
});

test("current policy count respects scope, active flag and inclusive Manila dates", () => {
  const rows: HcmGovernancePolicy[] = [
    { processType: "hire", active: true, effectiveFrom: "2026-01-01", effectiveUntil: "2026-10-09", supervisoryOrgUnitId: 9 },
    { processType: "hire", active: true, effectiveFrom: "2026-10-10", effectiveUntil: null, supervisoryOrgUnitId: null },
    { processType: "hire", active: false, effectiveFrom: "2025-01-01", effectiveUntil: null, supervisoryOrgUnitId: null },
    { processType: "transfer", active: true, effectiveFrom: "2024-01-01", effectiveUntil: "2026-10-08", supervisoryOrgUnitId: null },
  ];
  const result = evaluate({}, rows);
  const hire = result.processes.find(row => row.processType === "hire");
  const transfer = result.processes.find(row => row.processType === "transfer");
  assert.equal(hire?.configuredDefinitions, 3);
  assert.equal(hire?.currentActiveDefinitions, 1);
  assert.equal(hire?.scopedDefinitions, 1);
  assert.equal(hire?.policyState, "active_definition_exists");
  assert.equal(transfer?.policyState, "configured_without_current_active_definition");
  assert.equal(result.status, "inventory_only", "Policy list is an inventory, not automatic noncompliance.");
});

test("invalid query aggregates cannot silently become zero or ready status", () => {
  assert.throws(() => evaluate({ employees: -1 }), /Invalid HCM aggregate/);
  assert.throws(() => evaluate({ missingPayProfiles: Number.NaN }), /Invalid HCM aggregate/);
  assert.throws(() => evaluate({ inProgressBusinessProcesses: 0.5 }), /Invalid HCM aggregate/);
  assert.throws(() => buildHcmGovernanceReadiness({
    asOf: "bad", counters: empty, definitions: [],
  }), /ISO calendar date/);
});

test("readiness is GET only, company-wide, no-store and does not update HR or payroll", () => {
  const api = readFileSync("src/app/api/hcm/governance-readiness/route.ts", "utf8");
  const loader = readFileSync("src/lib/hcm-governance-readiness-server.ts", "utf8");
  const ui = readFileSync("src/components/hcm-governance-readiness-panel.tsx", "utf8");
  const admin = readFileSync("src/components/hcm-business-process-admin.tsx", "utf8");
  assert.ok(api.includes("export async function GET("));
  assert.ok(!api.includes("export async function POST("));
  assert.ok(!api.includes("export async function PATCH("));
  assert.ok(!api.includes("export async function DELETE("));
  assert.ok(api.includes("getSessionUser()"));
  assert.ok(api.includes("assertOrganizationRole("));
  assert.ok(api.includes("PEOPLE_ADMIN_ROLES"));
  assert.ok(api.includes("!access?.companyWide"));
  assert.ok(api.includes('Cache-Control": "private, no-store'));
  assert.ok(api.includes('process.env.HCM_GOVERNANCE_READINESS_ENABLED !== "true"'));
  assert.ok(api.includes('code: "HCM_GOVERNANCE_READINESS_DISABLED"'));
  assert.ok(api.includes("loadHcmGovernanceReadiness(organizationId)"));
  assert.ok(loader.includes("hcm_business_process_instances"));
  assert.ok(loader.includes("hcm_business_process_instance_steps"));
  assert.ok(loader.includes("approval_tasks task"));
  assert.ok(loader.includes("task.organization_id <> step.organization_id"));
  assert.ok(loader.includes("step.due_at < now()"));
  assert.ok(loader.includes("step.step_index = bp.current_step_index"));
  assert.ok(loader.includes("WHERE e.organization_id = ${organizationId}"));
  assert.ok(loader.includes("FROM separation_records sr"));
  assert.ok(loader.includes("FROM position_assignments pa"));
  assert.ok(!loader.includes("db.update("));
  assert.ok(!loader.includes("db.insert("));
  assert.ok(!loader.includes("db.delete("));
  assert.ok(ui.includes("No employee identities"));
  assert.ok(ui.includes("requestGeneration.current"));
  assert.ok(ui.includes("if (requestId !== requestGeneration.current) return"));
  assert.ok(ui.includes("loadedOrganizationId === organizationId ? storedReport : null"));

  assert.ok(ui.includes("not certification") || ui.includes("not certification."));
  assert.ok(admin.includes('process.env.NEXT_PUBLIC_HCM_GOVERNANCE_READINESS_ENABLED === "true"'));
  assert.ok(admin.includes("<HcmGovernanceReadinessPanel organizationId={organizationId} />"));
});
