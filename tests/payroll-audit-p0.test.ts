import assert from "node:assert/strict";
import test from "node:test";
import { eq } from "drizzle-orm";
import { db } from "../src/db";
import {
  earnedWageRequests,
  employeePayProfiles,
  employees,
  leaveConversions,
  organizations,
  payrollEntries,
  payrollRuns,
  timePunches,
} from "../src/db/schema";
import { drainPayrollQueue, enqueuePayrollRun } from "../src/lib/payroll-engine";

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

function line(entry: typeof payrollEntries.$inferSelect, code: string) {
  const items = Array.isArray(entry.lineItems)
    ? entry.lineItems as Array<{ code?: string; amount?: string | number; notes?: string[] }>
    : [];
  return items.find((item) => item.code === code);
}

test("MWE taxable supplementary compensation ignores voluntary Pag-IBIG", async () => {
  const [org] = await db.insert(organizations).values({
    name: "Audit MWE Voluntary HDMF",
    legalName: "Audit MWE Voluntary HDMF Inc.",
    plan: "Core",
  }).returning();

  try {
    const [employee] = await db.insert(employees).values({
      organizationId: org.id,
      employeeNo: "AUD-MWE-001",
      firstName: "MWE",
      lastName: "Tester",
      title: "Associate",
      avatarInitials: "MT",
      basicRate: "15000.00",
      mwe: true,
      pagIbigVoluntaryMonthly: "2000.00",
      startDate: "2025-01-01",
    }).returning();

    await db.insert(leaveConversions).values({
      organizationId: org.id,
      employeeId: employee.id,
      leaveType: "Taxable conversion",
      daysConverted: "10",
      dailyRate: "5000.00",
      cashAmount: "50000.00",
      taxExempt: false,
      status: "approved",
    });

    const [run] = await db.insert(payrollRuns).values({
      organizationId: org.id,
      periodLabel: "Sep 1-15, 2026 MWE audit",
      periodStart: "2026-09-01",
      periodEnd: "2026-09-15",
      scopeLabel: "All locations",
      status: "Draft",
      payDate: "2026-09-15",
    }).returning();

    await enqueuePayrollRun(run.id);
    await drainPayrollQueue(10, run.id);

    const [entry] = await db.select().from(payrollEntries).where(eq(payrollEntries.payrollRunId, run.id));
    assert.ok(entry);
    const taxable = traceValue(entry.trace, "taxableCompensation");
    const supplementary = traceValue(entry.trace, "mweTaxableSupplementaryCompensation");
    assert.ok(taxable != null && supplementary != null);

    const mandatory =
      Math.abs(Number(line(entry, "SSS")?.amount ?? 0))
      + Math.abs(Number(line(entry, "PHIC")?.amount ?? 0))
      + Math.abs(Number(line(entry, "HDMF")?.amount ?? 0));
    const voluntary = Math.abs(Number(line(entry, "HDMF_VOL")?.amount ?? 0));

    assert.ok(voluntary > 0);
    assert.equal(Number((taxable! + mandatory).toFixed(2)), Number(supplementary!.toFixed(2)));
  } finally {
    await db.delete(organizations).where(eq(organizations.id, org.id));
  }
});

test("daily employee holiday pay requires proven preceding scheduled workday across cutoffs", async () => {
  const [org] = await db.insert(organizations).values({
    name: "Audit Holiday Eligibility",
    legalName: "Audit Holiday Eligibility Inc.",
    plan: "Core",
  }).returning();

  try {
    const [eligible, unresolved] = await db.insert(employees).values([
      {
        organizationId: org.id,
        employeeNo: "AUD-HOL-001",
        firstName: "Eligible",
        lastName: "Daily",
        title: "Associate",
        avatarInitials: "ED",
        basicRate: "13200.00",
        restDay: "Wednesday",
        startDate: "2025-01-01",
      },
      {
        organizationId: org.id,
        employeeNo: "AUD-HOL-002",
        firstName: "Unresolved",
        lastName: "Daily",
        title: "Associate",
        avatarInitials: "UD",
        basicRate: "13200.00",
        restDay: "Wednesday",
        startDate: "2025-01-01",
      },
    ]).returning();

    await db.insert(employeePayProfiles).values([
      {
        organizationId: org.id,
        employeeId: eligible.id,
        payBasis: "daily",
        rateAmount: "600.00",
        standardWorkDaysPerMonth: "22",
        standardHoursPerDay: "8",
      },
      {
        organizationId: org.id,
        employeeId: unresolved.id,
        payBasis: "daily",
        rateAmount: "600.00",
        standardWorkDaysPerMonth: "22",
        standardHoursPerDay: "8",
      },
    ]);

    await db.insert(timePunches).values({
      organizationId: org.id,
      employeeId: eligible.id,
      workDate: "2026-03-31",
      timeIn: new Date("2026-03-31T09:00:00+08:00"),
      timeOut: new Date("2026-03-31T18:00:00+08:00"),
      shiftStart: "09:00",
      shiftEnd: "18:00",
      status: "Complete",
    });

    const [run] = await db.insert(payrollRuns).values({
      organizationId: org.id,
      periodLabel: "Apr 2-15, 2026 holiday audit",
      periodStart: "2026-04-02",
      periodEnd: "2026-04-15",
      scopeLabel: "All locations",
      status: "Draft",
      payDate: "2026-04-15",
    }).returning();

    await enqueuePayrollRun(run.id);
    await drainPayrollQueue(10, run.id);

    const entries = await db.select().from(payrollEntries).where(eq(payrollEntries.payrollRunId, run.id));
    const eligibleEntry = entries.find((entry) => entry.employeeId === eligible.id)!;
    const unresolvedEntry = entries.find((entry) => entry.employeeId === unresolved.id)!;

    const eligibleHolidayLine = line(eligibleEntry, "HOLIDAY_UNWORKED");
    assert.ok(
      eligibleHolidayLine,
      `expected holiday entitlement; lineItems=${JSON.stringify(eligibleEntry.lineItems)} trace=${JSON.stringify(eligibleEntry.trace)}`,
    );
    // Apr 2 (Maundy Thursday) and Apr 3 (Good Friday) are both regular
    // holidays and share the same proven Mar 31 preceding scheduled workday.
    assert.equal(Number(eligibleHolidayLine.amount), 1200);
    assert.equal(line(unresolvedEntry, "HOLIDAY_UNWORKED"), undefined);
    assert.equal(unresolvedEntry.status, "Exception");
    const flags = (unresolvedEntry.trace as { flags?: string[] }).flags ?? [];
    assert.ok(flags.some((flag) => flag.includes("eligibility") && flag.includes("2026-03-31")));
  } finally {
    await db.delete(organizations).where(eq(organizations.id, org.id));
  }
});

test("insufficient disposable pay defers EWA recovery instead of collecting it", async () => {
  const [org] = await db.insert(organizations).values({
    name: "Audit EWA Shortfall",
    legalName: "Audit EWA Shortfall Inc.",
    plan: "Core",
  }).returning();

  try {
    const [employee] = await db.insert(employees).values({
      organizationId: org.id,
      employeeNo: "AUD-EWA-001",
      firstName: "Advance",
      lastName: "Shortfall",
      title: "Associate",
      avatarInitials: "AS",
      basicRate: "10000.00",
      startDate: "2025-01-01",
    }).returning();

    const [advance] = await db.insert(earnedWageRequests).values({
      organizationId: org.id,
      employeeId: employee.id,
      requestedAmount: "9000.00",
      fee: "0.00",
      status: "approved",
    }).returning();

    const [run] = await db.insert(payrollRuns).values({
      organizationId: org.id,
      periodLabel: "Sep 1-15, 2026 EWA audit",
      periodStart: "2026-09-01",
      periodEnd: "2026-09-15",
      scopeLabel: "All locations",
      status: "Draft",
      payDate: "2026-09-15",
    }).returning();

    await enqueuePayrollRun(run.id);
    await drainPayrollQueue(10, run.id);

    const [entry] = await db.select().from(payrollEntries).where(eq(payrollEntries.payrollRunId, run.id));
    assert.ok(entry);
    assert.equal(line(entry, `EWA-${advance.id}`), undefined);
    assert.equal(entry.status, "Exception");

    const [freshAdvance] = await db.select().from(earnedWageRequests).where(eq(earnedWageRequests.id, advance.id));
    assert.equal(freshAdvance.status, "approved");
    assert.equal(freshAdvance.payrollRunId, null);

    const flags = (entry.trace as { flags?: string[] }).flags ?? [];
    assert.ok(flags.some((flag) => flag.includes("advance remains outstanding")));
  } finally {
    await db.delete(organizations).where(eq(organizations.id, org.id));
  }
});
