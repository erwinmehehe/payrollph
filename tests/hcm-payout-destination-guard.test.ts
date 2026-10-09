import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { eq } from "drizzle-orm";
import { db } from "../src/db";
import { employees, organizations, payrollEntries, payrollRuns } from "../src/db/schema";
import {
  employeeHasPayrollRegisterEntry,
  legacyPayoutChangeBlockReason,
  payoutHistoryUnderLockQuery,
  REVIEWED_PAYOUT_DESTINATION_REQUIRED,
} from "../src/lib/hcm-payout-destination-guard";

test("workers in any payroll register require independent review even before release", () => {
  assert.equal(legacyPayoutChangeBlockReason({
    treasuryEnabled: false, hasPayrollRegisterEntry: true, companyWide: true, role: "owner",
  }), "review_required");
  assert.equal(legacyPayoutChangeBlockReason({
    treasuryEnabled: false, hasPayrollRegisterEntry: true, companyWide: true, role: "admin",
  }), "review_required");
  assert.equal(legacyPayoutChangeBlockReason({
    treasuryEnabled: false, hasPayrollRegisterEntry: false, companyWide: false, role: "hr",
  }), "role_required");
  assert.equal(legacyPayoutChangeBlockReason({
    treasuryEnabled: false, hasPayrollRegisterEntry: false, companyWide: true, role: "hr",
  }), "role_required");
  assert.equal(legacyPayoutChangeBlockReason({
    treasuryEnabled: false, hasPayrollRegisterEntry: false, companyWide: true, role: "bookkeeper",
  }), "role_required");
  assert.equal(legacyPayoutChangeBlockReason({
    treasuryEnabled: false, hasPayrollRegisterEntry: false, companyWide: true, role: "owner",
  }), null);
  assert.equal(legacyPayoutChangeBlockReason({
    treasuryEnabled: false, hasPayrollRegisterEntry: false, companyWide: true, role: "admin",
  }), null);
  assert.equal(legacyPayoutChangeBlockReason({
    treasuryEnabled: true, hasPayrollRegisterEntry: true, companyWide: false, role: "hr",
  }), null, "Treasury approval-request path uses the existing independent checker");
  assert.equal(REVIEWED_PAYOUT_DESTINATION_REQUIRED.code, "PAYOUT_DESTINATION_REVIEW_REQUIRED");
});

test("history query fails closed for invalid organization or employee identifiers", () => {
  assert.throws(() => payoutHistoryUnderLockQuery(0, 1), /Valid organization and employee/);
  assert.throws(() => payoutHistoryUnderLockQuery(1, -1), /Valid organization and employee/);
  assert.throws(() => payoutHistoryUnderLockQuery(Number.NaN, 1), /Valid organization and employee/);
});

test("tenant-scoped worker history identifies any posted payroll entry, including Draft", async () => {
  const suffix = randomUUID().slice(0, 8);
  const [alpha, beta] = await db.insert(organizations).values([
    { name: `Payout guard alpha ${suffix}`, legalName: "Payout guard alpha", plan: "Core" },
    { name: `Payout guard beta ${suffix}`, legalName: "Payout guard beta", plan: "Core" },
  ]).returning();
  try {
    const [paidWorker, draftWorker, betaWorker] = await db.insert(employees).values([
      {
        organizationId: alpha.id, employeeNo: `PGA-${suffix}`,
        firstName: "Mila", lastName: "Cruz", title: "Staff",
        avatarInitials: "MC", basicRate: "25000.00", startDate: "2025-01-01",
      },
      {
        organizationId: alpha.id, employeeNo: `PGB-${suffix}`,
        firstName: "Nilo", lastName: "Reyes", title: "Staff",
        avatarInitials: "NR", basicRate: "26000.00", startDate: "2025-01-01",
      },
      {
        organizationId: beta.id, employeeNo: `PGA-${suffix}`,
        firstName: "Neri", lastName: "Santos", title: "Staff",
        avatarInitials: "NS", basicRate: "27000.00", startDate: "2025-01-01",
      },
    ]).returning();
    const [releasedRun, draftRun] = await db.insert(payrollRuns).values([
      {
        organizationId: alpha.id, periodLabel: "Historical paid worker",
        periodStart: "2026-07-01", periodEnd: "2026-07-15",
        payDate: "2026-07-15", status: "Released",
      },
      {
        organizationId: alpha.id, periodLabel: "Uncalculated draft worker",
        periodStart: "2026-08-01", periodEnd: "2026-08-15",
        payDate: "2026-08-15", status: "Draft",
      },
    ]).returning();
    await db.insert(payrollEntries).values([
      {
        payrollRunId: releasedRun.id, employeeId: paidWorker.id,
        grossPay: "25000.00", deductions: "2400.00", netPay: "22600.00",
      },
      {
        payrollRunId: draftRun.id, employeeId: draftWorker.id,
        grossPay: "26000.00", deductions: "2500.00", netPay: "23500.00",
      },
    ]);

    assert.equal(await employeeHasPayrollRegisterEntry(alpha.id, paidWorker.id), true);
    assert.equal(await employeeHasPayrollRegisterEntry(alpha.id, draftWorker.id), true);
    assert.equal(await employeeHasPayrollRegisterEntry(beta.id, betaWorker.id), false);
    // A guessed cross-tenant employee ID cannot probe another employer's
    // released worker register through the organization-scoped query.
    assert.equal(await employeeHasPayrollRegisterEntry(beta.id, paidWorker.id), false);
    const statuses = await db.transaction(async tx => tx.execute(
      payoutHistoryUnderLockQuery(alpha.id, paidWorker.id),
    ));
    assert.ok(statuses.rows.some(row => row.status === "Released"));
    const draftStatuses = await db.transaction(async tx => tx.execute(
      payoutHistoryUnderLockQuery(alpha.id, draftWorker.id),
    ));
    assert.ok(draftStatuses.rows.some(row => row.status === "Draft"));
    assert.ok(draftStatuses.rows.every(row => row.status !== "Released"));
  } finally {
    await db.delete(organizations).where(eq(organizations.id, alpha.id));
    await db.delete(organizations).where(eq(organizations.id, beta.id));
  }
});

test("employee payout PATCH restricts legacy changes and commits audited pre-first-pay setup", () => {
  const source = readFileSync("src/app/api/employees/route.ts", "utf8");
  const ui = readFileSync("src/components/workspace/people.tsx", "utf8");
  assert.ok(source.includes("employeeHasPayrollRegisterEntry(organizationId, employeeId)"));
  assert.ok(source.includes("legacyPayoutChangeBlockReason"));
  assert.ok(source.includes("REVIEWED_PAYOUT_DESTINATION_REQUIRED"));
  assert.ok(source.includes("PAYOUT_DESTINATION_COMPANY_OWNER_REQUIRED"));
  assert.ok(source.includes("PAYOUT_DESTINATION_SEPARATE_CHANGE_REQUIRED"));
  assert.ok(source.includes("requireSensitiveActionMfa(user)"));
  assert.ok(source.includes("payoutHistoryUnderLockQuery(organizationId, employeeId)"));
  assert.ok(source.includes("if (lockedHistory.rows.length > 0)"));
  assert.ok(source.includes("FOR UPDATE"));
  const guard = readFileSync("src/lib/hcm-payout-destination-guard.ts", "utf8");
  assert.ok(guard.includes("FOR SHARE OF pr"));
  assert.ok(source.includes("PAYOUT_DESTINATION_STALE"));
  assert.ok(source.includes("PAYOUT_DESTINATION_POLICY_CHANGED"));
  assert.ok(source.includes("tx.insert(auditEvents)"));
  assert.ok(source.includes("const audit = result.payoutAuditId"));
  assert.ok(source.includes("existingPayrollRegisterRecheckedUnderLock: true"));
  assert.ok(!source.includes("previousMobile: employee.mobile"));
  assert.ok(!source.includes("newMobile: updated.mobile"));
  assert.ok(ui.includes("appears in any payroll register"));
});
