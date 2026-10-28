import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { eq, inArray } from "drizzle-orm";
import { db } from "../src/db";
import {
  automationOperationalCases,
  employees,
  hcmBusinessProcessInstances,
  hcmBusinessProcessInstanceSteps,
  orgUnits,
  organizations,
  permissionSets,
  provisioningTasks,
  userOrganizations,
  userPermissionAssignments,
  users,
} from "../src/db/schema";
import { loadPeopleHomeWorklist } from "../src/lib/hcm-people-home-worklist";

/**
 * Synthetic isolated PostgreSQL acceptance; never uses live employers or
 * payroll values. Verifies tenant boundaries at the read model, not only UI.
 */
test("People Home denies non-member, employee-only and unit HR while isolating two employers", async () => {
  const code = randomUUID().slice(0, 10);
  const oldFlags = {
    server: process.env.HCM_PEOPLE_HOME_ENABLED,
    public: process.env.NEXT_PUBLIC_HCM_PEOPLE_HOME_ENABLED,
    tenants: process.env.HCM_PEOPLE_HOME_ORG_IDS,
  };
  const [alpha, beta] = await db.insert(organizations).values([
    { name: "Home Alpha " + code, legalName: "Home Alpha " + code, plan: "Core" },
    { name: "Home Beta " + code, legalName: "Home Beta " + code, plan: "Core" },
  ]).returning();

  let actorId: number | null = null;
  try {
    const [actor] = await db.insert(users).values({
      email: "home-qa-" + code + "@example.test",
      name: "Synthetic HR " + code,
      passwordHash: "synthetic-not-a-valid-password",
      role: "hr",
    }).returning();
    actorId = actor.id;
    const [alphaMembership] = await db.insert(userOrganizations).values({
      userId: actor.id, organizationId: alpha.id, role: "hr", active: true,
    }).returning();
    const [alphaWorker, betaWorker] = await db.insert(employees).values([
      {
        organizationId: alpha.id, employeeNo: "SAME-EMPLOYEE-NO-" + code,
        firstName: "AlphaPrivate", lastName: "Worker", title: "Staff",
        avatarInitials: "AP", basicRate: "20000.00", startDate: "2026-01-01",
      },
      {
        organizationId: beta.id, employeeNo: "SAME-EMPLOYEE-NO-" + code,
        firstName: "BetaPrivate", lastName: "Worker", title: "Staff",
        avatarInitials: "BP", basicRate: "99000.00", startDate: "2026-01-01",
      },
    ]).returning();

    const [alphaFlow, betaFlow] = await db.insert(hcmBusinessProcessInstances).values([
      {
        organizationId: alpha.id, employeeId: alphaWorker.id,
        definitionCode: "home-synthetic", definitionVersion: 1,
        processType: "transfer", sourceType: "home-qa",
        sourceKey: "alpha-" + code, definitionSnapshot: { code: "home-qa", steps: [] },
        initiatedByName: "Synthetic Maker", status: "in_progress",
      },
      {
        organizationId: beta.id, employeeId: betaWorker.id,
        definitionCode: "home-synthetic", definitionVersion: 1,
        processType: "hire", sourceType: "home-qa",
        sourceKey: "beta-" + code, definitionSnapshot: { code: "home-qa", steps: [] },
        initiatedByName: "Synthetic Maker", status: "in_progress",
      },
    ]).returning();

    const [alphaStep, betaStep] = await db.insert(hcmBusinessProcessInstanceSteps).values([
      {
        organizationId: alpha.id, instanceId: alphaFlow.id,
        stepIndex: 0, stepType: "approval", label: "AlphaPrivate only",
        assignee: "role:hr", status: "pending",
      },
      {
        organizationId: beta.id, instanceId: betaFlow.id,
        stepIndex: 0, stepType: "approval", label: "BetaPrivate only",
        assignee: "role:hr", status: "pending",
      },
    ]).returning();

    await db.insert(provisioningTasks).values([
      {
        organizationId: alpha.id, employeeId: alphaWorker.id,
        kind: "onboarding", title: "AlphaPrivate enrollment", done: false,
      },
      {
        organizationId: beta.id, employeeId: betaWorker.id,
        kind: "onboarding", title: "BetaPrivate enrollment", done: false,
      },
    ]);
    const [alphaCase, betaCase] = await db.insert(automationOperationalCases).values([
      {
        organizationId: alpha.id, caseType: "coverage_recovery",
        sourceType: "home-qa", sourceId: alphaWorker.id,
        ownerTeam: "HR Operations", assignedOwnerUserId: actor.id,
        title: "AlphaPrivate case", detail: "AlphaPrivate case detail", status: "open",
      },
      {
        organizationId: beta.id, caseType: "coverage_recovery",
        sourceType: "home-qa", sourceId: betaWorker.id,
        ownerTeam: "HR Operations", assignedOwnerUserId: actor.id,
        title: "BetaPrivate case", detail: "BetaPrivate case detail", status: "open",
      },
    ]).returning();

    process.env.HCM_PEOPLE_HOME_ENABLED = "true";
    process.env.NEXT_PUBLIC_HCM_PEOPLE_HOME_ENABLED = "true";
    process.env.HCM_PEOPLE_HOME_ORG_IDS = [alpha.id, beta.id].join(",");

    const context = { id: actor.id, name: actor.name };
    const own = await loadPeopleHomeWorklist(alpha.id, context);
    assert.deepEqual(own.decisions.items.map((item) => item.sourceId), [alphaStep.id]);
    assert.ok(own.followUps.items.some((item) => item.source === "provisioning"));
    const alphaHandoff = own.followUps.items.find((item) => item.source === "provisioning");
    assert.equal(alphaHandoff?.subjectEmployeeId, alphaWorker.id);
    assert.equal(alphaHandoff?.sourceUrl,
      "/app?organizationId=" + alpha.id + "&workspacePage=People&focusEmployeeId=" + alphaWorker.id);
    assert.ok(!alphaHandoff?.sourceUrl.includes("focusEmployeeId=" + betaWorker.id));
    assert.deepEqual(own.ownedCases.items.map((item) => item.sourceId), [alphaCase.id]);
    assert.ok(Object.values(own).every((section) =>
      section.items.every((item) => item.tenantId === alpha.id)));
    assert.ok(!JSON.stringify(own).includes("AlphaPrivate"), "Personal details must be minimized");
    assert.ok(!JSON.stringify(own).includes("BetaPrivate"), "Foreign employer details must not leak");
    assert.ok(!JSON.stringify(own).includes("99000.00"), "Private payroll data must not appear");

    // Reproduce the bounded-preview starvation bug: other-role assignments
    // previously filled the first 30 tenant-wide rows before actor filtering.
    // The final HR and identity-assigned steps must remain visible.
    const [crowdedFlow] = await db.insert(hcmBusinessProcessInstances).values({
      organizationId: alpha.id, employeeId: alphaWorker.id,
      definitionCode: "home-synthetic", definitionVersion: 1,
      processType: "transfer", sourceType: "home-qa",
      sourceKey: "crowded-" + code, definitionSnapshot: { code: "home-qa", steps: [] },
      initiatedByName: "Synthetic Maker", status: "in_progress",
    }).returning();
    const crowdedSteps = await db.insert(hcmBusinessProcessInstanceSteps).values([
      ...Array.from({ length: 31 }, (_, stepIndex) => ({
        organizationId: alpha.id, instanceId: crowdedFlow.id,
        stepIndex, stepType: "approval" as const,
        label: "Finance-only decoy " + stepIndex,
        assignee: "role:finance", status: "pending" as const,
      })),
      {
        organizationId: alpha.id, instanceId: crowdedFlow.id,
        stepIndex: 31, stepType: "approval" as const,
        label: "Late HR decision", assignee: "ROLE:HR", status: "pending" as const,
      },
      {
        organizationId: alpha.id, instanceId: crowdedFlow.id,
        stepIndex: 32, stepType: "review" as const,
        label: "Late named decision", assignee: actor.name.toUpperCase(), status: "pending" as const,
      },
    ]).returning();
    const hrTarget = crowdedSteps[31];
    const namedTarget = crowdedSteps[32];
    const crowded = await loadPeopleHomeWorklist(alpha.id, context);
    assert.deepEqual(crowded.decisions.items.map((item) => item.sourceId),
      [alphaStep.id, hrTarget.id, namedTarget.id],
      "The role- and name-assigned steps must not be hidden behind 31 other-role steps");
    assert.equal(crowded.decisions.hasMore, false,
      "Only eligible rows may contribute to the bounded preview's hasMore flag");
    assert.equal(crowded.decisions.partial, false);
    assert.ok(crowded.decisions.items.every((item) => item.tenantId === alpha.id));
    await db.delete(hcmBusinessProcessInstanceSteps)
      .where(inArray(hcmBusinessProcessInstanceSteps.id, crowdedSteps.map((item) => item.id)));
    await db.delete(hcmBusinessProcessInstances)
      .where(eq(hcmBusinessProcessInstances.id, crowdedFlow.id));

    // A deny-only custom permission overlay must override an otherwise
    // valid company-wide HR role. It cannot grant People administration.
    const [restricted] = await db.insert(permissionSets).values({
      organizationId: alpha.id, name: "No People Home " + code,
      permissions: ["payroll.view"], active: true,
    }).returning();
    const [assignment] = await db.insert(userPermissionAssignments).values({
      organizationId: alpha.id,
      userOrganizationId: alphaMembership.id,
      permissionSetId: restricted.id,
    }).returning();
    await assert.rejects(loadPeopleHomeWorklist(alpha.id, context), /not authorized/i);
    await db.delete(userPermissionAssignments).where(eq(userPermissionAssignments.id, assignment.id));

    // No membership in Beta.
    await assert.rejects(loadPeopleHomeWorklist(beta.id, context), /not authorized/i);

    const [betaMembership] = await db.insert(userOrganizations).values({
      userId: actor.id, organizationId: beta.id, role: "employee", active: true,
    }).returning();
    await assert.rejects(loadPeopleHomeWorklist(beta.id, context), /not authorized/i);
    for (const deniedRole of ["payroll", "manager"]) {
      await db.update(userOrganizations).set({ role: deniedRole })
        .where(eq(userOrganizations.id, betaMembership.id));
      await assert.rejects(loadPeopleHomeWorklist(beta.id, context), /not authorized/i);
    }

    const [betaUnit] = await db.insert(orgUnits).values({
      organizationId: beta.id, code: "SYN-" + code,
      name: "Beta scoped HR", type: "department",
    }).returning();
    await db.update(userOrganizations).set({ role: "hr", orgUnitId: betaUnit.id })
      .where(eq(userOrganizations.id, betaMembership.id));
    await assert.rejects(loadPeopleHomeWorklist(beta.id, context), /not authorized/i);

    await db.update(userOrganizations).set({ orgUnitId: null })
      .where(eq(userOrganizations.id, betaMembership.id));
    const other = await loadPeopleHomeWorklist(beta.id, context);
    assert.deepEqual(other.decisions.items.map((item) => item.sourceId), [betaStep.id]);
    const betaHandoff = other.followUps.items.find((item) => item.source === "provisioning");
    assert.equal(betaHandoff?.subjectEmployeeId, betaWorker.id);
    assert.equal(betaHandoff?.sourceUrl,
      "/app?organizationId=" + beta.id + "&workspacePage=People&focusEmployeeId=" + betaWorker.id);
    assert.ok(!betaHandoff?.sourceUrl.includes("focusEmployeeId=" + alphaWorker.id));
    assert.deepEqual(other.ownedCases.items.map((item) => item.sourceId), [betaCase.id]);
    assert.ok(Object.values(other).every((section) =>
      section.items.every((item) => item.tenantId === beta.id)));
    assert.ok(!JSON.stringify(other).includes("AlphaPrivate"));

    // Membership revocation takes effect for a fresh read even when the
    // same signed-in actor remains a valid People admin for another employer.
    // Never reuse Alpha's previously authorized worklist for a revoked tenant.
    await db.update(userOrganizations).set({ active: false })
      .where(eq(userOrganizations.id, alphaMembership.id));
    await assert.rejects(loadPeopleHomeWorklist(alpha.id, context), /not authorized/i,
      "Revoking Alpha membership must block a formerly successful worklist read");
    const betaAfterRevocation = await loadPeopleHomeWorklist(beta.id, context);
    assert.deepEqual(betaAfterRevocation.decisions.items.map((item) => item.sourceId),
      [betaStep.id], "Revocation in Alpha cannot suppress Beta's authorized worklist");
    assert.deepEqual(betaAfterRevocation.ownedCases.items.map((item) => item.sourceId),
      [betaCase.id], "Revoking Alpha cannot suppress Beta's authorized cases");
    assert.deepEqual(betaAfterRevocation.followUps.items
      .filter((item) => item.source === "provisioning")
      .map((item) => item.subjectEmployeeId), [betaWorker.id],
      "Beta provisioning stays scoped to Beta after Alpha membership is revoked");
    assert.ok(Object.values(betaAfterRevocation).every((section) =>
      section.items.every((item) => item.tenantId === beta.id)),
      "Every Beta source remains employer-bound after Alpha revocation");
    assert.ok(!JSON.stringify(betaAfterRevocation).includes("AlphaPrivate"),
      "Beta after the Alpha downgrade must not carry stale Alpha records");
    await db.update(userOrganizations).set({ active: true })
      .where(eq(userOrganizations.id, alphaMembership.id));
    const alphaAfterRestoration = await loadPeopleHomeWorklist(alpha.id, context);
    assert.deepEqual(alphaAfterRestoration.decisions.items.map((item) => item.sourceId),
      [alphaStep.id], "Active membership restoration must still honor exact employer binding");
    assert.deepEqual(alphaAfterRestoration.ownedCases.items.map((item) => item.sourceId),
      [alphaCase.id], "Restoration returns only Alpha's authorized cases");
    assert.deepEqual(alphaAfterRestoration.followUps.items
      .filter((item) => item.source === "provisioning")
      .map((item) => item.subjectEmployeeId), [alphaWorker.id],
      "Restoration returns only Alpha's authorized provisioning");
    assert.ok(Object.values(alphaAfterRestoration).every((section) =>
      section.items.every((item) => item.tenantId === alpha.id)),
      "Every restored Alpha source must remain employer-bound");
    assert.ok(!JSON.stringify(alphaAfterRestoration).includes("BetaPrivate"),
      "Restored Alpha access must never include private Beta records");

    process.env.HCM_PEOPLE_HOME_ENABLED = "false";
    await assert.rejects(loadPeopleHomeWorklist(alpha.id, context), /pilot is disabled/);
  } finally {
    if (oldFlags.server === undefined) delete process.env.HCM_PEOPLE_HOME_ENABLED;
    else process.env.HCM_PEOPLE_HOME_ENABLED = oldFlags.server;
    if (oldFlags.public === undefined) delete process.env.NEXT_PUBLIC_HCM_PEOPLE_HOME_ENABLED;
    else process.env.NEXT_PUBLIC_HCM_PEOPLE_HOME_ENABLED = oldFlags.public;
    if (oldFlags.tenants === undefined) delete process.env.HCM_PEOPLE_HOME_ORG_IDS;
    else process.env.HCM_PEOPLE_HOME_ORG_IDS = oldFlags.tenants;
    if (actorId) await db.delete(users).where(eq(users.id, actorId));
    await db.delete(organizations).where(inArray(organizations.id, [alpha.id, beta.id]));
  }
});
