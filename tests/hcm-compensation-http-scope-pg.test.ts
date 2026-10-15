import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import test from "node:test";
import { eq, inArray } from "drizzle-orm";
import { db } from "../src/db";
import {
  compensationBands, compensationCycles, compensationProposals,
  employeePayProfiles, employees, legalEntities, orgUnits, organizations,
  userOrganizations, users,
} from "../src/db/schema";
import { getAccess } from "../src/lib/access";

const require = createRequire(import.meta.url);

/**
 * Production GET handler against the CI's disposable PostgreSQL 16 database.
 * Only cookie lookup and privileged session policy are shimmed: real HR
 * membership -> getAccess(), real compensation source queries and response
 * serialization are exercised. No deployed endpoint, money, filing or PII.
 */
test("actual compensation GET returns scoped salary JSON without other-unit budget or legal bank fields", async () => {
  const suffix = randomUUID().slice(0, 10);
  const [alpha, beta] = await db.insert(organizations).values([
    { name: "Comp HTTP Alpha " + suffix, legalName: "Comp HTTP Alpha " + suffix },
    { name: "Comp HTTP Beta " + suffix, legalName: "Comp HTTP Beta " + suffix },
  ]).returning();
  const ownedUserIds: number[] = [];
  const restores: Array<() => void> = [];
  let caller: { id: number; name: string } | null = null;
  const patch = (path: string, overrides: Record<string, unknown>) => {
    const key = require.resolve(path);
    const previous = require(key);
    require.cache[key]!.exports = { ...previous, ...overrides };
    restores.push(() => { require.cache[key]!.exports = previous; });
  };
  try {
    const [unitA, unitB] = await db.insert(orgUnits).values([
      { organizationId: alpha.id, code: "CAA-" + suffix, name: "Unit A", type: "department" },
      { organizationId: alpha.id, code: "CAB-" + suffix, name: "Unit B", type: "department" },
    ]).returning();
    const [legalA, legalB] = await db.insert(legalEntities).values([
      { organizationId: alpha.id, code: "LA-" + suffix, legalName: "Synthetic Legal A",
        displayName: "Visible legal A", disbursementAccount: "PRIVATE-BANK-LA-999" },
      { organizationId: alpha.id, code: "LB-" + suffix, legalName: "Synthetic Legal B",
        displayName: "Other legal B", disbursementAccount: "PRIVATE-BANK-LB-888" },
    ]).returning();
    const [company, scoped] = await db.insert(users).values([
      { email: "comp-company-" + suffix + "@example.test", name: "Company HR test",
        role: "hr", passwordHash: "test-only-no-signin" },
      { email: "comp-scoped-" + suffix + "@example.test", name: "Unit HR test",
        role: "hr", passwordHash: "test-only-no-signin" },
    ]).returning();
    ownedUserIds.push(company.id, scoped.id);
    await db.insert(userOrganizations).values([
      { userId: company.id, organizationId: alpha.id, role: "hr", orgUnitId: null },
      { userId: scoped.id, organizationId: alpha.id, role: "hr", orgUnitId: unitA.id },
    ]);
    const [workerA, workerB] = await db.insert(employees).values([
      { organizationId: alpha.id, orgUnitId: unitA.id, legalEntityId: legalA.id,
        employeeNo: "A-" + suffix, firstName: "VISIBLE_A", lastName: "Worker",
        title: "Staff", avatarInitials: "VA", basicRate: "22000.00",
        startDate: "2026-01-01" },
      { organizationId: alpha.id, orgUnitId: unitB.id, legalEntityId: legalB.id,
        employeeNo: "B-" + suffix, firstName: "OTHER_UNIT_B", lastName: "Worker",
        title: "Staff", avatarInitials: "OB", basicRate: "99000.00",
        startDate: "2026-01-01" },
    ]).returning();
    await db.insert(employeePayProfiles).values([
      { organizationId: alpha.id, employeeId: workerA.id, payBasis: "monthly",
        rateAmount: "22000.00", standardWorkDaysPerMonth: "22", standardHoursPerDay: "8" },
      { organizationId: alpha.id, employeeId: workerB.id, payBasis: "monthly",
        rateAmount: "99000.00", standardWorkDaysPerMonth: "22", standardHoursPerDay: "8" },
    ]);
    const [bandA, bandB] = await db.insert(compensationBands).values([
      { organizationId: alpha.id, legalEntityId: legalA.id, locationCode: "PH",
        minimumAnnual: "200000.00", midpointAnnual: "300000.00",
        maximumAnnual: "400000.00", effectiveFrom: "2026-01-01" },
      { organizationId: alpha.id, legalEntityId: legalB.id, locationCode: "NCR",
        minimumAnnual: "900000.00", midpointAnnual: "950000.00",
        maximumAnnual: "999999.00", effectiveFrom: "2026-01-01" },
    ]).returning();
    const [cycle] = await db.insert(compensationCycles).values({
      organizationId: alpha.id, name: "Compensation cycle " + suffix,
      startDate: "2026-10-01", endDate: "2026-11-30",
      effectiveDate: "2026-12-15", budgetPool: "876543.21",
      status: "active",
    }).returning();
    await db.insert(compensationProposals).values([
      { organizationId: alpha.id, employeeId: workerA.id, cycleId: cycle.id,
        bandId: bandA.id, currentAnnual: "264000.00",
        proposedAnnual: "290000.00", reason: "Authorized source A review", status: "proposed" },
      { organizationId: alpha.id, employeeId: workerB.id, cycleId: cycle.id,
        bandId: bandB.id, currentAnnual: "900000.00",
        proposedAnnual: "950000.00", reason: "Other unit B private review", status: "proposed" },
    ]);

    patch("../src/lib/auth", { getSessionUser: async () => caller });
    patch("../src/lib/access", {
      assertOrganizationRole: async (userId: number, orgId: number, allowedRoles: readonly string[]) => {
        // The real membership resolution remains in the exercised path.
        // Only privileged session/MFA policy is omitted from this fixture.
        const access = await getAccess(userId, orgId);
        return access && allowedRoles.includes(access.role)
          ? null : Response.json({ error: "Scope denied" }, { status: 403 });
      },
    });
    const { GET } = await import("../src/app/api/compensation/route");
    const request = (orgId: number) => new Request(
      "https://example.test/api/compensation?organizationId=" + orgId,
    );

    caller = { id: company.id, name: "Company HR test" };
    const globalResponse = await GET(request(alpha.id));
    assert.equal(globalResponse.status, 200);
    const global = await globalResponse.json();
    assert.equal(global.cycles[0].budgetPool, "876543.21");
    assert.equal(global.employees.length, 2);
    assert.equal(global.proposals.length, 2);
    assert.equal(global.legalEntities.length, 2);
    assert.doesNotMatch(JSON.stringify(global), /PRIVATE-BANK-|disbursementAccount|birTin/);

    caller = { id: scoped.id, name: "Unit HR test" };
    const scopedResponse = await GET(request(alpha.id));
    assert.equal(scopedResponse.status, 200);
    const view = await scopedResponse.json();
    assert.equal(view.access.companyWide, false);
    assert.equal(view.cycles[0].budgetPool, null);
    assert.deepEqual(view.employees.map((e: { id: number }) => e.id), [workerA.id]);
    assert.deepEqual(view.proposals.map((e: { employeeId: number }) => e.employeeId), [workerA.id]);
    assert.deepEqual(view.bands.map((e: { id: number }) => e.id), [bandA.id]);
    assert.deepEqual(view.legalEntities.map((e: { id: number }) => e.id), [legalA.id]);
    for (const secret of [
      "876543.21", "OTHER_UNIT_B", "Other unit B private review",
      "99000.00", "950000.00", "PRIVATE-BANK-LA",
      "PRIVATE-BANK-LB", "Other legal B", "disbursementAccount",
    ]) assert.ok(!JSON.stringify(view).includes(secret), "Compensation API leaked " + secret);

    assert.equal((await GET(request(beta.id))).status, 403,
      "No membership in another employer must be denied.");
    await db.update(userOrganizations).set({ orgUnitId: unitB.id })
      .where(eq(userOrganizations.userId, scoped.id));
    await db.update(orgUnits).set({ active: false }).where(eq(orgUnits.id, unitB.id));
    assert.equal((await GET(request(alpha.id))).status, 403,
      "Inactive unit cannot read compensation.");
  } finally {
    for (const restore of restores.reverse()) restore();
    if (ownedUserIds.length) await db.delete(users).where(inArray(users.id, ownedUserIds));
    await db.delete(organizations).where(inArray(organizations.id, [alpha.id, beta.id]));
  }
});
