import assert from "node:assert/strict";
import { db } from "../src/db";
import { hashPassword } from "../src/lib/crypto";
import {
  employees,
  hcmBusinessProcessInstances,
  hcmBusinessProcessInstanceSteps,
  orgUnits,
  organizations,
  subscriptions,
  permissionSets,
  userOrganizations,
  userPermissionAssignments,
  users,
} from "../src/db/schema";

async function main() {
  assert.equal(process.env.CI, "true");
  assert.equal(process.env.HCM_MONITOR_ACCEPTANCE_MODE, "synthetic-postgres-only");
  const dbUrl = new URL(process.env.DATABASE_URL ?? "");
  assert.ok(["localhost", "127.0.0.1"].includes(dbUrl.hostname));
  assert.equal(dbUrl.pathname, "/app_db");
  assert.equal(process.env.HCM_PROCESS_MONITOR_ORG_IDS, "1,2");
  assert.equal(process.env.HCM_PROCESS_MONITOR_ENABLED, "true");
  assert.equal(process.env.OPENAI_API_KEY ?? "", "");

  const [alpha, beta] = await db.insert(organizations).values([
    { name: "Monitor Fictional Alpha", legalName: "Monitor Fictional Alpha", plan: "Enterprise", accountType: "enterprise" },
    { name: "Monitor Fictional Beta", legalName: "Monitor Fictional Beta", plan: "Core" },
  ]).returning();
  assert.deepEqual([alpha.id, beta.id], [1, 2], "Must be an empty CI database");

  // The separate opt-in HTTP browser instance must prove real billing
  // enforcement, not rely on the Enterprise account-type fallback.
  await db.insert(subscriptions).values([
    { organizationId: alpha.id, plan: "Enterprise", status: "active", seatLimit: 100 },
    { organizationId: beta.id, plan: "Core", status: "active", seatLimit: 10 },
  ]);

  const [worker] = await db.insert(employees).values({
    organizationId: alpha.id, employeeNo: "MON-SYNTH-001",
    firstName: "Fictional", lastName: "Employee",
    title: "Research Associate", avatarInitials: "FE",
    basicRate: "30000.00", startDate: "2026-01-01",
  }).returning();
  assert.equal(worker.id, 1, "Worker 360 QA must use only a fresh synthetic DB");
  // Same employee number in BOTH employers catches stale tenant selection
  // during actual Chromium Planning/Compensation requests. IDs remain distinct
  // as required by the relational primary key.
  const [betaWorker] = await db.insert(employees).values({
    organizationId: beta.id, employeeNo: "MON-SYNTH-001",
    firstName: "TenantBetaOnly", lastName: "Employee",
    title: "Support Associate", avatarInitials: "TB",
    basicRate: "70000.00", startDate: "2026-01-01",
  }).returning();
  assert.equal(betaWorker.id, 2, "A second fictional worker must be tenant-scoped");
  assert.equal(betaWorker.employeeNo, worker.employeeNo);


  const passwordHash = hashPassword("Synthetic-HCM-Monitor-Only-2026!");
  const [hr, manager, payroll, checker, employee, scoped, denied, bookkeeper] =
    await db.insert(users).values([
      { email: "monitor-hr@example.test", name: "Fictional HR", passwordHash, role: "hr" },
      { email: "monitor-manager@example.test", name: "Fictional Manager", passwordHash, role: "manager" },
      { email: "monitor-payroll@example.test", name: "Fictional Payroll", passwordHash, role: "payroll" },
      { email: "monitor-checker@example.test", name: "Fictional Checker", passwordHash, role: "checker" },
      { email: "monitor-employee@example.test", name: "Fictional Employee", passwordHash, role: "employee" },
      { email: "monitor-unit-hr@example.test", name: "Fictional Scoped HR", passwordHash, role: "hr" },
      { email: "monitor-denied-hr@example.test", name: "Fictional Denied HR", passwordHash, role: "hr" },
      { email: "monitor-bookkeeper@example.test", name: "Fictional Bookkeeper", passwordHash, role: "bookkeeper" },
    ]).returning();

  const [unit] = await db.insert(orgUnits).values({
    organizationId: alpha.id, code: "MON-UNIT", name: "Scoped Unit", type: "department",
  }).returning();
  const membership = await db.insert(userOrganizations).values([
    { userId: hr.id, organizationId: alpha.id, role: "hr", active: true },
    { userId: hr.id, organizationId: beta.id, role: "hr", active: true },
    { userId: manager.id, organizationId: alpha.id, role: "manager", active: true },
    { userId: payroll.id, organizationId: alpha.id, role: "payroll", active: true },
    { userId: checker.id, organizationId: alpha.id, role: "checker", active: true },
    { userId: employee.id, organizationId: alpha.id, role: "employee", active: true },
    { userId: scoped.id, organizationId: alpha.id, role: "hr", orgUnitId: unit.id, active: true },
    { userId: denied.id, organizationId: alpha.id, role: "hr", active: true },
    { userId: bookkeeper.id, organizationId: alpha.id, role: "bookkeeper", active: true },
  ]).returning();

  const restricted = membership.find((row) => row.userId === denied.id);
  assert.ok(restricted);
  const [permissionSet] = await db.insert(permissionSets).values({
    organizationId: alpha.id, name: "No HCM monitor permission",
    permissions: ["payroll.view"], active: true,
  }).returning();
  await db.insert(userPermissionAssignments).values({
    organizationId: alpha.id,
    userOrganizationId: restricted.id,
    permissionSetId: permissionSet.id,
  });

  const rows = await db.insert(hcmBusinessProcessInstances).values(
    Array.from({ length: 23 }, (_, index) => ({
      organizationId: alpha.id,
      definitionCode: "fictional-monitor", definitionVersion: 1,
      processType: index === 1 ? "hire" : "transfer",
      sourceType: "fictional_test",
      sourceKey: "fictional-alpha-" + index,
      definitionSnapshot: { privateNotes: "AlphaPrivate test data" },
      initiatedByName: "AlphaPrivate actor",
      status: index === 1 ? "approved" : "in_progress",
      effectiveDate: "2026-10-15",
    })),
  ).returning();
  const [betaRow] = await db.insert(hcmBusinessProcessInstances).values({
    organizationId: beta.id,
    definitionCode: "fictional-monitor", definitionVersion: 1,
    processType: "termination", sourceType: "fictional_test",
    sourceKey: "fictional-beta",
    definitionSnapshot: { privateNotes: "BetaPrivate test data" },
    initiatedByName: "BetaPrivate actor", status: "failed",
  }).returning();
  await db.insert(hcmBusinessProcessInstanceSteps).values([
    {
      organizationId: alpha.id, instanceId: rows[22].id, stepIndex: 0,
      stepType: "approval", status: "pending", label: "AlphaPrivate approval",
      assignee: "role:hr", decisionNote: "AlphaPrivate salary detail",
      dueAt: new Date("2026-10-10T00:00:00Z"),
    },
    {
      organizationId: alpha.id, instanceId: rows[22].id, stepIndex: 1,
      stepType: "review", status: "waiting", label: "AlphaPrivate review",
      assignee: "AlphaPrivate actor", decisionNote: "AlphaPrivate notes",
    },
    {
      organizationId: beta.id, instanceId: betaRow.id, stepIndex: 0,
      stepType: "approval", status: "pending", label: "BetaPrivate approval",
      assignee: "role:hr", decisionNote: "BetaPrivate salary detail",
      dueAt: new Date("2026-10-10T00:00:00Z"),
    },
  ]);
  console.log("Synthetic two-employer HCM process monitor fixture seeded in disposable localhost database.");
}

main().catch((error) => {
  console.error("Synthetic monitor fixture failure:",
    error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
