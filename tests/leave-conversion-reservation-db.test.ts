import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { and, eq } from "drizzle-orm";
import { db } from "../src/db";
import { auditEvents, employees, leaveBalances, leaveConversions, leavePolicies, organizations } from "../src/db/schema";
import { leaveConversionAllowance } from "../src/lib/leave-conversion-policy";

test("two synthetic PostgreSQL reservations cannot overspend one locked annual leave balance", async () => {
  const year = Number(new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Manila", year: "numeric" }).format(new Date()));
  const [org] = await db.insert(organizations).values({
    name: `synthetic-leave-lock-${randomUUID()}`,
    legalName: "Synthetic leave conversion concurrency test",
    plan: "Core",
  }).returning({ id: organizations.id });
  try {
    const [worker] = await db.insert(employees).values({
      organizationId: org.id, employeeNo: `QA-${randomUUID().slice(0, 8)}`,
      firstName: "Synthetic", lastName: "Worker", title: "Staff",
      avatarInitials: "QA", basicRate: "22000.00", startDate: "2025-01-01",
    }).returning({ id: employees.id });
    await db.insert(leavePolicies).values({
      organizationId: org.id, leaveType: "Vacation leave",
      annualDays: "1.0", active: true,
    });
    await db.insert(leaveBalances).values({
      organizationId: org.id, employeeId: worker.id, leaveType: "Vacation leave",
      year, opening: "1.0", accrued: "0.0", used: "0.0", pending: "0.0",
    });

    // Exercise the same SELECT FOR UPDATE + reservation scan used in the route.
    // This proves PostgreSQL serialization, not public-route auth or live tax policy.
    const tryReserve = () => db.transaction(async (tx) => {
      const [balance] = await tx.select().from(leaveBalances).where(and(
        eq(leaveBalances.organizationId, org.id),
        eq(leaveBalances.employeeId, worker.id),
        eq(leaveBalances.leaveType, "Vacation leave"),
        eq(leaveBalances.year, year),
      )).for("update");
      assert.ok(balance);
      const prior = await tx.select().from(leaveConversions).where(and(
        eq(leaveConversions.organizationId, org.id),
        eq(leaveConversions.employeeId, worker.id),
      ));
      const reserved = prior.filter((item) => item.status !== "rejected").reduce(
        (total, item) => total + Number(item.daysConverted), 0,
      );
      const available = Number(balance.opening) + Number(balance.accrued)
        - Number(balance.used) - Number(balance.pending);
      const allowance = leaveConversionAllowance({
        available, reserved, alreadyConverted: reserved, policyAnnualDays: 1,
        approvedAnnualConversionCap: 1,
      });
      if (0.6 > allowance) return false;
      const [conversion] = await tx.insert(leaveConversions).values({
        organizationId: org.id, employeeId: worker.id,
        leaveType: "Vacation leave", daysConverted: "0.6",
        dailyRate: "1000.00", cashAmount: "600.00",
        taxExempt: false, status: "approved",
      }).returning({ id: leaveConversions.id });
      await tx.insert(auditEvents).values({
        organizationId: org.id, actor: "Synthetic test",
        action: "Leave credits approved for cash conversion",
        resource: "Synthetic reservation (no real payroll)",
        metadata: { conversionId: conversion.id, synthetic: true },
      });
      return true;
    });

    const results = await Promise.all([tryReserve(), tryReserve()]);
    assert.deepEqual(results.sort(), [false, true]);
    const conversions = await db.select().from(leaveConversions).where(and(
      eq(leaveConversions.organizationId, org.id),
      eq(leaveConversions.employeeId, worker.id),
    ));
    assert.equal(conversions.length, 1);
    assert.equal(Number(conversions[0].daysConverted), 0.6);
    const receipts = await db.select().from(auditEvents).where(eq(auditEvents.organizationId, org.id));
    assert.equal(receipts.filter((row) => row.action === "Leave credits approved for cash conversion").length, 1);
  } finally {
    await db.delete(organizations).where(eq(organizations.id, org.id));
  }
});

test("leave conversion application holds employee, policy and balance rows through the same write", () => {
  const source = readFileSync("src/app/api/leave/conversion/route.ts", "utf8");
  const txStart = source.indexOf("const result = await db.transaction(async (tx) => {");
  const txEnd = source.indexOf('return { created } as const;', txStart);
  assert.ok(txStart >= 0 && txEnd > txStart);
  const transaction = source.slice(txStart, txEnd);
  assert.ok(transaction.includes('const [lockedEmployee] = await tx.select().from(employees)'));
  assert.ok(transaction.includes('Number(lockedEmployee.basicRate)'));
  assert.ok((transaction.match(/\.for\("share"\)/g) ?? []).length >= 2);
  assert.ok(transaction.includes('.for("update")'));
  assert.ok(transaction.includes("tx.insert(leaveConversions)"));
  assert.ok(transaction.includes("tx.insert(auditEvents)"));
});
