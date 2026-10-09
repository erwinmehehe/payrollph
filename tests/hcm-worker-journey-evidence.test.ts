import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  buildHcmWorkerJourney,
  type WorkerJourneyInput,
  type WorkerJourneyStageId,
} from "../src/lib/hcm-worker-journey";

const read = (path: string) => readFileSync(path, "utf8");

const worker: WorkerJourneyInput = {
  employeeStatus: "Active",
  recruitment: null,
  currentPositionId: null,
  lastPositionAssignmentId: null,
  onboarding: [],
  offboarding: [],
  latestPerformance: null,
  compensationVisible: false,
  latestCompensation: null,
  payrollVisible: false,
  lastReleasedPayroll: null,
  separation: null,
  outstandingAssets: 0,
};

function find(input: WorkerJourneyInput, id: WorkerJourneyStageId) {
  const journey = buildHcmWorkerJourney(input);
  const found = journey.stages.find((row) => row.id === id);
  assert.ok(found, `Missing journey stage ${id}`);
  return found;
}

test("a new employee has seven distinct milestones without fabricated approvals", () => {
  const journey = buildHcmWorkerJourney(worker);
  assert.deepEqual(journey.stages.map((row) => row.id), [
    "recruitment", "position", "onboarding", "performance",
    "compensation", "payroll", "offboarding",
  ]);
  assert.equal(journey.summary.recorded, 0);
  assert.equal(journey.summary.notRecorded, 4);
  assert.equal(journey.summary.restricted, 2);
  assert.equal(journey.summary.notApplicable, 1);
  assert.match(journey.disclaimer, /not a payroll/i);
  assert.match(find(worker, "recruitment").detail, /migrated hires may be legitimate/);
});

test("a connected hire can show completed source milestones but never claims bank settlement", () => {
  const journey = buildHcmWorkerJourney({
    ...worker,
    recruitment: { applicantId: 9, stage: "hired", requisitionId: 4, requisitionPositionId: 3 },
    currentPositionId: 3,
    onboarding: [{ done: true }, { done: true }],
    latestPerformance: { id: 13, status: "completed" },
    compensationVisible: true,
    latestCompensation: { id: 17, status: "applied" },
    payrollVisible: true,
    lastReleasedPayroll: { runId: 25, periodEnd: "2026-09-30" },
  });
  assert.equal(journey.summary.recorded, 6);
  assert.equal(journey.summary.notApplicable, 1);
  const recruitment = journey.stages.find((row) => row.id === "recruitment");
  assert.deepEqual(recruitment?.evidence, { source: "job_applicants", id: 9 });
  const payroll = journey.stages.find((row) => row.id === "payroll");
  assert.equal(payroll?.state, "recorded");
  assert.match(payroll?.detail ?? "", /bank settlement is not verified/i);
  assert.equal(journey.stages.find((row) => row.id === "compensation")?.evidence?.id, 17);
});

test("role gates always override accidental financial evidence in supplied input", () => {
  const input = {
    ...worker,
    compensationVisible: false,
    latestCompensation: { id: 71, status: "applied" },
    payrollVisible: false,
    lastReleasedPayroll: { runId: 88, periodEnd: "2026-09-30" },
  };
  const comp = find(input, "compensation");
  const pay = find(input, "payroll");
  assert.equal(comp.state, "restricted");
  assert.equal(pay.state, "restricted");
  assert.equal(comp.evidence, null);
  assert.equal(pay.evidence, null);
  assert.ok(!pay.detail.includes("88"));
});

test("a linked applicant that is not hired cannot be treated as proof of hire", () => {
  const row = find({
    ...worker,
    recruitment: { applicantId: 14, stage: "offer", requisitionId: 8, requisitionPositionId: null },
  }, "recruitment");
  assert.equal(row.state, "attention");
});

test("unfinished onboarding, review and compensation approval remain in progress", () => {
  const input: WorkerJourneyInput = {
    ...worker,
    onboarding: [{ done: true }, { done: false }],
    latestPerformance: { id: 20, status: "in_progress" },
    compensationVisible: true,
    latestCompensation: { id: 21, status: "approved" },
  };
  for (const id of ["onboarding", "performance", "compensation"] as const) {
    assert.equal(find(input, id).state, "in_progress");
  }
  assert.equal(find({ ...input, latestCompensation: { id: 21, status: "failed" } }, "compensation").state, "attention");
});

test("a released Separation record alone does not close open offboarding tasks or unreturned assets", () => {
  const base: WorkerJourneyInput = {
    ...worker,
    employeeStatus: "Separated",
    currentPositionId: null,
    lastPositionAssignmentId: 22,
    separation: { id: 10, status: "released" },
    offboarding: [{ done: true }, { done: false }],
    outstandingAssets: 1,
  };
  assert.equal(find(base, "position").state, "recorded");
  assert.equal(find(base, "offboarding").state, "attention");
  assert.equal(find({
    ...base,
    offboarding: [{ done: true }, { done: true }],
    outstandingAssets: 0,
  }, "offboarding").state, "recorded");
  assert.equal(find({
    ...base,
    offboarding: [],
    outstandingAssets: 0,
  }, "offboarding").state, "in_progress");
  assert.match(find({
    ...base, offboarding: [{ done: true }], outstandingAssets: 0,
  }, "offboarding").detail, /not prove bank settlement/);
});

test("exited status without authoritative Separation is a reconciliation finding", () => {
  const result = find({ ...worker, employeeStatus: "Terminated" }, "offboarding");
  assert.equal(result.state, "attention");
  assert.equal(result.evidence, null);
});

test("worker profile enforces tenant/scope access before reading cross-module evidence", () => {
  const route = read("src/app/api/hcm/worker-profile/route.ts");
  assert.ok(route.indexOf("assertOrganizationRole") < route.indexOf("linkedApplicantRows"));
  assert.ok(route.indexOf("assertScope(access, employee.orgUnitId)") < route.indexOf("linkedApplicantRows"));
  for (const anchor of [
    "eq(jobApplicants.organizationId, organizationId)",
    "eq(jobRequisitions.organizationId, organizationId)",
    "eq(jobApplicants.hiredEmployeeId, employeeId)",
    "eq(performanceReviews.organizationId, organizationId)",
    "eq(performanceReviews.employeeId, employeeId)",
    "eq(compensationProposals.organizationId, organizationId)",
    "eq(compensationProposals.employeeId, employeeId)",
    "eq(payrollRuns.organizationId, organizationId)",
    "eq(payrollEntries.employeeId, employeeId)",
    'eq(payrollRuns.status, "Released")',
    'roleGateAllowed(user.id, organizationId, "payroll.view")',
    "roleAllowed(access.role, PAYROLL_VIEW_ROLES)",
    "const compensationVisible = access.companyWide",
    "buildHcmWorkerJourney",
  ]) {
    assert.ok(route.includes(anchor), `Missing journey isolation rule: ${anchor}`);
  }
  assert.equal(route.includes("export async function POST"), false);
  assert.equal(route.includes("export async function PATCH"), false);
  assert.equal(route.includes("tx.insert("), false);
  assert.equal(route.includes("db.update("), false);
});

test("People embeds the read-only journey only inside the authorized connected profile", () => {
  const people = read("src/components/workspace/people.tsx");
  const panel = read("src/components/hcm-worker-journey-panel.tsx");
  const firstGuard = people.indexOf("{canManage && (");
  const panelLocation = people.indexOf("journey={connectedProfile.journey}");
  assert.ok(firstGuard >= 0 && firstGuard < panelLocation);
  assert.ok(people.includes('import { HcmWorkerJourneyPanel }'));
  assert.ok(panel.includes('item.state !== "restricted"'));
  assert.ok(panel.includes("onPage(item.page)"));
  assert.ok(panel.includes("journey.disclaimer"));
  assert.ok(!panel.includes("grossPay") && !panel.includes("netPay"));
});
