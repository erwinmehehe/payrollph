import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../src/db";
import { employees, leaveRequests, orgUnits, organizations } from "../src/db/schema";

/**
 * Synthetic PostgreSQL proof for the same organization/worker/unit predicates
 * used by GET /api/leave. This does not bypass the route's session/role gate.
 * It checks SQL results, whereas the source guards pin actual route wiring.
 */
test("leave SQL returns only the selected employer and authorized team/worker", async () => {
  const suffix = randomUUID().slice(0, 10);
  const [alpha, beta] = await db.insert(organizations).values([
    { name: "Leave-scope Alpha " + suffix, legalName: "Leave-scope Alpha " + suffix },
    { name: "Leave-scope Beta " + suffix, legalName: "Leave-scope Beta " + suffix },
  ]).returning();

  try {
    const [alphaUnitOne, alphaUnitTwo, betaUnit] = await db.insert(orgUnits).values([
      { organizationId: alpha.id, code: "LA1-" + suffix, name: "Alpha First", type: "department" },
      { organizationId: alpha.id, code: "LA2-" + suffix, name: "Alpha Second", type: "department" },
      { organizationId: beta.id, code: "LB1-" + suffix, name: "Beta First", type: "department" },
    ]).returning();
    const [alphaOne, alphaTwo, alphaThree, betaOne] = await db.insert(employees).values([
      {
        organizationId: alpha.id, orgUnitId: alphaUnitOne.id,
        employeeNo: "LA-" + suffix + "-1", firstName: "AlphaOne",
        lastName: "Fixture", title: "Staff", avatarInitials: "A1",
        basicRate: "20000.00", startDate: "2026-01-01",
      },
      {
        organizationId: alpha.id, orgUnitId: alphaUnitOne.id,
        employeeNo: "LA-" + suffix + "-2", firstName: "AlphaTwo",
        lastName: "Fixture", title: "Staff", avatarInitials: "A2",
        basicRate: "20000.00", startDate: "2026-01-01",
      },
      {
        organizationId: alpha.id, orgUnitId: alphaUnitTwo.id,
        employeeNo: "LA-" + suffix + "-3", firstName: "AlphaOtherUnit",
        lastName: "Fixture", title: "Staff", avatarInitials: "A3",
        basicRate: "20000.00", startDate: "2026-01-01",
      },
      {
        organizationId: beta.id, orgUnitId: betaUnit.id,
        employeeNo: "LB-" + suffix + "-1", firstName: "BetaPrivate",
        lastName: "Fixture", title: "Staff", avatarInitials: "BP",
        basicRate: "99999.00", startDate: "2026-01-01",
      },
    ]).returning();
    const inserted = await db.insert(leaveRequests).values(
      [alphaOne, alphaTwo, alphaThree, betaOne].map((person) => ({
        organizationId: person.organizationId,
        employeeId: person.id,
        leaveType: "Vacation",
        startDate: "2026-10-15",
        endDate: "2026-10-15",
        days: "1",
        reason: person.firstName + " confidential reason",
      })),
    ).returning();

    async function visible(
      organizationId: number,
      options: { unitId?: number; employeeId?: number } = {},
    ) {
      const conditions = [
        eq(leaveRequests.organizationId, organizationId),
        eq(employees.organizationId, organizationId),
      ];
      if (options.employeeId !== undefined) {
        conditions.push(eq(leaveRequests.employeeId, options.employeeId));
      } else if (options.unitId !== undefined) {
        conditions.push(eq(employees.orgUnitId, options.unitId));
      }
      return db.select({ leaveId: leaveRequests.id, worker: employees.firstName })
        .from(leaveRequests)
        .innerJoin(employees, and(
          eq(leaveRequests.employeeId, employees.id),
          eq(employees.organizationId, organizationId),
        ))
        .where(and(...conditions));
    }

    const ids = (rows: Awaited<ReturnType<typeof visible>>) =>
      rows.map((row) => row.leaveId).sort((a, b) => a - b);

    assert.deepEqual(
      ids(await visible(alpha.id, { unitId: alphaUnitOne.id })),
      ids(inserted.slice(0, 2).map((row) => ({ leaveId: row.id, worker: "" }))),
    );
    assert.deepEqual(
      ids(await visible(alpha.id, { employeeId: alphaOne.id })),
      [inserted[0].id],
    );
    assert.deepEqual(
      ids(await visible(alpha.id)),
      ids(inserted.slice(0, 3).map((row) => ({ leaveId: row.id, worker: "" }))),
    );
    const betaOnly = await visible(beta.id);
    assert.deepEqual(ids(betaOnly), [inserted[3].id]);
    assert.ok(betaOnly.every((row) => row.worker === "BetaPrivate"));
    assert.deepEqual(await visible(alpha.id, { employeeId: betaOne.id }), []);
    assert.deepEqual(await visible(beta.id, { unitId: alphaUnitOne.id }), []);
  } finally {
    await db.delete(organizations).where(inArray(organizations.id, [alpha.id, beta.id]));
  }
});
