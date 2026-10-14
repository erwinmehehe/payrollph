/** Additive fictional Hire BP source for the SAME nine-stage payroll worker. */
import assert from "node:assert/strict";
import { and, eq } from "drizzle-orm";
import { db } from "../../src/db";
import { hashPassword } from "../../src/lib/crypto";
import {
  employees, hcmBusinessProcessDefinitions, hcmBusinessProcessInstanceSteps,
  jobApplicants, jobProfiles, positions, userOrganizations, users,
} from "../../src/db/schema";

type Client = {
  ok(path: string, method?: string, payload?: unknown): Promise<Record<string, any>>;
  json(path: string, method?: string, payload?: unknown): Promise<{ status: number; body: Record<string, any> }>;
};

export async function createConnectedGovernedWorker(input: {
  organizationId: number; workDate: string; password: string; owner: Client;
  login(email: string): Promise<Client>;
}) {
  const { organizationId, workDate, password, owner, login } = input;
  const directory = await owner.ok("/api/legal-entities?organizationId=" + organizationId);
  const legalEmployer = directory.legalEntities?.find((entity: { primaryEntity: boolean }) => entity.primaryEntity);
  assert.ok(Number(legalEmployer?.id) > 0, "Owner must configure the worker's legal employer before the position/hire");
  const actors = ["connected.hiring", "connected.reviewer"];
  for (const name of actors) {
    const [actor] = await db.insert(users).values({
      email: name + "@linaw.test", name: "Fictional " + name,
      role: "hr", passwordHash: hashPassword(password), totpEnabled: false, backupCodes: [],
    }).returning();
    await db.insert(userOrganizations).values({ userId: actor.id, organizationId, role: "hr" });
  }
  const [profile] = await db.insert(jobProfiles).values({
    organizationId, title: "Synthetic Attendance Worker", active: true,
  }).returning();
  const [position] = await db.insert(positions).values({
    organizationId, jobProfileId: profile.id, code: "CONNECTED-HIRE",
    legalEntityId: Number(legalEmployer.id), annualBudget: "336000.00", status: "approved",
  }).returning();
  await db.insert(hcmBusinessProcessDefinitions).values({
    organizationId, code: "connected-hire", name: "Fictional independent hire review",
    processType: "hire", effectiveFrom: workDate, active: true, version: 1,
    steps: [
      { type: "approval", label: "HR review", assignee: "role:hr", dueDays: 2, priority: "High" },
      { type: "approval", label: "Owner review", assignee: "role:owner", dueDays: 2, priority: "High" },
    ],
  });
  const maker = await login(actors[0] + "@linaw.test");
  const reviewer = await login(actors[1] + "@linaw.test");
  const requisition = await owner.ok("/api/recruitment", "POST", {
    entityType: "requisition", organizationId, positionId: position.id,
  });
  const candidate = await owner.ok("/api/recruitment", "POST", {
    entityType: "applicant", organizationId, requisitionId: requisition.id,
    fullName: "Fictional Worker", email: "worker.nine@linaw.test",
  });
  for (const stage of ["screening", "interview", "offer"]) await owner.ok("/api/recruitment", "PATCH", {
    applicantId: candidate.id, stage, ...(stage === "offer" ? { offeredSalary: 28000 } : {}),
  });
  const hire = { applicantId: candidate.id, employeeNo: "NINE-001", firstName: "Fictional",
    lastName: "Worker", startDate: workDate, region: "NCR", payBasis: "monthly",
    rateAmount: 28000, standardWorkDaysPerMonth: 22, standardHoursPerDay: 8 };
  const direct = await owner.json("/api/employees", "POST", { ...hire, organizationId });
  assert.equal(direct.status, 409);
  assert.equal(direct.body.code, "HCM_GOVERNED_HIRE_REQUIRED");
  const pending = await maker.json("/api/recruitment/hire", "POST", hire);
  assert.equal(pending.status, 202);
  assert.equal(pending.body.employeeCreated, false);
  const businessProcessId = Number(pending.body.businessProcess?.id);
  assert.ok(businessProcessId > 0);
  const retry = await maker.json("/api/recruitment/hire", "POST", hire);
  assert.equal(retry.status, 202);
  assert.equal(Number(retry.body.businessProcess?.id), businessProcessId);
  for (const [index, approver] of [reviewer, owner].entries()) {
    const before = await db.select({ id: employees.id }).from(employees).where(and(
      eq(employees.organizationId, organizationId), eq(employees.employeeNo, "NINE-001"),
    ));
    assert.equal(before.length, 0, "No worker exists before completed approval and conversion");
    const [step] = await db.select().from(hcmBusinessProcessInstanceSteps).where(and(
      eq(hcmBusinessProcessInstanceSteps.instanceId, businessProcessId),
      eq(hcmBusinessProcessInstanceSteps.stepIndex, index),
    ));
    assert.equal(step.status, "pending");
    assert.ok(step.approvalTaskId);
    assert.equal((await maker.json("/api/approvals/" + step.approvalTaskId,
      "PATCH", { status: "Approved" })).status, 403);
    await approver.ok("/api/approvals/" + step.approvalTaskId, "PATCH", { status: "Approved" });
  }
  const converted = await maker.json("/api/recruitment/hire", "POST", hire);
  assert.equal(converted.status, 201);
  assert.equal(converted.body.businessProcess?.status, "applied");
  const employeeId = Number(converted.body.employee?.id);
  assert.ok(employeeId > 0);
  assert.equal(converted.body.employee?.legalEntityId, Number(legalEmployer.id));
  assert.equal((await maker.json("/api/recruitment/hire", "POST", hire)).status, 409);
  const [linked] = await db.select().from(jobApplicants).where(eq(jobApplicants.id, Number(candidate.id)));
  assert.equal(linked.hiredEmployeeId, employeeId);
  // Identity completion is a real authorized onboarding API, not a database rewrite.
  await owner.ok("/api/employees", "PATCH", {
    organizationId, employeeId, tin: "QA-TIN-1001", tinBranchCode: "0000",
    sssNo: "QA-SSS-1001", philHealthNo: "QA-PHIC-1001", pagIbigNo: "QA-HDMF-1001",
  });
  // Initial fictional destination is a separate owner-authorized edit BEFORE
  // any payroll entry exists. Never combine payout and government-ID edits.
  const payout = await owner.json("/api/employees", "PATCH", {
    organizationId, employeeId, bankAccount: "QA-ACCOUNT-NOT-REAL-01", bankCode: "BDO",
    mobile: "QA-ONLY-0001", payoutChangeReason: "Fictional initial destination; no money movement",
  });
  assert.equal(payout.status, 200);
  assert.notEqual(payout.body.pendingApproval, true);
  return { employeeId, applicantId: Number(candidate.id), businessProcessId,
    legalEntityId: Number(legalEmployer.id),
    positionId: position.id, requisitionId: Number(requisition.id),
    positionSource: "approved-fixture-not-a-published-workforce-plan" };
}
