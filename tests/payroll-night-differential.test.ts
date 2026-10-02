import assert from "node:assert/strict";
import test from "node:test";
import { eq } from "drizzle-orm";
import { db } from "../src/db";
import { employees, organizations, payrollEntries, payrollRuns, timePunches } from "../src/db/schema";
import { drainPayrollQueue, enqueuePayrollRun } from "../src/lib/payroll-engine";

/**
 * Night differential is +10% of whatever that minute otherwise earns, not a
 * flat +10% of the plain hourly rate (DOLE Handbook: regular-holiday night =
 * 220% = 200% x 1.10, not 200% + 10%). This checks the fix compounds night
 * pay with the day's premium AND, separately, with the OT factor for the
 * portion of night minutes that are also overtime.
 *
 * Each employee is monthly-paid with basicRate 35,200 -> hourlyRate exactly
 * 200.00, as in payroll-holiday-overtime.test.ts, for clean expected pesos.
 * The shift (14:00-23:00, worked to 01:00) is chosen so the night window
 * splits cleanly: 1h regular-night (22:00-23:00) and 2h overtime-night
 * (23:00-01:00), confirmed directly in tests/payroll-rules.test.ts.
 */

async function runEveningShift(workDate: string, periodStart: string, periodEnd: string, label: string) {
  const [org] = await db.insert(organizations).values({
    name: `Night Diff Test ${label}`,
    legalName: `Night Diff Test ${label} Inc.`,
    plan: "Core",
  }).returning();

  const [employee] = await db.insert(employees).values({
    organizationId: org.id,
    employeeNo: "ND-001",
    firstName: "Night",
    lastName: "Worker",
    title: "Associate",
    avatarInitials: "NW",
    basicRate: "35200.00",
    startDate: "2025-01-01",
  }).returning();

  // Pure UTC-based date arithmetic, independent of the host process's own
  // timezone (unlike using a local Date's getDate/setDate on an instant built
  // from a "+08:00" string, which would shift the calendar day incorrectly
  // whenever the host isn't itself in that zone).
  const [y, m, d] = workDate.split("-").map(Number);
  const nextDayDate = new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);

  await db.insert(timePunches).values({
    organizationId: org.id,
    employeeId: employee.id,
    workDate,
    timeIn: new Date(`${workDate}T14:00:00+08:00`),
    timeOut: new Date(`${nextDayDate}T01:00:00+08:00`),
    shiftStart: "14:00",
    shiftEnd: "23:00",
    status: "Complete",
  });

  const [run] = await db.insert(payrollRuns).values({
    organizationId: org.id,
    periodLabel: `${label} period`,
    periodStart,
    periodEnd,
    scopeLabel: "All locations",
    status: "Draft",
    payDate: periodEnd,
  }).returning();

  await enqueuePayrollRun(run.id, 25);
  await drainPayrollQueue(10, run.id);

  const [entry] = await db.select().from(payrollEntries).where(eq(payrollEntries.payrollRunId, run.id));
  assert.ok(entry, `no payroll entry was created for the ${label} run`);
  return { org, entry };
}

function money(value: number) {
  return (Math.round((value + Number.EPSILON) * 100) / 100).toFixed(2);
}

function nightDiffAmount(entry: typeof payrollEntries.$inferSelect) {
  const lineItems = entry.lineItems as Array<{ code: string; amount: string }>;
  const nd = lineItems.find((line) => line.code === "ND");
  assert.ok(nd, "a night-differential line item must exist when night minutes were worked");
  return nd!.amount;
}

test("night differential on a regular holiday compounds with both the holiday and the OT rate", async () => {
  const { org, entry } = await runEveningShift("2026-01-01", "2026-01-01", "2026-01-15", "RegularHoliday");
  try {
    // 1h regular-night at 200% (holiday) x 1.10: extra = 1h x 200 x 2.0 x 0.10 = 40.00
    // 2h OT-night at 260% (holiday OT) x 1.10:  extra = 2h x 200 x 2.6 x 0.10 = 104.00
    assert.equal(nightDiffAmount(entry), money(40 + 104));
  } finally {
    await db.delete(organizations).where(eq(organizations.id, org.id));
  }
});

test("night differential on an ordinary day also compounds with the OT rate for its overtime portion", async () => {
  const { org, entry } = await runEveningShift("2026-01-03", "2026-01-01", "2026-01-15", "OrdinaryDay");
  try {
    // 1h regular-night at 100% x 1.10:        extra = 1h x 200 x 1.0  x 0.10 = 20.00
    // 2h OT-night at 125% (ordinary OT) x 1.10: extra = 2h x 200 x 1.25 x 0.10 = 50.00
    // The old flat "+10% of hourly rate regardless of OT" computation would
    // have given 1h x 20 + 2h x 20 = 60.00 here, 10 pesos short: even a plain
    // ordinary day was underpaid whenever overtime and night hours overlapped.
    assert.equal(nightDiffAmount(entry), money(20 + 50));
  } finally {
    await db.delete(organizations).where(eq(organizations.id, org.id));
  }
});
