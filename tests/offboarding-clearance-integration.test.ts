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
    assert.equal(saved.employeeId, null,
      "Surviving account must never retain the separated employer's self-service employee link");
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


test("worker-only tenant membership revokes its login sessions without harming another employer", async () => {
  const suffix = randomUUID();
  const [orgA, orgB] = await db.insert(organizations).values([
    { name: "A6 Membership-only A " + suffix, legalName: "A6 Membership-only A", plan: "Core" },
    { name: "A6 Membership-only B " + suffix, legalName: "A6 Membership-only B", plan: "Core" },
  ]).returning();
  const [actor, workerLogin, employeeLogin] = await db.insert(users).values([
    { email: "a6-member-actor-" + suffix + "@example.invalid", name: "Fictional Reviewer", passwordHash: "qa", role: "owner" },
    { email: "a6-member-worker-" + suffix + "@example.invalid", name: "Fictional Worker", passwordHash: "qa", role: "employee" },
    { email: "a6-member-single-" + suffix + "@example.invalid", name: "Fictional Single", passwordHash: "qa", role: "employee" },
  ]).returning();
  try {
    const [worker] = await db.insert(employees).values({
      organizationId: orgA.id, employeeNo: "A6-MEMBER-" + orgA.id,
      firstName: "Fictional", lastName: "Membership Only", title: "QA",
      avatarInitials: "FM", basicRate: "25000.00", startDate: "2026-01-01",
      status: "Separated",
    }).returning();
    await db.insert(userOrganizations).values([
      { userId: workerLogin.id, organizationId: orgA.id, role: "employee", workerEmployeeId: worker.id },
      { userId: workerLogin.id, organizationId: orgB.id, role: "employee" },
      { userId: employeeLogin.id, organizationId: orgA.id, role: "employee" },
    ]);
    // The first worker has no global employeeId, and a second login has no
    // worker link: the second login is unrelated and must not be revoked.
    const [affectedSession, unrelatedSession] = await db.insert(sessions).values([
      { userId: workerLogin.id, tokenHash: "a6-member-" + suffix, expiresAt: new Date("2030-01-01T00:00:00Z") },
      { userId: employeeLogin.id, tokenHash: "a6-member-other-" + suffix, expiresAt: new Date("2030-01-01T00:00:00Z") },
    ]).returning();
    await db.transaction(async tx => {
      const outcome = await revokeSeparatedEmployeeAccessTx(tx, {
        organizationId: orgA.id, employeeId: worker.id,
        separationId: 9002, actorUserId: actor.id, actorName: actor.name,
      });
      assert.deepEqual(outcome.disabledEmployeeLoginIds, []);
      assert.equal(outcome.revokedSessionCount, 1);
      assert.equal(outcome.revokedEmployerMembershipIds.length, 1);
    });
    const [affected] = await db.select().from(users).where(eq(users.id, workerLogin.id));
    assert.equal(affected.active, true, "second employer's account remains active");
    const [revoked] = await db.select().from(sessions).where(eq(sessions.id, affectedSession.id));
    const [untouched] = await db.select().from(sessions).where(eq(sessions.id, unrelatedSession.id));
    assert.ok(revoked.revokedAt, "membership-only linked worker must lose pre-release sessions");
    assert.equal(untouched.revokedAt, null, "unrelated login must retain its session");
    const all = await db.select().from(userOrganizations).where(eq(userOrganizations.userId, workerLogin.id));
    assert.equal(all.find(item => item.organizationId === orgA.id)?.active, false);
    assert.equal(all.find(item => item.organizationId === orgB.id)?.active, true);
  } finally {
    await db.delete(organizations).where(eq(organizations.id, orgA.id));
    await db.delete(organizations).where(eq(organizations.id, orgB.id));
    await db.delete(users).where(eq(users.id, actor.id));
    await db.delete(users).where(eq(users.id, workerLogin.id));
    await db.delete(users).where(eq(users.id, employeeLogin.id));
  }
});


test("independent last-day cutoff revokes local access but leaves final pay pending", async () => {
  const suffix = randomUUID();
  const [orgA, orgB] = await db.insert(organizations).values([
    { name: "A6 Last-day A " + suffix, legalName: "A6 Last-day A", plan: "Core" },
    { name: "A6 Last-day B " + suffix, legalName: "A6 Last-day B", plan: "Core" },
  ]).returning();
  const [maker, reviewer, login] = await db.insert(users).values([
    { email: "a6-cutoff-maker-" + suffix + "@example.invalid", name: "Fictional Maker", passwordHash: "qa", role: "owner" },
    { email: "a6-cutoff-reviewer-" + suffix + "@example.invalid", name: "Fictional Reviewer", passwordHash: "qa", role: "owner" },
    { email: "a6-cutoff-login-" + suffix + "@example.invalid", name: "Fictional Worker", passwordHash: "qa", role: "employee" },
  ]).returning();
  try {
    const [worker] = await db.insert(employees).values({
      organizationId: orgA.id, employeeNo: "A6-CUTOFF-" + orgA.id,
      firstName: "Fictional", lastName: "Cutoff", title: "QA",
      avatarInitials: "FC", basicRate: "25000.00", startDate: "2024-01-01",
      status: "Separating",
    }).returning();
    await db.update(users).set({ employeeId: worker.id }).where(eq(users.id, login.id));
    const [sep] = await db.insert(separationRecords).values({
      organizationId: orgA.id, employeeId: worker.id,
      separationType: "resignation", noticeDate: "2025-01-01",
      lastDay: "2099-01-01", preparedByUserId: maker.id,
    }).returning();
    await db.insert(userOrganizations).values([
      { userId: login.id, organizationId: orgA.id, role: "employee", workerEmployeeId: worker.id },
      { userId: login.id, organizationId: orgB.id, role: "employee" },
    ]);
    const [session] = await db.insert(sessions).values({
      userId: login.id, tokenHash: "a6-cutoff-" + suffix,
      expiresAt: new Date("2100-01-01T00:00:00Z"),
    }).returning();
    const input = {
      organizationId: orgA.id, employeeId: worker.id, separationId: sep.id,
      actorUserId: reviewer.id, actorName: reviewer.name,
      mode: "last-day-local-access" as const,
      cutoffEvidenceReference: "SYNTHETIC-IT-CUTOFF-REVIEW-001",
    };
    await assert.rejects(
      () => db.transaction(tx => revokeSeparatedEmployeeAccessTx(tx, input)),
      /OFFBOARDING_ACCESS_LAST_DAY_PENDING/,
      "future-dated departure cannot revoke login access",
    );
    const [stillLive] = await db.select().from(sessions).where(eq(sessions.id, session.id));
    assert.equal(stillLive.revokedAt, null);
    await db.update(separationRecords).set({ lastDay: "2025-10-01" })
      .where(eq(separationRecords.id, sep.id));
    await assert.rejects(
      () => db.transaction(tx => revokeSeparatedEmployeeAccessTx(tx, {
        ...input, actorUserId: maker.id,
      })),
      /OFFBOARDING_ACCESS_INDEPENDENT_REVIEW_REQUIRED/,
    );
    await assert.rejects(
      () => db.transaction(tx => revokeSeparatedEmployeeAccessTx(tx, {
        ...input, cutoffEvidenceReference: "short",
      })),
      /OFFBOARDING_ACCESS_EVIDENCE_REQUIRED/,
    );
    const result = await db.transaction(tx => revokeSeparatedEmployeeAccessTx(tx, input));
    assert.deepEqual(result.disabledEmployeeLoginIds, []);
    assert.equal(result.revokedSessionCount, 1);
    assert.equal(result.revokedEmployerMembershipIds.length, 1);
    const [afterSep] = await db.select().from(separationRecords)
      .where(eq(separationRecords.id, sep.id));
    const [afterWorker] = await db.select().from(employees).where(eq(employees.id, worker.id));
    const [afterLogin] = await db.select().from(users).where(eq(users.id, login.id));
    const [afterSession] = await db.select().from(sessions).where(eq(sessions.id, session.id));
    assert.equal(afterSep.status, "draft", "no financial approval or release transition");
    assert.equal(afterSep.releasedAt, null);
    assert.equal(afterWorker.status, "Separating", "payroll worker status remains unchanged");
    assert.equal(afterLogin.active, true, "cross-employer account survives");
    assert.equal(afterLogin.employeeId, null, "old self-service employee pointer removed");
    assert.ok(afterSession.revokedAt, "old session denied on next request");
    const memberships = await db.select().from(userOrganizations)
      .where(eq(userOrganizations.userId, login.id));
    assert.equal(memberships.find(m => m.organizationId === orgA.id)?.active, false);
    assert.equal(memberships.find(m => m.organizationId === orgB.id)?.active, true);
    const audit = await db.select().from(auditEvents).where(and(
      eq(auditEvents.organizationId, orgA.id),
      eq(auditEvents.action, "Separation last-day local application access revoked"),
    ));
    assert.equal(audit.length, 1);
    assert.equal((audit[0].metadata as Record<string, unknown>).externalProviderCallsMade, false);
    assert.equal((audit[0].metadata as Record<string, unknown>).finalPayStateChanged, false);
    assert.equal((audit[0].metadata as Record<string, unknown>).payoutExecuted, false);
  } finally {
    await db.delete(organizations).where(eq(organizations.id, orgA.id));
    await db.delete(organizations).where(eq(organizations.id, orgB.id));
    await db.delete(users).where(eq(users.id, maker.id));
    await db.delete(users).where(eq(users.id, reviewer.id));
    await db.delete(users).where(eq(users.id, login.id));
  }
});
