import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { and, eq } from "drizzle-orm";
import { db } from "../src/db";
import {
  auditEvents, employees, organizations, separationClearanceWaivers,
  separationRecords, sessions, userOrganizations, users,
} from "../src/db/schema";
import { offboardingClearanceStatus } from "../src/lib/offboarding-clearance";
import { revokeSeparatedEmployeeAccessTx } from "../src/lib/offboarding-access-revocation";

test("waiver ledger enforces uniqueness, audit rollback, and re-review after revocation", async () => {
  const [org] = await db.insert(organizations).values({
    name: "Synthetic A6 clearance", legalName: "Synthetic A6 clearance", plan: "Core",
  }).returning();
  const suffix = randomUUID();
  const [maker, reviewer] = await db.insert(users).values([
    { email: "a6-maker-" + suffix + "@example.invalid", name: "A6 Maker", passwordHash: "qa" },
    { email: "a6-review-" + suffix + "@example.invalid", name: "A6 Reviewer", passwordHash: "qa" },
  ]).returning();
  try {
    const [employee] = await db.insert(employees).values({
      organizationId: org.id, employeeNo: "A6-" + org.id,
      firstName: "Synthetic", lastName: "Offboarding", title: "QA",
      avatarInitials: "SO", basicRate: "30000.00", startDate: "2026-01-01",
    }).returning();
    const [sep] = await db.insert(separationRecords).values({
      organizationId: org.id, employeeId: employee.id, separationType: "resignation",
      noticeDate: "2026-10-01", lastDay: "2026-10-31",
      preparedByUserId: maker.id, itCleared: true, adminCleared: true, hrCleared: true,
    }).returning();
    const values = {
      organizationId: org.id, separationId: sep.id, employeeId: employee.id,
      department: "finance",
      reason: "Independently reviewed the remaining Finance obligation and waived it.",
      evidenceReference: "SYNTHETIC-A6-REVIEW-001", authorizedByUserId: reviewer.id,
    };

    await assert.rejects(() => db.transaction(async tx => {
      await tx.insert(separationClearanceWaivers).values(values);
      await tx.insert(auditEvents).values({
        organizationId: org.id, actor: reviewer.name,
        action: "Synthetic A6 waiver", resource: "Test waiver",
      });
      throw new Error("SIMULATED_WAIVER_COMMIT_FAILURE");
    }), /SIMULATED_WAIVER_COMMIT_FAILURE/);
    assert.equal((await db.select().from(separationClearanceWaivers).where(
      eq(separationClearanceWaivers.separationId, sep.id),
    )).length, 0, "no waiver survives a failed audit transaction");

    const [waiver] = await db.insert(separationClearanceWaivers).values(values).returning();
    assert.equal(offboardingClearanceStatus(sep, [waiver]).ready, true);
    await assert.rejects(() => db.insert(separationClearanceWaivers).values(values),
      "duplicate current waiver must fail SQL uniqueness");
    await db.update(separationClearanceWaivers).set({
      revokedAt: new Date(), revokedByUserId: reviewer.id,
    }).where(eq(separationClearanceWaivers.id, waiver.id));
    const rows = await db.select().from(separationClearanceWaivers).where(
      eq(separationClearanceWaivers.separationId, sep.id),
    );
    assert.equal(offboardingClearanceStatus(sep, rows).ready, false);
    await db.insert(separationClearanceWaivers).values({
      ...values, evidenceReference: "SYNTHETIC-A6-REVIEW-002",
    });
    const history = await db.select().from(separationClearanceWaivers).where(
      eq(separationClearanceWaivers.separationId, sep.id),
    );
    assert.equal(history.length, 2, "revoked evidence remains in the ledger");
    assert.equal(offboardingClearanceStatus(sep, history).ready, true);
  } finally {
    await db.delete(organizations).where(eq(organizations.id, org.id));
    await db.delete(users).where(eq(users.id, maker.id));
    await db.delete(users).where(eq(users.id, reviewer.id));
  }
});

test("separated worker access revocation is tenant-scoped and rollback-atomic", async () => {
  const suffix = randomUUID();
  const [orgA, orgB] = await db.insert(organizations).values([
    { name: "A6 Employer A", legalName: "A6 Employer A", plan: "Core" },
    { name: "A6 Employer B", legalName: "A6 Employer B", plan: "Core" },
  ]).returning();
  const [actor] = await db.insert(users).values({
    email: "a6-actor-" + suffix + "@example.invalid", name: "A6 Auditor",
    passwordHash: "qa", role: "owner",
  }).returning();
  let employeeLoginId: number | null = null;
  try {
    const [worker] = await db.insert(employees).values({
      organizationId: orgA.id, employeeNo: "A6-ACCESS-" + orgA.id,
      firstName: "Access", lastName: "Worker", title: "Support",
      avatarInitials: "AW", basicRate: "30000.00", startDate: "2026-01-01",
      status: "Separating",
    }).returning();
    const [login] = await db.insert(users).values({
      email: "a6-worker-" + suffix + "@example.invalid", name: "A6 ESS Worker",
      passwordHash: "qa", role: "employee", employeeId: worker.id,
    }).returning();
    employeeLoginId = login.id;
    const [session] = await db.insert(sessions).values({
      userId: login.id, tokenHash: "a6-" + suffix,
      expiresAt: new Date("2030-01-01T00:00:00Z"),
    }).returning();
    await db.insert(userOrganizations).values([
      { userId: actor.id, organizationId: orgA.id, role: "admin", workerEmployeeId: worker.id },
      { userId: actor.id, organizationId: orgB.id, role: "admin" },
    ]);
    await assert.rejects(() => db.transaction(async tx => {
      await tx.update(employees).set({ status: "Separated" }).where(eq(employees.id, worker.id));
      await revokeSeparatedEmployeeAccessTx(tx, {
        organizationId: orgA.id, employeeId: worker.id, separationId: 123456,
        actorUserId: actor.id, actorName: actor.name,
      });
      throw new Error("SIMULATED_FINAL_PAY_RELEASE_ROLLBACK");
    }), /SIMULATED_FINAL_PAY_RELEASE_ROLLBACK/);
    const [workerAfterRollback] = await db.select().from(employees).where(eq(employees.id, worker.id));
    const [loginAfterRollback] = await db.select().from(users).where(eq(users.id, login.id));
    const [sessionAfterRollback] = await db.select().from(sessions).where(eq(sessions.id, session.id));
    assert.equal(workerAfterRollback.status, "Separating");
    assert.equal(loginAfterRollback.active, true);
    assert.equal(sessionAfterRollback.revokedAt, null);

    await db.transaction(async tx => {
      await tx.update(employees).set({ status: "Separated" }).where(eq(employees.id, worker.id));
      const result = await revokeSeparatedEmployeeAccessTx(tx, {
        organizationId: orgA.id, employeeId: worker.id, separationId: 123456,
        actorUserId: actor.id, actorName: actor.name,
      });
      assert.deepEqual(result.disabledEmployeeLoginIds, [login.id]);
      assert.equal(result.revokedSessionCount, 1);
      assert.equal(result.revokedEmployerMembershipIds.length, 1);
    });
    // A different employer cannot revoke the first employer's worker or
    // manufacture cross-tenant audit evidence after the local release.
    await assert.rejects(() => db.transaction(tx => revokeSeparatedEmployeeAccessTx(tx, {
      organizationId: orgB.id, employeeId: worker.id, separationId: 123456,
      actorUserId: actor.id, actorName: actor.name,
    })), /OFFBOARDING_ACCESS_EMPLOYEE_NOT_SEPARATED/);
    const [locked] = await db.select().from(users).where(eq(users.id, login.id));
    const [revokedSession] = await db.select().from(sessions).where(eq(sessions.id, session.id));
    const memberships = await db.select().from(userOrganizations)
      .where(eq(userOrganizations.userId, actor.id));
    assert.equal(locked.active, false);
    assert.equal(locked.localPasswordEnabled, false);
    assert.ok(revokedSession.revokedAt);
    assert.equal(memberships.find(item => item.organizationId === orgA.id)?.active, false);
    assert.equal(memberships.find(item => item.organizationId === orgB.id)?.active, true);
    assert.equal((await db.select().from(auditEvents).where(and(
      eq(auditEvents.organizationId, orgA.id),
      eq(auditEvents.action, "Separated worker application access revoked"),
    ))).length, 1);
  } finally {
    await db.delete(organizations).where(eq(organizations.id, orgA.id));
    await db.delete(organizations).where(eq(organizations.id, orgB.id));
    if (employeeLoginId !== null) await db.delete(users).where(eq(users.id, employeeLoginId));
    await db.delete(users).where(eq(users.id, actor.id));
  }
});

test("offboarding preserves other employer login but revokes original sessions and employer A membership", async () => {
  const suffix = randomUUID();
  const [orgA, orgB] = await db.insert(organizations).values([
    { name: "A6 Identity A " + suffix, legalName: "A6 Identity A", plan: "Core" },
    { name: "A6 Identity B " + suffix, legalName: "A6 Identity B", plan: "Core" },
  ]).returning();
  const [reviewer] = await db.insert(users).values({
    email: "a6-cross-review-" + suffix + "@example.invalid",
    name: "Fictional A6 Reviewer", passwordHash: "qa", role: "owner",
  }).returning();
  let loginId: number | null = null;
  try {
    const [worker] = await db.insert(employees).values({
      organizationId: orgA.id, employeeNo: "A6-DUAL-" + orgA.id,
      firstName: "Fictional", lastName: "Dual Membership", title: "Staff",
      avatarInitials: "FM", basicRate: "25000.00", startDate: "2026-01-01",
      status: "Separated",
    }).returning();
    const [login] = await db.insert(users).values({
      email: "a6-cross-employee-" + suffix + "@example.invalid",
      name: "Fictional A6 Employee", passwordHash: "qa", role: "employee",
      employeeId: worker.id,
    }).returning();
    loginId = login.id;
    const memberships = await db.insert(userOrganizations).values([
      { userId: login.id, organizationId: orgA.id, role: "employee", workerEmployeeId: null },
      { userId: login.id, organizationId: orgB.id, role: "employee" },
    ]).returning();
    const [session] = await db.insert(sessions).values({
      userId: login.id, tokenHash: "a6-dual-" + suffix,
      expiresAt: new Date("2030-01-01T00:00:00Z"),
    }).returning();
    await db.transaction(async tx => {
      const revoked = await revokeSeparatedEmployeeAccessTx(tx, {
        organizationId: orgA.id, employeeId: worker.id, separationId: 9001,
        actorUserId: reviewer.id, actorName: reviewer.name,
      });
      assert.deepEqual(revoked.disabledEmployeeLoginIds, []);
      assert.equal(revoked.revokedSessionCount, 1);
      assert.equal(revoked.revokedEmployerMembershipIds.length, 1);
    });
    const [saved] = await db.select().from(users).where(eq(users.id, login.id));
    assert.equal(saved.active, true, "Employer B identity must remain usable");
    assert.equal(saved.localPasswordEnabled, true);
    const [oldSession] = await db.select().from(sessions).where(eq(sessions.id, session.id));
    assert.ok(oldSession.revokedAt, "Existing sessions must reauthenticate");
    const persisted = await db.select().from(userOrganizations)
      .where(eq(userOrganizations.userId, login.id));
    assert.equal(persisted.find(m => m.id === memberships[0].id)?.active, false);
    assert.equal(persisted.find(m => m.id === memberships[1].id)?.active, true);
  } finally {
    await db.delete(organizations).where(eq(organizations.id, orgA.id));
    await db.delete(organizations).where(eq(organizations.id, orgB.id));
    if (loginId !== null) await db.delete(users).where(eq(users.id, loginId));
    await db.delete(users).where(eq(users.id, reviewer.id));
  }
});
