import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../src/db";
import {
  employees, orgUnits, organizations, scheduleOverrides, shiftDefinitions,
  userOrganizations, users,
} from "../src/db/schema";
import { workforceScheduleReceipts as receipts } from "../src/lib/workforce-schedule-receipt-schema";
import {
  acknowledgeScheduleReceipt, readManagerScheduleReceiptView,
  readScheduleReceiptView, ScheduleReceiptError,
} from "../src/lib/workforce-schedule-receipt-server";

/** Test fixtures use fictional identities, no real payroll/employee actions. */
test("manager receipt review remains tenant/unit-scoped and reflects only current-content receipts", {
  timeout: 30000,
}, async () => {
  const marker = randomUUID();
  const orgs = await db.insert(organizations).values([
    { name: "Manager receipts A " + marker, legalName: "Fictional A" },
    { name: "Manager receipts B " + marker, legalName: "Fictional B" },
  ]).returning();
  let userIds: number[] = [];
  try {
    const units = await db.insert(orgUnits).values([
      { organizationId: orgs[0].id, type: "department", code: "AA", name: "Fictional A department" },
      { organizationId: orgs[0].id, type: "department", code: "AB", name: "Fictional A other department" },
      { organizationId: orgs[1].id, type: "department", code: "BA", name: "Fictional B department" },
    ]).returning();
    const staff = await db.insert(employees).values([
      { organizationId: orgs[0].id, orgUnitId: units[0].id, employeeNo: "MANAGER-RECEIPT-A",
        firstName: "Fictional", lastName: "A", title: "Synthetic worker",
        avatarInitials: "FA", basicRate: "20000.00", startDate: "2030-01-01", status: "Active" },
      { organizationId: orgs[0].id, orgUnitId: units[1].id, employeeNo: "MANAGER-RECEIPT-A2",
        firstName: "Fictional", lastName: "A2", title: "Synthetic worker",
        avatarInitials: "FA", basicRate: "20000.00", startDate: "2030-01-01", status: "Active" },
      { organizationId: orgs[1].id, orgUnitId: units[2].id, employeeNo: "MANAGER-RECEIPT-B",
        firstName: "Fictional", lastName: "B", title: "Synthetic worker",
        avatarInitials: "FB", basicRate: "20000.00", startDate: "2030-01-01", status: "Active" },
    ]).returning();
    const accounts = await db.insert(users).values([
      { name: "Fictional ESS A", email: "manager-receipt-a-" + marker + "@example.invalid",
        passwordHash: "fixture-no-login", role: "employee", active: true, employeeId: staff[0].id },
      { name: "Fictional ESS B", email: "manager-receipt-b-" + marker + "@example.invalid",
        passwordHash: "fixture-no-login", role: "employee", active: true, employeeId: staff[2].id },
      { name: "Fictional unit HR", email: "manager-receipt-hr-" + marker + "@example.invalid",
        passwordHash: "fixture-no-login", role: "hr", active: true },
      { name: "Fictional company admin", email: "manager-receipt-admin-" + marker + "@example.invalid",
        passwordHash: "fixture-no-login", role: "owner", active: true },
    ]).returning();
    userIds = accounts.map(account => account.id);
    await db.insert(userOrganizations).values([
      { organizationId: orgs[0].id, userId: accounts[0].id, role: "employee", active: true },
      { organizationId: orgs[1].id, userId: accounts[1].id, role: "employee", active: true },
      { organizationId: orgs[0].id, userId: accounts[2].id,
        role: "hr", orgUnitId: units[0].id, active: true },
      { organizationId: orgs[0].id, userId: accounts[3].id,
        role: "owner", active: true },
    ]);
    const shifts = await db.insert(shiftDefinitions).values([
      { organizationId: orgs[0].id, code: "RECEIPT-REVIEW-A", name: "Fictional day",
        startTime: "09:00", endTime: "17:00", breakMinutes: 60, spansMidnight: false },
      { organizationId: orgs[1].id, code: "RECEIPT-REVIEW-B", name: "Fictional day",
        startTime: "10:00", endTime: "18:00", breakMinutes: 60, spansMidnight: false },
    ]).returning();
    const date = "2031-01-01";
    await db.insert(scheduleOverrides).values([
      { organizationId: orgs[0].id, employeeId: staff[0].id, workDate: date,
        kind: "shift", isRestDay: false, status: "approved",
        segments: [{ shiftDefinitionId: shifts[0].id, segmentOrder: 1 }],
        reason: "Fictional review", createdBy: "Synthetic fixture" },
      { organizationId: orgs[1].id, employeeId: staff[2].id, workDate: date,
        kind: "shift", isRestDay: false, status: "approved",
        segments: [{ shiftDefinitionId: shifts[1].id, segmentOrder: 1 }],
        reason: "Fictional review", createdBy: "Synthetic fixture" },
    ]);
    const hr = {
      managerUserId: accounts[2].id, organizationId: orgs[0].id,
      employeeId: staff[0].id,
    };
    const owner = { ...hr, managerUserId: accounts[3].id };
    const pending = await readManagerScheduleReceiptView(hr, () => date);
    assert.equal(pending.account, "ready");
    assert.equal(pending.days.length, 7);
    assert.equal(pending.days[0].state, "pending");
    assert.equal(pending.days[1].state, "unavailable");
    assert.equal(pending.summary?.pending, 1);
    assert.ok(!JSON.stringify(pending).includes("snapshotHash"));
    assert.ok(!JSON.stringify(pending).includes("basicRate"));
    assert.ok(!JSON.stringify(pending).includes(accounts[0].email));

    await assert.rejects(() => readManagerScheduleReceiptView({
      ...hr, employeeId: staff[1].id,
    }, () => date), (error: unknown) =>
      error instanceof ScheduleReceiptError && error.status === 403);
    await assert.rejects(() => readManagerScheduleReceiptView({
      ...hr, organizationId: orgs[1].id, employeeId: staff[2].id,
    }, () => date), (error: unknown) =>
      error instanceof ScheduleReceiptError && error.status === 403);

    const accountNotEnrolled = await readManagerScheduleReceiptView({
      ...owner, employeeId: staff[1].id,
    }, () => date);
    assert.equal(accountNotEnrolled.account, "not_enrolled");
    assert.equal(accountNotEnrolled.days.length, 0);
    assert.equal(accountNotEnrolled.summary, null);

    const who = { userId: accounts[0].id, organizationId: orgs[0].id, employeeId: staff[0].id };
    const self = await readScheduleReceiptView(who, date);
    await acknowledgeScheduleReceipt(who, {
      workDate: date, snapshotHash: self.days[0].snapshotHash, acknowledged: true,
    }, date);
    const received = await readManagerScheduleReceiptView(hr, () => date);
    assert.equal(received.days[0].state, "acknowledged");
    assert.ok(received.days[0].acknowledgedAt?.endsWith("Z"));
    assert.equal(received.summary?.acknowledged, 1);

    await db.update(shiftDefinitions).set({ startTime: "11:00" })
      .where(eq(shiftDefinitions.id, shifts[0].id));
    const changed = await readManagerScheduleReceiptView(hr, () => date);
    assert.equal(changed.days[0].state, "changed");
    assert.equal(changed.days[0].acknowledgedAt, null);
    assert.equal(changed.summary?.changed, 1);
    // Another employer's same-date receipt cannot change this review.
    assert.equal((await readManagerScheduleReceiptView({
      managerUserId: accounts[3].id, organizationId: orgs[0].id,
      employeeId: staff[0].id,
    }, () => date)).days[0].state, "changed");

    const [secondEss] = await db.insert(users).values({
      name: "Fictional duplicate employee identity",
      email: "manager-receipt-duplicate-" + marker + "@example.invalid",
      passwordHash: "fixture-no-login", role: "employee",
      active: true, employeeId: staff[0].id,
    }).returning();
    userIds.push(secondEss.id);
    await db.insert(userOrganizations).values({
      organizationId: orgs[0].id, userId: secondEss.id,
      role: "employee", active: true,
    });
    assert.equal((await readManagerScheduleReceiptView(hr, () => date)).account, "identity_review");
    await db.update(users).set({ active: false }).where(eq(users.id, secondEss.id));
    assert.equal((await readManagerScheduleReceiptView(hr, () => date)).account, "ready");

    await db.update(userOrganizations).set({ role: "payroll" }).where(and(
      eq(userOrganizations.userId, accounts[2].id),
      eq(userOrganizations.organizationId, orgs[0].id),
    ));
    await assert.rejects(() => readManagerScheduleReceiptView(hr, () => date), (error: unknown) =>
      error instanceof ScheduleReceiptError && error.status === 403);
  } finally {
    await db.delete(receipts).where(inArray(receipts.organizationId, orgs.map(org => org.id)));
    if (userIds.length) await db.delete(users).where(inArray(users.id, userIds));
    await db.delete(organizations).where(inArray(organizations.id, orgs.map(org => org.id)));
  }
});
