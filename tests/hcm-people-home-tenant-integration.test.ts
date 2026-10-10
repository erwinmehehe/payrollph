import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { eq } from "drizzle-orm";
import { db } from "../src/db";
import {
  approvalDelegations, employees, hcmBusinessProcessInstances,
  hcmBusinessProcessInstanceSteps, organizations, provisioningTasks,
} from "../src/db/schema";
import { loadHcmPeopleHomeSources } from "../src/lib/hcm-people-home-server";

/**
 * Synthetic tenant isolation regression. No live worker PII, payroll changes,
 * migrations, or production feature activation.
 *
 * A crowded tenant is deliberate: the unrelated steps have earlier due dates
 * than the viewer's work. An early LIMIT-before-authorization would hide it.
 */
test("HCM People Home selects authorized work before LIMIT and isolates two employers", async () => {
  const unique = randomUUID().slice(0, 12);
  const [alpha, beta] = await db.insert(organizations).values([
    { name: "HCM Alpha " + unique, legalName: "HCM Alpha " + unique, plan: "Core" },
    { name: "HCM Beta " + unique, legalName: "HCM Beta " + unique, plan: "Core" },
  ]).returning();

  try {
    const [alice] = await db.insert(employees).values({
      organizationId: alpha.id,
      employeeNo: "SAME-001",
      firstName: "PrivateAlpha" + unique,
      lastName: "Synthetic",
      title: "Staff",
      status: "Active",
      avatarInitials: "PA",
      basicRate: "28282.00",
      region: "NCR",
      startDate: "2026-01-01",
    }).returning();
    const [bob] = await db.insert(employees).values({
      organizationId: beta.id,
      employeeNo: "SAME-001",
      firstName: "PrivateBeta" + unique,
      lastName: "Synthetic",
      title: "Staff",
      status: "Active",
      avatarInitials: "PB",
      basicRate: "39393.00",
      region: "NCR",
      startDate: "2026-01-01",
    }).returning();

    const unrelatedCount = 48;
    const alphaInstances = await db.insert(hcmBusinessProcessInstances).values(
      Array.from({ length: unrelatedCount + 2 }, (_, index) => ({
        organizationId: alpha.id,
        definitionCode: "people-home-qa",
        definitionVersion: 1,
        processType: "hire",
        sourceType: "readiness-fixture",
        sourceKey: "alpha-" + unique + "-" + index,
        employeeId: alice.id,
        definitionSnapshot: { name: "Synthetic hire review", steps: [] },
        initiatedByName: "Fixture Maker",
        status: "in_progress",
      })),
    ).returning();

    await db.insert(hcmBusinessProcessInstanceSteps).values(alphaInstances.map((instance, index) => ({
      organizationId: alpha.id,
      instanceId: instance.id,
      stepIndex: 0,
      stepType: "approval",
      label: "Private applicant review",
      assignee: index < unrelatedCount ? "Unrelated Approver"
        : index === unrelatedCount ? "role:hr" : "Delegated Reviewer " + unique,
      status: "pending",
      dueAt: index < unrelatedCount
        ? new Date("2020-01-01T00:00:00Z")
        : new Date("2040-01-01T00:00:00Z"),
    })));

    const [betaInstance] = await db.insert(hcmBusinessProcessInstances).values({
      organizationId: beta.id,
      definitionCode: "people-home-qa",
      definitionVersion: 1,
      processType: "hire",
      sourceType: "readiness-fixture",
      sourceKey: "beta-" + unique,
      employeeId: bob.id,
      definitionSnapshot: { name: "Synthetic hire review", steps: [] },
      initiatedByName: "Fixture Maker",
      status: "in_progress",
    }).returning();
    const [betaStep] = await db.insert(hcmBusinessProcessInstanceSteps).values({
      organizationId: beta.id,
      instanceId: betaInstance.id,
      stepIndex: 0,
      stepType: "approval",
      label: "Private beta review",
      assignee: "role:hr",
      status: "pending",
      dueAt: new Date("2030-01-01T00:00:00Z"),
    }).returning();

    await db.insert(approvalDelegations).values({
      organizationId: alpha.id,
      fromApprover: "Delegated Reviewer " + unique,
      toApprover: "Claudia HR",
      startsOn: "2000-01-01",
      endsOn: "2099-12-31",
      active: true,
    });
    await db.insert(provisioningTasks).values([
      { organizationId: alpha.id, employeeId: alice.id, kind: "onboarding", title: "Private alpha source", done: false },
      { organizationId: beta.id, employeeId: bob.id, kind: "onboarding", title: "Private beta source", done: false },
    ]);

    const viewer = { userId: 42, name: "Claudia HR", role: "hr" };
    const [a, b] = await Promise.all([
      loadHcmPeopleHomeSources(alpha.id, viewer),
      loadHcmPeopleHomeSources(beta.id, viewer),
    ]);

    assert.equal(a.decisions.status, "ready");
    assert.equal(b.decisions.status, "ready");
    assert.equal(a.decisions.partial, false, "unrelated earlier approvals must not consume this user's page");
    assert.equal(a.decisions.hasMore, false);
    assert.equal(a.decisions.items.length, 2, "role-assigned and delegated work are both visible");
    assert.equal(b.decisions.items.length, 1);
    assert.ok(a.decisions.items.every((item) => item.tenantId === alpha.id
      && item.subjectEmployeeId === alice.id));
    assert.ok(b.decisions.items.every((item) => item.tenantId === beta.id
      && item.subjectEmployeeId === bob.id));
    assert.ok(!a.decisions.items.some((item) => item.sourceId === String(betaStep.id)));

    assert.equal(a.followUps.status, "ready");
    assert.equal(b.followUps.status, "ready");
    assert.ok(a.followUps.items.some((item) => item.subjectEmployeeId === alice.id));
    assert.ok(b.followUps.items.some((item) => item.subjectEmployeeId === bob.id));
    assert.ok(a.followUps.items.every((item) => item.tenantId === alpha.id));
    assert.ok(b.followUps.items.every((item) => item.tenantId === beta.id));

    for (const view of [a, b]) {
      const response = JSON.stringify(view);
      for (const sensitive of ["PrivateAlpha", "PrivateBeta", "28282.00", "39393.00",
        "Private alpha source", "Private beta source", "Private applicant review"]) {
        assert.ok(!response.includes(sensitive), "PII must not enter the People Home envelope");
      }
    }
  } finally {
    await db.delete(organizations).where(eq(organizations.id, alpha.id));
    await db.delete(organizations).where(eq(organizations.id, beta.id));
  }
});
