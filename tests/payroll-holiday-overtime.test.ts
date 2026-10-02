import assert from "node:assert/strict";
import test from "node:test";
import { eq } from "drizzle-orm";
import { db } from "../src/db";
import { employees, organizations, payrollEntries, payrollRuns, timePunches } from "../src/db/schema";
import { drainPayrollQueue, enqueuePayrollRun } from "../src/lib/payroll-engine";

/**
 * Overtime worked on a holiday must be paid at that day's compounded OT rate
 * (Labor Code Art. 87: +25% ordinary, +30% on a rest day / special day /
 * holiday, applied to the day's own premium rate), not a flat 125% regardless
 * of day type. This also checks the regular (non-OT) hours of the same shift
 * are not accidentally bumped to the OT rate, which is what the bug did
 * before this fix: any overtime that day inflated the multiplier applied to
 * the REGULAR hours too, while the actual OT hours stayed flat at 125%.
 *
 * Each employee here is monthly-paid with basicRate 35,200 -> hourlyRate
 * exactly 200.00 (35200 / 22 days / 8 hours), chosen so the expected pesos
 * are clean. Monthly basic pay comes from the prorated salary, not from
 * worked minutes, so the OT and HOLIDAY line items below are the complete,
 * isolated effect of this fix with nothing else to subtract out.
 */

type Expect = { otMultiplier: number; regularMultiplier: number | null };

async function runOneShiftWithOvertime(workDate: string, periodStart: string, periodEnd: string, label: string) {
  const [org] = await db.insert(organizations).values({
    name: `Holiday OT Test ${label}`,
    legalName: `Holiday OT Test ${label} Inc.`,
    plan: "Core",
  }).returning();

  const [employee] = await db.insert(employees).values({
    organizationId: org.id,
    employeeNo: "HOT-001",
    firstName: "Overtime",
    lastName: "Worker",
    title: "Associate",
    avatarInitials: "OW",
    basicRate: "35200.00",
    startDate: "2025-01-01",
  }).returning();

  await db.insert(timePunches).values({
    organizationId: org.id,
    employeeId: employee.id,
    workDate,
    // 09:00-20:00 on an 09:00-18:00 shift: 11h gross - 60min break = 10h
    // worked, 2h (120min) of it beyond the 18:00 shift end = overtime, so
    // workedRegular = 8h and overtimeMinutes = 2h. 20:00 end keeps this clear
    // of the 22:00-06:00 night-differential window.
    timeIn: new Date(`${workDate}T09:00:00+08:00`),
    timeOut: new Date(`${workDate}T20:00:00+08:00`),
    shiftStart: "09:00",
    shiftEnd: "18:00",
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

function assertLines(
  entry: typeof payrollEntries.$inferSelect,
  hourlyRate: number,
  { otMultiplier, regularMultiplier }: Expect,
) {
  const lineItems = entry.lineItems as Array<{ code: string; label: string; amount: string }>;
  const ot = lineItems.find((line) => line.code === "OT");
  assert.ok(ot, "an OT line item must exist when overtime was worked");
  assert.equal(ot!.amount, money(2 * hourlyRate * otMultiplier), `OT pay at x${otMultiplier}`);
  assert.equal(ot!.label, "Overtime", "the label must not claim a fixed rate that is no longer always true");

  const holiday = lineItems.find((line) => line.code === "HOLIDAY");
  if (regularMultiplier === null) {
    assert.equal(holiday, undefined, "no holiday premium on an ordinary day");
  } else {
    assert.ok(holiday, "a HOLIDAY line item must exist for the regular hours' premium");
    assert.equal(holiday!.amount, money(8 * hourlyRate * (regularMultiplier - 1)), `regular-hours premium at x${regularMultiplier}`);
  }
}

test("overtime worked on a regular holiday is paid at 260%, not 125%, and the regular hours stay at 200%, not 260%", async () => {
  const { org, entry } = await runOneShiftWithOvertime("2026-01-01", "2026-01-01", "2026-01-15", "RegularHoliday");
  try {
    assertLines(entry, 200, { otMultiplier: 2.6, regularMultiplier: 2 });
  } finally {
    await db.delete(organizations).where(eq(organizations.id, org.id));
  }
});

test("overtime worked on a special non-working day is paid at 169%, not 125%", async () => {
  const { org, entry } = await runOneShiftWithOvertime("2026-02-17", "2026-02-16", "2026-02-28", "SpecialDay");
  try {
    assertLines(entry, 200, { otMultiplier: 1.69, regularMultiplier: 1.3 });
  } finally {
    await db.delete(organizations).where(eq(organizations.id, org.id));
  }
});

test("overtime worked on an ordinary day is still paid at the unchanged 125%, and no holiday line appears", async () => {
  const { org, entry } = await runOneShiftWithOvertime("2026-01-05", "2026-01-01", "2026-01-15", "OrdinaryDay");
  try {
    assertLines(entry, 200, { otMultiplier: 1.25, regularMultiplier: null });
  } finally {
    await db.delete(organizations).where(eq(organizations.id, org.id));
  }
});
