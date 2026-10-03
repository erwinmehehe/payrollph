import assert from "node:assert/strict";
import test from "node:test";
import { and, eq } from "drizzle-orm";
import { db } from "../src/db";
import {
  employeePayProfiles,
  employees,
  holidays,
  organizations,
  orgUnits,
  payrollEntries,
  payrollRuns,
  supplementaryEarnings,
  timePunches,
} from "../src/db/schema";
import { drainPayrollQueue, enqueuePayrollRun } from "../src/lib/payroll-engine";
import { settlePayrollRun } from "../src/lib/payroll-settlement";
import { isCanonicalPhSemiMonthlyPeriod, phSemiMonthlyCutoff } from "../src/lib/payroll-calendar";

function line(entry: typeof payrollEntries.$inferSelect, code: string) {
  const rows = Array.isArray(entry.lineItems)
    ? entry.lineItems as Array<{ code?: string; amount?: string | number }>
    : [];
  return rows.find((row) => row.code === code);
}

function traceValue(trace: unknown, key: string) {
  const inputs = trace && typeof trace === "object"
    ? (trace as { inputs?: unknown }).inputs
    : null;
  if (!Array.isArray(inputs)) return null;
  const raw = inputs.find((item) => typeof item === "string" && item.startsWith(`${key}=`));
  if (typeof raw !== "string") return null;
  const value = Number(raw.slice(key.length + 1));
  return Number.isFinite(value) ? value : null;
}

test("PH semi-monthly policy accepts only 1-15 and 16-end-of-month", () => {
  assert.equal(isCanonicalPhSemiMonthlyPeriod("2026-02-01", "2026-02-15"), true);
  assert.equal(isCanonicalPhSemiMonthlyPeriod("2026-02-16", "2026-02-28"), true);
  assert.equal(isCanonicalPhSemiMonthlyPeriod("2028-02-16", "2028-02-29"), true);
  assert.equal(isCanonicalPhSemiMonthlyPeriod("2026-10-01", "2026-10-15"), true);
  assert.equal(isCanonicalPhSemiMonthlyPeriod("2026-10-16", "2026-10-31"), true);
  assert.equal(isCanonicalPhSemiMonthlyPeriod("2026-10-10", "2026-10-25"), false);
  assert.equal(isCanonicalPhSemiMonthlyPeriod("2026-10-01", "2026-10-16"), false);
  assert.equal(isCanonicalPhSemiMonthlyPeriod("2026-10-16", "2026-11-01"), false);
  assert.equal(phSemiMonthlyCutoff("2026-10-01", "2026-10-15"), "first");
  assert.equal(phSemiMonthlyCutoff("2026-10-16", "2026-10-31"), "second");
});

test("org-unit local holiday changes pay only for employees in that unit", async () => {
  const [org] = await db.insert(organizations).values({
    name: "Scoped Holiday Audit",
    legalName: "Scoped Holiday Audit Inc.",
    plan: "Core",
  }).returning();

  try {
    const [unitA, unitB] = await db.insert(orgUnits).values([
      { organizationId: org.id, type: "location", name: "Pampanga", code: "PAM" },
      { organizationId: org.id, type: "location", name: "Cebu", code: "CEB" },
    ]).returning();
    const [departmentA, departmentB] = await db.insert(orgUnits).values([
      { organizationId: org.id, parentId: unitA.id, type: "department", name: "Pampanga Ops", code: "PAM-OPS" },
      { organizationId: org.id, parentId: unitB.id, type: "department", name: "Cebu Ops", code: "CEB-OPS" },
    ]).returning();

    const [employeeA, employeeB] = await db.insert(employees).values([
      {
        organizationId: org.id,
        orgUnitId: departmentA.id,
        employeeNo: "HOL-SCOPE-A",
        firstName: "Pampanga",
        lastName: "Employee",
        title: "Associate",
        avatarInitials: "PE",
        basicRate: "13200.00",
        restDay: "Sunday",
        startDate: "2025-01-01",
      },
      {
        organizationId: org.id,
        orgUnitId: departmentB.id,
        employeeNo: "HOL-SCOPE-B",
        firstName: "Cebu",
        lastName: "Employee",
        title: "Associate",
        avatarInitials: "CE",
        basicRate: "13200.00",
        restDay: "Sunday",
        startDate: "2025-01-01",
      },
    ]).returning();

    await db.insert(employeePayProfiles).values([
      {
        organizationId: org.id,
        employeeId: employeeA.id,
        payBasis: "daily",
        rateAmount: "600.00",
        standardWorkDaysPerMonth: "22",
        standardHoursPerDay: "8",
      },
      {
        organizationId: org.id,
        employeeId: employeeB.id,
        payBasis: "daily",
        rateAmount: "600.00",
        standardWorkDaysPerMonth: "22",
        standardHoursPerDay: "8",
      },
    ]);

    await db.insert(holidays).values({
      organizationId: org.id,
      orgUnitId: unitA.id,
      holidayDate: "2026-10-05",
      name: "Pampanga local special day",
      kind: "special",
    });

    await db.insert(timePunches).values([
      {
        organizationId: org.id,
        employeeId: employeeA.id,
        workDate: "2026-10-05",
        timeIn: new Date("2026-10-05T09:00:00+08:00"),
        timeOut: new Date("2026-10-05T18:00:00+08:00"),
        shiftStart: "09:00",
        shiftEnd: "18:00",
        status: "Complete",
      },
      {
        organizationId: org.id,
        employeeId: employeeB.id,
        workDate: "2026-10-05",
        timeIn: new Date("2026-10-05T09:00:00+08:00"),
        timeOut: new Date("2026-10-05T18:00:00+08:00"),
        shiftStart: "09:00",
        shiftEnd: "18:00",
        status: "Complete",
      },
    ]);

    const [run] = await db.insert(payrollRuns).values({
      organizationId: org.id,
      periodLabel: "Oct 1-15, 2026 local holiday audit",
      periodStart: "2026-10-01",
      periodEnd: "2026-10-15",
      scopeLabel: "All locations",
      status: "Draft",
      payDate: "2026-10-15",
    }).returning();

    await enqueuePayrollRun(run.id);
    await drainPayrollQueue(10, run.id);

    const entries = await db.select().from(payrollEntries).where(eq(payrollEntries.payrollRunId, run.id));
    const a = entries.find((entry) => entry.employeeId === employeeA.id)!;
    const b = entries.find((entry) => entry.employeeId === employeeB.id)!;

    assert.equal(Number(line(a, "HOLIDAY")?.amount), 180);
    assert.equal(line(b, "HOLIDAY"), undefined);
    assert.equal(Number(a.grossPay) - Number(b.grossPay), 180);
  } finally {
    await db.delete(organizations).where(eq(organizations.id, org.id));
  }
});

test("MWE commission is included in taxable supplementary compensation", async () => {
  const [org] = await db.insert(organizations).values({
    name: "MWE Supplementary Audit",
    legalName: "MWE Supplementary Audit Inc.",
    plan: "Core",
  }).returning();

  try {
    const [employee] = await db.insert(employees).values({
      organizationId: org.id,
      employeeNo: "MWE-COMM-001",
      firstName: "Commission",
      lastName: "MWE",
      title: "Associate",
      avatarInitials: "CM",
      basicRate: "15000.00",
      mwe: true,
      startDate: "2025-01-01",
    }).returning();

    const [earning] = await db.insert(supplementaryEarnings).values({
      organizationId: org.id,
      employeeId: employee.id,
      earningType: "commission",
      label: "Sales commission",
      amount: "20000.00",
      taxable: true,
      includeInSssBase: true,
      includeInPagIbigBase: true,
      effectiveDate: "2026-10-10",
      status: "approved",
      createdBy: "Audit",
    }).returning();

    const [run] = await db.insert(payrollRuns).values({
      organizationId: org.id,
      periodLabel: "Oct 1-15, 2026 MWE commission",
      periodStart: "2026-10-01",
      periodEnd: "2026-10-15",
      scopeLabel: "All locations",
      status: "Draft",
      payDate: "2026-10-15",
    }).returning();

    await enqueuePayrollRun(run.id);
    await drainPayrollQueue(10, run.id);

    const [entry] = await db.select().from(payrollEntries).where(eq(payrollEntries.payrollRunId, run.id));
    assert.ok(entry);
    assert.equal(Number(line(entry, `EARN-${earning.id}`)?.amount), 20000);
    assert.equal(traceValue(entry.trace, "supplementaryTaxable"), 20000);
    assert.equal(traceValue(entry.trace, "mweTaxableSupplementaryCompensation"), 20000);
    assert.ok((traceValue(entry.trace, "taxableCompensation") ?? 0) > 0);
  } finally {
    await db.delete(organizations).where(eq(organizations.id, org.id));
  }
});

test("supplementary earning settles atomically with payroll release", async () => {
  const [org] = await db.insert(organizations).values({
    name: "Supplementary Settlement Audit",
    legalName: "Supplementary Settlement Audit Inc.",
    plan: "Core",
  }).returning();

  try {
    const [employee] = await db.insert(employees).values({
      organizationId: org.id,
      employeeNo: "EARN-SETTLE-001",
      firstName: "Bonus",
      lastName: "Employee",
      title: "Associate",
      avatarInitials: "BE",
      basicRate: "20000.00",
      mobile: "09171234567",
      startDate: "2025-01-01",
    }).returning();

    const [earning] = await db.insert(supplementaryEarnings).values({
      organizationId: org.id,
      employeeId: employee.id,
      earningType: "bonus",
      label: "Performance bonus",
      amount: "2500.00",
      taxable: true,
      includeInSssBase: true,
      includeInPagIbigBase: true,
      effectiveDate: "2026-10-10",
      status: "approved",
      createdBy: "Audit",
    }).returning();

    const [run] = await db.insert(payrollRuns).values({
      organizationId: org.id,
      periodLabel: "Oct 1-15, 2026 earning settlement",
      periodStart: "2026-10-01",
      periodEnd: "2026-10-15",
      scopeLabel: "All locations",
      status: "Draft",
      payDate: "2026-10-15",
    }).returning();

    await enqueuePayrollRun(run.id);
    await drainPayrollQueue(10, run.id);
    await db.update(payrollRuns).set({ status: "Releasing" }).where(eq(payrollRuns.id, run.id));

    const result = await settlePayrollRun(run.id, {
      actor: "Audit",
      resource: run.periodLabel,
    });

    assert.equal(result.run.status, "Released");
    assert.equal(result.settlement.supplementaryEarningsSettled, 1);

    const [settled] = await db.select().from(supplementaryEarnings)
      .where(and(
        eq(supplementaryEarnings.id, earning.id),
        eq(supplementaryEarnings.organizationId, org.id),
      ));
    assert.equal(settled.status, "settled");
    assert.equal(settled.payrollRunId, run.id);
  } finally {
    await db.delete(organizations).where(eq(organizations.id, org.id));
  }
});


test("supplementary earning can affect SSS without changing Pag-IBIG base", async () => {
  const [org] = await db.insert(organizations).values({
    name: "Split Statutory Base Audit",
    legalName: "Split Statutory Base Audit Inc.",
    plan: "Core",
  }).returning();

  try {
    const [employee] = await db.insert(employees).values({
      organizationId: org.id,
      employeeNo: "BASE-SPLIT-001",
      firstName: "Split",
      lastName: "Base",
      title: "Associate",
      avatarInitials: "SB",
      basicRate: "12000.00",
      startDate: "2025-01-01",
    }).returning();

    await db.insert(supplementaryEarnings).values({
      organizationId: org.id,
      employeeId: employee.id,
      earningType: "commission",
      label: "SSS-only commission base",
      amount: "10000.00",
      taxable: true,
      includeInSssBase: true,
      includeInPagIbigBase: false,
      effectiveDate: "2026-10-10",
      status: "approved",
      createdBy: "Audit",
    });

    const [run] = await db.insert(payrollRuns).values({
      organizationId: org.id,
      periodLabel: "Oct 1-15, 2026 split base",
      periodStart: "2026-10-01",
      periodEnd: "2026-10-15",
      scopeLabel: "All locations",
      status: "Draft",
      payDate: "2026-10-15",
    }).returning();

    await enqueuePayrollRun(run.id);
    await drainPayrollQueue(10, run.id);

    const [entry] = await db.select().from(payrollEntries).where(eq(payrollEntries.payrollRunId, run.id));
    assert.ok(entry);

    const sssBase = traceValue(entry.trace, "statutoryMonthlySssCompensation");
    const pagIbigBase = traceValue(entry.trace, "statutoryMonthlyPagIbigCompensation");
    assert.ok(sssBase != null && pagIbigBase != null);
    assert.ok(sssBase! > pagIbigBase!, `expected SSS base > Pag-IBIG base, got ${sssBase} and ${pagIbigBase}`);
    assert.equal(traceValue(entry.trace, "supplementaryExcludedFromSssBase"), 0);
    assert.equal(traceValue(entry.trace, "supplementaryExcludedFromPagIbigBase"), 10000);
  } finally {
    await db.delete(organizations).where(eq(organizations.id, org.id));
  }
});
