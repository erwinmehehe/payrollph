import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { eq } from "drizzle-orm";
import { db } from "../src/db";
import { orgUnits, organizations, userOrganizations, users } from "../src/db/schema";
import { assertMembership, getAccess } from "../src/lib/access";

/**
 * Synthetic PostgreSQL access regression. This exercises authorization reads
 * without a login, payroll, sensitive records or real production tenants.
 */
test("manager access fails closed without a current, same-employer unit", async () => {
  const suffix = randomUUID().slice(0, 10);
  const [alpha, beta] = await db.insert(organizations).values([
    { name: "Manager scope A " + suffix, legalName: "Manager scope A " + suffix },
    { name: "Manager scope B " + suffix, legalName: "Manager scope B " + suffix },
  ]).returning();
  let userId: number | null = null;
  try {
    const [alphaUnit, betaUnit] = await db.insert(orgUnits).values([
      { organizationId: alpha.id, code: "MSA-" + suffix, name: "Active manager team", type: "department" },
      { organizationId: beta.id, code: "MSB-" + suffix, name: "Other employer team", type: "department" },
    ]).returning();
    const [user] = await db.insert(users).values({
      email: "manager-scope-" + suffix + "@example.test",
      name: "Synthetic Manager Scope",
      passwordHash: "no-signin-test-fixture",
      role: "manager",
    }).returning();
    userId = user.id;
    await db.insert(userOrganizations).values({
      userId: user.id, organizationId: alpha.id, role: "manager", orgUnitId: null,
    });

    assert.equal(await getAccess(user.id, alpha.id), null);
    assert.equal((await assertMembership(user.id, alpha.id))?.status, 403);
    assert.equal(await getAccess(user.id, beta.id), null);

    await db.update(userOrganizations).set({ orgUnitId: betaUnit.id })
      .where(eq(userOrganizations.userId, user.id));
    assert.equal(await getAccess(user.id, alpha.id), null, "Cross-employer unit cannot authorize manager.");
    assert.equal((await assertMembership(user.id, alpha.id))?.status, 403);

    await db.update(userOrganizations).set({ orgUnitId: alphaUnit.id })
      .where(eq(userOrganizations.userId, user.id));
    const authorized = await getAccess(user.id, alpha.id);
    assert.deepEqual({
      organizationId: authorized?.organizationId,
      role: authorized?.role,
      orgUnitId: authorized?.orgUnitId,
      companyWide: authorized?.companyWide,
    }, {
      organizationId: alpha.id, role: "manager",
      orgUnitId: alphaUnit.id, companyWide: false,
    });

    await db.update(orgUnits).set({ active: false }).where(eq(orgUnits.id, alphaUnit.id));
    assert.equal(await getAccess(user.id, alpha.id), null, "Inactive unit cannot authorize manager.");
    assert.equal((await assertMembership(user.id, alpha.id))?.status, 403);

    await db.update(orgUnits).set({
      active: true, effectiveFrom: "2099-01-01", effectiveUntil: null,
    }).where(eq(orgUnits.id, alphaUnit.id));
    assert.equal(await getAccess(user.id, alpha.id), null, "Future-dated unit cannot authorize manager yet.");
    assert.equal((await assertMembership(user.id, alpha.id))?.status, 403);

    await db.update(orgUnits).set({
      effectiveFrom: null, effectiveUntil: "2000-01-01",
    }).where(eq(orgUnits.id, alphaUnit.id));
    assert.equal(await getAccess(user.id, alpha.id), null, "Expired unit cannot authorize manager.");
    assert.equal((await assertMembership(user.id, alpha.id))?.status, 403);

    await db.update(orgUnits).set({
      effectiveFrom: null, effectiveUntil: null,
    }).where(eq(orgUnits.id, alphaUnit.id));
    assert.equal((await getAccess(user.id, alpha.id))?.orgUnitId, alphaUnit.id);
    assert.equal(await assertMembership(user.id, alpha.id), null);

    await db.update(userOrganizations).set({ role: "hr", orgUnitId: null })
      .where(eq(userOrganizations.userId, user.id));
    const hr = await getAccess(user.id, alpha.id);
    assert.equal(hr?.role, "hr");
    assert.equal(hr?.companyWide, true, "Valid company-wide HR roles are unchanged.");
  } finally {
    if (userId !== null) await db.delete(users).where(eq(users.id, userId));
    await db.delete(organizations).where(eq(organizations.id, alpha.id));
    await db.delete(organizations).where(eq(organizations.id, beta.id));
  }
});
