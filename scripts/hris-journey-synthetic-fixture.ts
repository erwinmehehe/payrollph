import assert from "node:assert/strict";
import { and, eq } from "drizzle-orm";
import { db } from "../src/db";
import { hashPassword } from "../src/lib/crypto";
import {
  approvalTasks, employees, orgUnits, organizations, userOrganizations, users,
} from "../src/db/schema";

/**
 * Augments the existing disposable HCM People Home fixture with a valid unit
 * manager, one unitless manager, and non-financial approval tasks. This script
 * refuses to touch any deployed or non-local database.
 */
async function main() {
  assert.equal(process.env.CI, "true");
  assert.equal(process.env.HRIS_JOURNEY_ACCEPTANCE_MODE, "synthetic-postgres-only");
  assert.equal(process.env.HCM_PEOPLE_HOME_ACCEPTANCE_MODE, "synthetic-postgres-only");
  assert.equal(process.env.OPENAI_API_KEY ?? "", "");
  const address = new URL(process.env.DATABASE_URL ?? "");
  assert.ok(["127.0.0.1", "localhost"].includes(address.hostname));
  assert.equal(address.pathname, "/app_db");

  const orgs = await db.select({ id: organizations.id }).from(organizations);
  assert.deepEqual(orgs.map(row => row.id).sort((a, b) => a - b), [1, 2, 3],
    "Expected exactly two authorized employers and a seeded, victim-only third employer");

  const [unit] = await db.select().from(orgUnits).where(and(
    eq(orgUnits.organizationId, 1), eq(orgUnits.code, "HCM-QA-BRANCH"),
  )).limit(1);
  const [worker] = await db.select().from(employees).where(and(
    eq(employees.organizationId, 1), eq(employees.employeeNo, "SHARED-001"),
  )).limit(1);
  const [manager] = await db.select({ id: users.id }).from(users)
    .where(eq(users.email, "hcm-manager@example.test")).limit(1);
  assert.ok(unit && worker && manager, "Disposable HCM fixture is incomplete.");

  await db.update(userOrganizations).set({ orgUnitId: unit.id }).where(and(
    eq(userOrganizations.userId, manager.id),
    eq(userOrganizations.organizationId, 1),
  ));
  await db.update(employees).set({ orgUnitId: unit.id }).where(and(
    eq(employees.id, worker.id), eq(employees.organizationId, 1),
  ));

  const [unitless] = await db.insert(users).values({
    email: "hris-unitless@example.test",
    name: "Synthetic Unassigned Manager",
    passwordHash: hashPassword("Synthetic-HCM-QA-Password-Only-2026!"),
    role: "manager",
  }).returning();
  await db.insert(userOrganizations).values({
    userId: unitless.id, organizationId: 1, role: "manager",
    orgUnitId: null, active: true,
  });

  const tasks = await db.insert(approvalTasks).values([
    {
      organizationId: 1, title: "Synthetic manager HR review",
      detail: "Non-financial synthetic manager decision.",
      approver: "role:manager", dueLabel: "No due date", priority: "Normal",
      status: "Pending",
    },
    {
      organizationId: 2, title: "BetaPrivate approval",
      detail: "Confidential second-employer fixture.",
      approver: "role:manager", dueLabel: "No due date", priority: "Normal",
      status: "Pending",
    },
    // #1114: separate fictional approval per real mobile viewport. The
    // existing desktop manager check remains unchanged and independent.
    ...[375, 390].map(width => ({
      organizationId: 1, title: "Synthetic phone checker approval " + width,
      detail: "Non-financial, assigned-only Checker mobile approval proof.",
      approver: "Synthetic Checker", dueLabel: "No due date", priority: "Normal",
      status: "Pending",
    })),
    {
      organizationId: 1, title: "Synthetic unassigned HR approval",
      detail: "Manager may neither see nor decide this HR-only task.",
      approver: "role:hr", dueLabel: "No due date", priority: "Normal",
      status: "Pending",
    },
    {
      organizationId: 2, title: "BetaPrivate HR-only approval",
      detail: "Fictional second-employer visibility canary.",
      approver: "role:hr", dueLabel: "No due date", priority: "Normal",
      status: "Pending",
    },
  ]).returning();
  assert.equal(tasks.length, 6);
  console.log(JSON.stringify({
    result: "SEEDED", mode: "synthetic-postgres-only",
    organizations: [1, 2, 3], victimEmployerOnly: 3, activeManagerUnit: unit.id,
    managerDecisionTaskId: tasks[0].id,
    liveEmployerDataAccessed: false, fundsAffected: false,
  }));
}
main().catch((error) => {
  console.error("Disposable HRIS fixture failed: " +
    (error instanceof Error ? error.message : String(error)));
  process.exitCode = 1;
});
