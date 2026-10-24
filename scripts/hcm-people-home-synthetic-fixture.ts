import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { db } from "../src/db";
import { hashPassword } from "../src/lib/crypto";
import {
  automationOperationalCases, employeePayProfiles, employees, hcmBusinessProcessInstances,
  hcmBusinessProcessInstanceSteps, orgUnits, organizations, permissionSets,
  provisioningTasks, userOrganizations, userPermissionAssignments, users,
} from "../src/db/schema";

/** Isolated, disposable CI database fixture. Never run against a deployed app. */
async function main() {
  assert.equal(process.env.CI, "true");
  assert.equal(process.env.HCM_PEOPLE_HOME_ACCEPTANCE_MODE, "synthetic-postgres-only");
  const dbUrl = new URL(process.env.DATABASE_URL ?? "");
  assert.ok(["localhost", "127.0.0.1"].includes(dbUrl.hostname) && dbUrl.pathname === "/app_db");
  assert.equal(process.env.HCM_PEOPLE_HOME_ORG_IDS, "1,2");
  assert.equal(process.env.OPENAI_API_KEY ?? "", "");

  const [alpha, beta] = await db.insert(organizations).values([
    { name: "Synthetic Alpha Employer", legalName: "Synthetic Alpha Employer", plan: "Core" },
    { name: "Synthetic Beta Employer", legalName: "Synthetic Beta Employer", plan: "Core" },
  ]).returning();
  assert.deepEqual([alpha.id, beta.id], [1, 2], "CI database must be empty");
  const passwordHash = hashPassword("Synthetic-HCM-QA-Password-Only-2026!");
  const [hr, restricted, payroll, manager, unitHr, checker, employee] = await db.insert(users).values([
    { email: "hcm-hr@example.test", name: "Synthetic HR", passwordHash, role: "hr" },
    { email: "hcm-denied@example.test", name: "Synthetic Restricted HR", passwordHash, role: "hr" },
    { email: "hcm-payroll@example.test", name: "Synthetic Payroll", passwordHash, role: "payroll" },
    { email: "hcm-manager@example.test", name: "Synthetic Manager", passwordHash, role: "manager" },
    { email: "hcm-unit@example.test", name: "Synthetic Unit HR", passwordHash, role: "hr" },
    { email: "hcm-checker@example.test", name: "Synthetic Checker", passwordHash, role: "checker" },
    { email: "hcm-employee@example.test", name: "Synthetic Employee", passwordHash, role: "employee" },
  ]).returning();
  const [unit] = await db.insert(orgUnits).values({
    organizationId: alpha.id, code: "HCM-QA-BRANCH", name: "Synthetic Branch", type: "department",
  }).returning();
  const memberships = await db.insert(userOrganizations).values([
    { userId: hr.id, organizationId: alpha.id, role: "hr", active: true },
    { userId: hr.id, organizationId: beta.id, role: "hr", active: true },
    { userId: restricted.id, organizationId: alpha.id, role: "hr", active: true },
    { userId: payroll.id, organizationId: alpha.id, role: "payroll", active: true },
    { userId: manager.id, organizationId: alpha.id, role: "manager", active: true },
    { userId: unitHr.id, organizationId: alpha.id, role: "hr", orgUnitId: unit.id, active: true },
    { userId: checker.id, organizationId: alpha.id, role: "checker", active: true },
    { userId: employee.id, organizationId: alpha.id, role: "employee", active: true },
  ]).returning();
  const restrictedMembership = memberships.find((row) => row.userId === restricted.id);
  assert.ok(restrictedMembership);
  const [deny] = await db.insert(permissionSets).values({
    organizationId: alpha.id, name: "Synthetic deny People",
    permissions: ["payroll.view"], active: true,
  }).returning();
  await db.insert(userPermissionAssignments).values({
    organizationId: alpha.id, userOrganizationId: restrictedMembership.id, permissionSetId: deny.id,
  });
  const [alphaWorker, betaWorker, betaSecond] = await db.insert(employees).values([
    {
      organizationId: alpha.id, employeeNo: "SHARED-001", firstName: "AlphaPrivate",
      lastName: "Worker", avatarInitials: "AP", title: "Staff",
      basicRate: "10000.00", startDate: "2026-01-01",
    },
    {
      organizationId: beta.id, employeeNo: "SHARED-001", firstName: "BetaPrivate",
      lastName: "Worker", avatarInitials: "BP", title: "Staff",
      basicRate: "99000.00", startDate: "2026-01-01",
    },
    {
      organizationId: beta.id, employeeNo: "BETA-002", firstName: "BetaSecond",
      lastName: "Worker", avatarInitials: "BS", title: "Staff",
      basicRate: "88000.00", startDate: "2026-01-01",
    },
  ]).returning();
  // The app's request path is intentionally READ-ONLY and rejects missing
  // pay profiles. Seed exactly this synthetic roster before browser acceptance;
  // never repair an employer's payroll data during request handling.
  assert.deepEqual(
    [alphaWorker, betaWorker, betaSecond].map(worker => worker.organizationId),
    [alpha.id, beta.id, beta.id],
    "HCM QA pay-profile roster must contain two employers only",
  );
  const seededRoster = await db.select({
    id: employees.id, organizationId: employees.organizationId,
    employeeNo: employees.employeeNo, basicRate: employees.basicRate,
  }).from(employees);
  const expectedRoster = new Map([
    ["SHARED-001:" + alpha.id, "10000.00"],
    ["SHARED-001:" + beta.id, "99000.00"],
    ["BETA-002:" + beta.id, "88000.00"],
  ]);
  assert.equal(seededRoster.length, expectedRoster.size, "HCM fixture must own exactly 3 synthetic employees");
  const explicitProfiles = seededRoster.map(worker => {
    const pay = expectedRoster.get(worker.employeeNo + ":" + worker.organizationId);
    assert.ok(pay && worker.basicRate === pay,
      "HCM_QA_PAY_PROFILE_ROSTER_UNVERIFIED");
    return {
      organizationId: worker.organizationId, employeeId: worker.id,
      payBasis: "monthly" as const, rateAmount: pay,
      standardWorkDaysPerMonth: "22", standardHoursPerDay: "8",
    };
  });
  await db.insert(employeePayProfiles).values(explicitProfiles);

  // Only the isolated vault browser acceptance needs a linked ESS worker.
  // Do not change the general HRIS synthetic fixture's account assumptions.
  if (process.env.EMPLOYEE_VAULT_BROWSER_ACCEPTANCE_MODE === "synthetic-postgres-only") {
    await db.update(users).set({ employeeId: alphaWorker.id })
      .where(eq(users.id, employee.id));
  }
  const processes = await db.insert(hcmBusinessProcessInstances).values([
    {
      organizationId: alpha.id, employeeId: alphaWorker.id,
      definitionCode: "synthetic", definitionVersion: 1,
      processType: "transfer", sourceType: "qa",
      sourceKey: "alpha-hcm-qa", definitionSnapshot: { code: "synthetic", steps: [] },
      initiatedByName: "Synthetic Maker", status: "in_progress",
    },
    {
      organizationId: beta.id, employeeId: betaWorker.id,
      definitionCode: "synthetic", definitionVersion: 1,
      processType: "hire", sourceType: "qa",
      sourceKey: "beta-hcm-qa", definitionSnapshot: { code: "synthetic", steps: [] },
      initiatedByName: "Synthetic Maker", status: "in_progress",
    },
  ]).returning();
  await db.insert(hcmBusinessProcessInstanceSteps).values([
    {
      organizationId: alpha.id, instanceId: processes[0].id, stepIndex: 0,
      stepType: "approval", label: "AlphaPrivate step", assignee: "role:hr",
      status: "pending",
    },
    {
      organizationId: beta.id, instanceId: processes[1].id, stepIndex: 0,
      stepType: "approval", label: "BetaPrivate step", assignee: "role:hr",
      status: "pending",
    },
  ]);
  await db.insert(provisioningTasks).values([
    {
      organizationId: alpha.id, employeeId: alphaWorker.id, kind: "onboarding",
      title: "AlphaPrivate note", done: false,
    },
    {
      organizationId: beta.id, employeeId: betaWorker.id, kind: "offboarding",
      title: "BetaPrivate note", done: false,
    },
  ]);
  await db.insert(automationOperationalCases).values([
    {
      organizationId: alpha.id, caseType: "coverage_recovery", sourceType: "qa",
      sourceId: alphaWorker.id, ownerTeam: "HR Operations",
      assignedOwnerUserId: hr.id, title: "AlphaPrivate title",
      detail: "AlphaPrivate case detail", status: "open",
    },
    {
      organizationId: beta.id, caseType: "coverage_recovery", sourceType: "qa",
      sourceId: betaWorker.id, ownerTeam: "HR Operations",
      assignedOwnerUserId: hr.id, title: "BetaPrivate title",
      detail: "BetaPrivate case detail", status: "open",
    },
  ]);
  console.log("Two synthetic employer fixtures created in a disposable CI database.");
}
main().catch((error) => {
  console.error("Synthetic fixture failed: " + (error instanceof Error ? error.message : String(error)));
  process.exitCode = 1;
});
