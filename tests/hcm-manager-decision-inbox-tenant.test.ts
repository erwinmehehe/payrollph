import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { and, eq } from "drizzle-orm";
import { db } from "../src/db";
import {
  approvalDelegations, approvalTasks, employees,
  hcmBusinessProcessInstances, hcmBusinessProcessInstanceSteps,
  leaveRequests, orgUnits, organizations, overtimeRequests,
  userOrganizations, users,
} from "../src/db/schema";
import { loadManagerDecisionPage } from "../src/lib/hcm-manager-decision-server";
import { deriveManagerDecisionScope } from "../src/lib/hcm-manager-decision-contract";

/** Synthetic employer-specific source integrity. No production users/data. */
test("Manager Decision Inbox only displays assigned same-unit, same-tenant source tasks", async () => {
  const id = randomUUID().slice(0, 11);
  const [alpha, beta] = await db.insert(organizations).values([
    { name: "Decision Alpha " + id, legalName: "Decision Alpha " + id, plan: "Core" },
    { name: "Decision Beta " + id, legalName: "Decision Beta " + id, plan: "Core" },
  ]).returning();
  const actorIds: number[] = [];
  try {
    const [alphaUnit, alphaOtherUnit, betaUnit] = await db.insert(orgUnits).values([
      { organizationId: alpha.id, code: "DA-" + id, name: "Visible Team", type: "department" },
      { organizationId: alpha.id, code: "DX-" + id, name: "Private Other Team", type: "department" },
      { organizationId: beta.id, code: "DB-" + id, name: "Private Beta", type: "department" },
    ]).returning();

    const [alphaUser, betaUser] = await db.insert(users).values([
      { email: "decision-alpha-" + id + "@example.invalid", name: "Inbox Manager " + id, passwordHash: "synthetic-hash" },
      { email: "decision-beta-" + id + "@example.invalid", name: "Inbox Manager " + id, passwordHash: "synthetic-hash" },
    ]).returning();
    actorIds.push(alphaUser.id, betaUser.id);
    await db.insert(userOrganizations).values([
      { organizationId: alpha.id, userId: alphaUser.id, role: "manager", orgUnitId: alphaUnit.id, active: true },
      { organizationId: beta.id, userId: betaUser.id, role: "manager", orgUnitId: betaUnit.id, active: true },
    ]);

    const [member, otherMember, betaMember] = await db.insert(employees).values([
      {
        organizationId: alpha.id, orgUnitId: alphaUnit.id,
        employeeNo: "EMP-" + id, firstName: "Visible", lastName: "Worker",
        title: "Operator", basicRate: "22000.00", avatarInitials: "VW",
        startDate: "2026-01-01",
      },
      {
        organizationId: alpha.id, orgUnitId: alphaOtherUnit.id,
        employeeNo: "X-" + id, firstName: "Private", lastName: "Alpha",
        title: "Operator", basicRate: "22000.00", avatarInitials: "PA",
        startDate: "2026-01-01",
      },
      {
        organizationId: beta.id, orgUnitId: betaUnit.id,
        employeeNo: "EMP-" + id, firstName: "Private", lastName: "Beta",
        title: "Operator", basicRate: "94000.00", avatarInitials: "PB",
        startDate: "2026-01-01",
      },
    ]).returning();

    const [alphaLeaveTask, betaLeaveTask, otherUnitTask, alphaOtTask] =
      await db.insert(approvalTasks).values([
        {
          organizationId: alpha.id, title: "Private leave detail", detail: "Leave reason not for inbox",
          approver: "Original Reviewer " + id, dueLabel: "No SLA", status: "Pending",
        },
        {
          organizationId: beta.id, title: "Private beta leave", detail: "Foreign-tenant confidential",
          approver: "role:manager", dueLabel: "No SLA", status: "Pending",
        },
        {
          organizationId: alpha.id, title: "Other unit leave", detail: "Private unit reason",
          approver: "role:manager", dueLabel: "No SLA", status: "Pending",
        },
        {
          organizationId: alpha.id, title: "Overtime explanation", detail: "Do not expose OT details",
          approver: "role:manager", dueLabel: "No SLA", status: "Pending",
        },
      ]).returning();

    const [leave] = await db.insert(leaveRequests).values({
      organizationId: alpha.id, employeeId: member.id, approvalTaskId: alphaLeaveTask.id,
      leaveType: "Vacation", startDate: "2026-11-03", endDate: "2026-11-03",
      days: "1.0", reason: "Restricted leave reason", status: "Pending",
    }).returning();
    await db.insert(leaveRequests).values([
      {
        organizationId: beta.id, employeeId: betaMember.id, approvalTaskId: betaLeaveTask.id,
        leaveType: "Vacation", startDate: "2026-11-03", endDate: "2026-11-03",
        days: "1.0", reason: "Restricted beta reason", status: "Pending",
      },
      {
        organizationId: alpha.id, employeeId: otherMember.id, approvalTaskId: otherUnitTask.id,
        leaveType: "Vacation", startDate: "2026-11-03", endDate: "2026-11-03",
        days: "1.0", reason: "Restricted other unit reason", status: "Pending",
      },
    ]);

    const [overtime] = await db.insert(overtimeRequests).values({
      organizationId: alpha.id, employeeId: member.id, approvalTaskId: alphaOtTask.id,
      workDate: "2026-10-12", requestedMinutes: 90,
      requestedBy: "Synthetic staff", status: "pending", reason: "Restricted overtime reason",
    }).returning();

    await db.insert(approvalDelegations).values({
      organizationId: alpha.id,
      fromApprover: "Original Reviewer " + id,
      toApprover: alphaUser.name,
      reason: "Synthetic test only",
      startsOn: "2026-01-01", endsOn: "2027-12-31", active: true,
    });

    const [process] = await db.insert(hcmBusinessProcessInstances).values({
      organizationId: alpha.id, employeeId: member.id,
      processType: "transfer", sourceType: "synthetic_manager_inbox",
      sourceKey: "transfer-" + id,
      definitionCode: "synthetic-transfer", definitionVersion: 1,
      definitionSnapshot: { steps: [] },
      initiatedByName: "Independent source initiator",
      initiatedByUserId: null,
      status: "in_progress", currentStepIndex: 0,
    }).returning();
    const [hcmStep] = await db.insert(hcmBusinessProcessInstanceSteps).values({
      organizationId: alpha.id, instanceId: process.id, stepIndex: 0,
      stepType: "review", assignee: "role:manager", label: "Private review description",
      status: "pending", dueAt: new Date("2026-10-01T12:00:00Z"),
    }).returning();

    const scope = deriveManagerDecisionScope({
      role: "manager", orgUnitId: alphaUnit.id, companyWide: false,
    })!;
    const query = {
      organizationId: alpha.id, userId: alphaUser.id,
      userName: alphaUser.name, viewerRole: "manager", scope,
      before: null,
    } as const;

    const leavePage = await loadManagerDecisionPage({ ...query, source: "leave" });
    assert.deepEqual(leavePage.items.map((item) => item.sourceRecordId), [leave.id]);
    assert.equal(leavePage.items[0].assignment, "delegated");
    assert.equal(leavePage.items[0].dueAt, null);
    assert.equal(leavePage.items[0].dueState, "unscheduled");

    const overtimePage = await loadManagerDecisionPage({ ...query, source: "overtime" });
    assert.deepEqual(overtimePage.items.map((item) => item.sourceRecordId), [overtime.id]);
    assert.equal(overtimePage.items[0].assignment, "role");

    const hcmPage = await loadManagerDecisionPage({ ...query, source: "hcm" });
    assert.deepEqual(hcmPage.items.map((item) => item.id), [hcmStep.id]);
    assert.equal(hcmPage.items[0].dueState, "overdue");
    assert.equal(hcmPage.items[0].stepType, "review");

    const serialized = JSON.stringify([leavePage, overtimePage, hcmPage]);
    for (const secret of [
      "Private beta", "Private Other Team", "Restricted leave reason",
      "Restricted beta reason", "Restricted overtime reason",
      "Private review description", "Private leave detail", "Overtime explanation",
      "Synthetic test only", "94000",
    ]) {
      assert.ok(!serialized.includes(secret), "Sensitive source value exposed: " + secret);
    }

    const betaScope = deriveManagerDecisionScope({
      role: "manager", orgUnitId: betaUnit.id, companyWide: false,
    })!;
    const betaPage = await loadManagerDecisionPage({
      organizationId: beta.id, userId: betaUser.id, userName: betaUser.name,
      viewerRole: "manager", scope: betaScope, before: null, source: "leave",
    });
    assert.equal(betaPage.items.length, 1);
    assert.equal(betaPage.items[0].employee?.name, "Private Beta");
    assert.ok(!JSON.stringify(betaPage).includes("Visible Worker"));

    const foreignUnitPage = await loadManagerDecisionPage({
      ...query, scope: { kind: "unit", orgUnitId: betaUnit.id }, source: "hcm",
    }).then(() => "unexpected success", () => "denied");
    assert.equal(foreignUnitPage, "denied");

    // Ambiguous display names must not grant named/delegated tasks,
    // although role-queue tasks remain authorized by actual role.
    const [sameName] = await db.insert(users).values({
      email: "decision-name-collision-" + id + "@example.invalid",
      name: alphaUser.name, passwordHash: "synthetic-hash",
    }).returning();
    actorIds.push(sameName.id);
    await db.insert(userOrganizations).values({
      organizationId: alpha.id, userId: sameName.id, role: "employee",
      orgUnitId: alphaUnit.id, active: true,
    });
    const ambiguous = await loadManagerDecisionPage({ ...query, source: "leave" });
    assert.equal(ambiguous.items.length, 0, "named delegation cannot resolve a duplicate actor name");
    const roleStillAllowed = await loadManagerDecisionPage({ ...query, source: "overtime" });
    assert.equal(roleStillAllowed.items.length, 1, "role assignment is separate from name collision");

    // A manager who is the underlying worker cannot use this read-only
    // preview as evidence of an independent overtime decision.
    await db.update(userOrganizations).set({ workerEmployeeId: member.id }).where(and(
      eq(userOrganizations.organizationId, alpha.id),
      eq(userOrganizations.userId, alphaUser.id),
    ));
    const selfRequest = await loadManagerDecisionPage({ ...query, source: "overtime" });
    assert.equal(selfRequest.items.length, 0, "manager's own worker request excluded");

  } finally {
    await db.delete(organizations).where(eq(organizations.id, alpha.id));
    await db.delete(organizations).where(eq(organizations.id, beta.id));
    for (const actorId of actorIds) {
      await db.delete(users).where(eq(users.id, actorId));
    }
  }
});
