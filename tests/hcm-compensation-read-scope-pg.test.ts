import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { eq, inArray } from "drizzle-orm";
import { db } from "../src/db";
import { orgUnits, organizations, userOrganizations, users } from "../src/db/schema";
import { getAccess } from "../src/lib/access";
import { projectCompensationReadCatalogs } from "../src/lib/hcm-compensation-read-projection";

/**
 * Two real PostgreSQL memberships with fictional names. No browser session,
 * payroll, banking, statutory filing or production employer data is used.
 * Full HTTP response serialization is verified with Response.json.
 */
test("real HR membership scope drives compensation budget redaction across two employers", async () => {
  const code = randomUUID().slice(0, 9);
  const [alpha, beta] = await db.insert(organizations).values([
    { name: "HCM scope Alpha " + code, legalName: "HCM scope Alpha " + code },
    { name: "HCM scope Beta " + code, legalName: "HCM scope Beta " + code },
  ]).returning();
  const ownedUserIds: number[] = [];
  try {
    const [alphaUnit, betaUnit] = await db.insert(orgUnits).values([
      { organizationId: alpha.id, code: "AC-" + code, name: "Only Alpha HR team", type: "department" },
      { organizationId: beta.id, code: "BC-" + code, name: "Foreign unit", type: "department" },
    ]).returning();
    const [globalHr, scopedHr, unrelated] = await db.insert(users).values([
      { email: "hcm-company-" + code + "@example.test", name: "Company HR", role: "hr", passwordHash: "synthetic-no-login" },
      { email: "hcm-unit-" + code + "@example.test", name: "Unit HR", role: "hr", passwordHash: "synthetic-no-login" },
      { email: "hcm-unrelated-" + code + "@example.test", name: "Unrelated HR", role: "hr", passwordHash: "synthetic-no-login" },
    ]).returning();
    ownedUserIds.push(globalHr.id, scopedHr.id, unrelated.id);
    await db.insert(userOrganizations).values([
      { userId: globalHr.id, organizationId: alpha.id, role: "hr", orgUnitId: null },
      { userId: scopedHr.id, organizationId: alpha.id, role: "hr", orgUnitId: alphaUnit.id },
      { userId: unrelated.id, organizationId: beta.id, role: "hr", orgUnitId: null },
    ]);

    const globalAccess = await getAccess(globalHr.id, alpha.id);
    const scopedAccess = await getAccess(scopedHr.id, alpha.id);
    assert.ok(globalAccess && scopedAccess);
    assert.equal(globalAccess.companyWide, true);
    assert.equal(scopedAccess.companyWide, false);
    assert.equal(scopedAccess.orgUnitId, alphaUnit.id);
    assert.equal(await getAccess(unrelated.id, alpha.id), null,
      "A membership in Beta cannot authorize a compensation read in Alpha.");

    const input = {
      workers: [], proposals: [], assignments: [], positions: [],
      jobProfiles: [], jobGrades: [], legalEntities: [], bands: [],
      cycles: [
        { id: 801, organizationId: alpha.id, name: "Company-wide salary review",
          startDate: "2026-10-01", endDate: "2026-11-30", effectiveDate: "2026-12-15",
          status: "active", budgetPool: "987654.32" },
        { id: 802, organizationId: beta.id, name: "FOREIGN_SECRET_REVIEW",
          startDate: "2026-10-01", endDate: "2026-11-30", effectiveDate: "2026-12-15",
          status: "active", budgetPool: "876543.21" },
      ],
    };
    const globalResponse = Response.json(projectCompensationReadCatalogs({
      ...input, access: globalAccess,
    }));
    const unitResponse = Response.json(projectCompensationReadCatalogs({
      ...input, access: scopedAccess,
    }));
    const globalBody = await globalResponse.json();
    const unitBody = await unitResponse.json();
    assert.equal(globalResponse.status, 200);
    assert.equal(unitResponse.status, 200);
    assert.equal(globalBody.cycles[0].budgetPool, "987654.32");
    assert.equal(unitBody.cycles[0].budgetPool, null);
    assert.equal(unitBody.cycles[0].name, "Company-wide salary review");
    assert.ok(!JSON.stringify(unitBody).includes("987654.32"));
    for (const response of [globalBody, unitBody]) {
      assert.equal(response.cycles.length, 1);
      assert.ok(!JSON.stringify(response).includes("FOREIGN_SECRET_REVIEW"));
      assert.ok(!JSON.stringify(response).includes("876543.21"));
    }

    // getAccess() historically did not reject mismatched unit HR memberships:
    // the compensation GET must fail closed on missing same-employer unit.
    await db.update(userOrganizations).set({ orgUnitId: betaUnit.id })
      .where(eq(userOrganizations.userId, scopedHr.id));
    const stale = await getAccess(scopedHr.id, alpha.id);
    assert.equal(stale?.companyWide, false);
    assert.equal(stale?.orgUnitName, null);
    assert.equal(!stale?.companyWide && !stale?.orgUnitName, true,
      "Compensation GET rejects an unresolved/foreign HR unit before fetching salaries.");
  } finally {
    if (ownedUserIds.length) await db.delete(users).where(inArray(users.id, ownedUserIds));
    await db.delete(organizations).where(eq(organizations.id, alpha.id));
    await db.delete(organizations).where(eq(organizations.id, beta.id));
  }
});
