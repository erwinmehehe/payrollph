import assert from "node:assert/strict";
import { and, eq } from "drizzle-orm";
import { db } from "../src/db";
import { employees, organizations, userOrganizations, users } from "../src/db/schema";

/**
 * A-3 HR-case acceptance ONLY. Augments existing fictional employees in the
 * disposable HRIS browser-acceptance DB without changing frozen HCM fixtures.
 * No payroll decision, filing, user credentials, or real-employer data.
 */
async function main() {
  assert.equal(process.env.CI, "true");
  assert.equal(process.env.HRIS_JOURNEY_ACCEPTANCE_MODE, "synthetic-postgres-only");
  assert.equal(process.env.HCM_PEOPLE_HOME_ACCEPTANCE_MODE, "synthetic-postgres-only");
  assert.equal(process.env.EMPLOYEE_HR_CASES_ENABLED, "true");
  assert.equal(process.env.OPENAI_API_KEY ?? "", "");
  const url = new URL(process.env.DATABASE_URL ?? "");
  assert.ok(["localhost", "127.0.0.1"].includes(url.hostname));
  assert.equal(url.pathname, "/app_db");

  const orgs = await db.select({ id: organizations.id }).from(organizations);
  assert.deepEqual(orgs.map(row => row.id).sort((a, b) => a - b), [1, 2, 3],
    "Refuse any other source DB: third synthetic employer is a populated, unauthorized victim");

  const [worker] = await db.select({ id: employees.id }).from(employees).where(and(
    eq(employees.organizationId, 1),
    eq(employees.employeeNo, "SHARED-001"),
  )).limit(1);
  const [user] = await db.select({
    id: users.id, role: users.role, employeeId: users.employeeId,
  }).from(users).where(eq(users.email, "hcm-employee@example.test")).limit(1);
  assert.ok(worker && user && user.role === "employee",
    "The expected fictional worker and employee account must exist");
  assert.ok(user.employeeId == null || user.employeeId === worker.id,
    "Refuse to overwrite a different employee identity");

  const [membership] = await db.select({ id: userOrganizations.id })
    .from(userOrganizations).where(and(
      eq(userOrganizations.userId, user.id),
      eq(userOrganizations.organizationId, 1),
      eq(userOrganizations.active, true),
      eq(userOrganizations.role, "employee"),
    )).limit(1);
  assert.ok(membership, "Employee login must have active membership only for the fixture employer");
  const [victimMembership] = await db.select({ id: userOrganizations.id })
    .from(userOrganizations).where(and(
      eq(userOrganizations.userId, user.id), eq(userOrganizations.organizationId, 3),
    )).limit(1);
  assert.equal(victimMembership, undefined,
    "The ESS actor must never acquire a membership for the seeded victim-only employer");

  await db.update(users).set({ employeeId: worker.id }).where(and(
    eq(users.id, user.id), eq(users.role, "employee"),
  ));
  const [bound] = await db.select({ employeeId: users.employeeId })
    .from(users).where(eq(users.id, user.id)).limit(1);
  assert.equal(bound?.employeeId, worker.id);
  console.log(JSON.stringify({
    result: "A3_FICTIONAL_ESS_LINK_VERIFIED",
    mode: "synthetic-postgres-only",
    organizationId: 1,
    secondEmployerUnchanged: true,
    liveDataAccessed: false,
    fundsAffected: false,
  }));
}

main().catch(error => {
  console.error("A-3 synthetic-only identity setup failed: " +
    (error instanceof Error ? error.message : String(error)));
  process.exitCode = 1;
});
