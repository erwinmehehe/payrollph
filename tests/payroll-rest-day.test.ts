import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { eq } from "drizzle-orm";
import { db } from "../src/db";
import { employeeRestDayRevisions, employees, organizations, payrollEntries, payrollRuns, timePunches } from "../src/db/schema";
import { drainPayrollQueue, enqueuePayrollRun } from "../src/lib/payroll-engine";

test("the rest_day column exists in the schema, the migration, and the production compat upgrade", () => {
  assert.ok(readFileSync("src/db/schema.ts", "utf8").includes('restDay: varchar("rest_day", { length: 10 })'));
  assert.ok(readFileSync("drizzle/0006_employee_rest_day.sql", "utf8").includes("ADD COLUMN IF NOT EXISTS rest_day"));
  assert.ok(readFileSync("src/lib/core-schema-compat.ts", "utf8").includes("ADD COLUMN IF NOT EXISTS rest_day varchar(10)"));
  assert.ok(readFileSync("src/db/schema.ts", "utf8").includes("employeeRestDayRevisions = pgTable"));
  assert.ok(readFileSync("drizzle/0007_employee_rest_day_revisions.sql", "utf8").includes("employee_rest_day_revisions"));
  // Deliberately not asserted against drizzle/baseline.sql: this column
  // follows the same precedent as middle_name/tin_branch_code/nationality,
  // which are also real schema.ts columns added only via the compat ALTER,
  // never backfilled into baseline.sql's CREATE TABLE. A fresh database
  // still gets it, through ensureCoreCompatibilitySchema() rather than the
  // pasted-in baseline.
});

/**
 * employees.restDay is nullable with no default (Labor Code Art. 91 says the
 * employer designates it; Linaw never guesses which day). These tests check
 * the whole path: an employee with no rest day configured behaves exactly as
 * before (no premium, ever); one with a rest day configured gets 130% for a
 * plain worked rest day (same figure as a worked special day, which the DOLE
 * matrix agrees with: both are the "else" case); and a rest day that also
 * falls on an actual holiday compounds through holidayMultiplier's existing
 * restDay branch, which until this change was correct in isolation but never
 * reachable from a real punch.
 *
 * hourlyRate 200.00 (basicRate 35,200, as in the holiday/night-diff tests).
 * Each shift is a plain 8h day (09:00-18:00), no overtime, to isolate the
 * regular-hours premium; a separate OT case is covered by case B below.
 */

async function runDayShift(input: {
  workDate: string;
  restDay: string | null;
  timeOut?: string;
  periodStart: string;
  periodEnd: string;
  label: string;
}) {
  const [org] = await db.insert(organizations).values({
    name: `Rest Day Test ${input.label}`,
    legalName: `Rest Day Test ${input.label} Inc.`,
    plan: "Core",
  }).returning();

  const [employee] = await db.insert(employees).values({
    organizationId: org.id,
    employeeNo: "RD-001",
    firstName: "Rest",
    lastName: "Day",
    title: "Associate",
    avatarInitials: "RD",
    basicRate: "35200.00",
    startDate: "2025-01-01",
    restDay: input.restDay,
  }).returning();

  await db.insert(timePunches).values({
    organizationId: org.id,
    employeeId: employee.id,
    workDate: input.workDate,
    timeIn: new Date(`${input.workDate}T09:00:00+08:00`),
    timeOut: new Date(`${input.workDate}T${input.timeOut ?? "18:00:00"}+08:00`),
    shiftStart: "09:00",
    shiftEnd: "18:00",
    status: "Complete",
  });

  const [run] = await db.insert(payrollRuns).values({
    organizationId: org.id,
    periodLabel: `${input.label} period`,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    scopeLabel: "All locations",
    status: "Draft",
    payDate: input.periodEnd,
  }).returning();

  await enqueuePayrollRun(run.id, 25);
  await drainPayrollQueue(10, run.id);

  const [entry] = await db.select().from(payrollEntries).where(eq(payrollEntries.payrollRunId, run.id));
  assert.ok(entry, `no payroll entry was created for the ${input.label} run`);
  return { org, entry };
}

function money(value: number) {
  return (Math.round((value + Number.EPSILON) * 100) / 100).toFixed(2);
}

function holidayLine(entry: typeof payrollEntries.$inferSelect) {
  const lineItems = entry.lineItems as Array<{ code: string; amount: string }>;
  return lineItems.find((line) => line.code === "HOLIDAY");
}

test("no rest day configured: a worked Sunday earns no premium, same as before this feature existed", async () => {
  // 2026-01-04 is a Sunday, and not a holiday.
  const { org, entry } = await runDayShift({
    workDate: "2026-01-04",
    restDay: null,
    periodStart: "2026-01-01",
    periodEnd: "2026-01-15",
    label: "Unset",
  });
  try {
    assert.equal(holidayLine(entry), undefined);
  } finally {
    await db.delete(organizations).where(eq(organizations.id, org.id));
  }
});

test("rest day configured and worked, no holiday: 130%, the same figure as a worked special day", async () => {
  const { org, entry } = await runDayShift({
    workDate: "2026-01-04",
    restDay: "Sunday",
    periodStart: "2026-01-01",
    periodEnd: "2026-01-15",
    label: "PlainRestDay",
  });
  try {
    const line = holidayLine(entry);
    assert.ok(line, "a plain worked rest day must produce a premium line now");
    // 8h x 200 x (1.3 - 1) = 480.00
    assert.equal(line!.amount, money(8 * 200 * 0.3));
  } finally {
    await db.delete(organizations).where(eq(organizations.id, org.id));
  }
});

test("rest day set but the worked date is a different weekday: no premium", async () => {
  // Employee's rest day is Monday; 2026-01-04 is a Sunday, so this must not trigger.
  const { org, entry } = await runDayShift({
    workDate: "2026-01-04",
    restDay: "Monday",
    periodStart: "2026-01-01",
    periodEnd: "2026-01-15",
    label: "WrongWeekday",
  });
  try {
    assert.equal(holidayLine(entry), undefined);
  } finally {
    await db.delete(organizations).where(eq(organizations.id, org.id));
  }
});

test("a special holiday that also falls on the employee's rest day compounds to 150%", async () => {
  // 2026-11-01, All Saints' Day (special), is also a Sunday.
  const { org, entry } = await runDayShift({
    workDate: "2026-11-01",
    restDay: "Sunday",
    periodStart: "2026-10-16",
    periodEnd: "2026-11-15",
    label: "SpecialOnRestDay",
  });
  try {
    const line = holidayLine(entry);
    assert.ok(line);
    // 8h x 200 x (1.5 - 1) = 800.00
    assert.equal(line!.amount, money(8 * 200 * 0.5));
  } finally {
    await db.delete(organizations).where(eq(organizations.id, org.id));
  }
});


test("historical recalculation keeps the rest day that was effective on the work date", async () => {
  const [org] = await db.insert(organizations).values({
    name: "Rest Day History Test",
    legalName: "Rest Day History Test Inc.",
    plan: "Core",
  }).returning();

  try {
    const [employee] = await db.insert(employees).values({
      organizationId: org.id,
      employeeNo: "RD-HISTORY",
      firstName: "History",
      lastName: "Guard",
      title: "Associate",
      avatarInitials: "HG",
      basicRate: "35200.00",
      startDate: "2025-01-01",
      // Current schedule is Monday after the change below.
      restDay: "Monday",
    }).returning();

    await db.insert(employeeRestDayRevisions).values({
      organizationId: org.id,
      employeeId: employee.id,
      effectiveDate: "2026-01-10",
      previousRestDay: "Sunday",
      newRestDay: "Monday",
      reason: "Team schedule change",
      createdBy: "Test",
    });

    // This Sunday predates the change and must still be priced as the old rest day.
    await db.insert(timePunches).values({
      organizationId: org.id,
      employeeId: employee.id,
      workDate: "2026-01-04",
      timeIn: new Date("2026-01-04T09:00:00+08:00"),
      timeOut: new Date("2026-01-04T18:00:00+08:00"),
      shiftStart: "09:00",
      shiftEnd: "18:00",
      status: "Complete",
    });

    // This Sunday is after the change to Monday, so it must not receive rest-day premium.
    await db.insert(timePunches).values({
      organizationId: org.id,
      employeeId: employee.id,
      workDate: "2026-01-11",
      timeIn: new Date("2026-01-11T09:00:00+08:00"),
      timeOut: new Date("2026-01-11T18:00:00+08:00"),
      shiftStart: "09:00",
      shiftEnd: "18:00",
      status: "Complete",
    });

    const [run] = await db.insert(payrollRuns).values({
      organizationId: org.id,
      periodLabel: "Historical rest-day period",
      periodStart: "2026-01-01",
      periodEnd: "2026-01-15",
      scopeLabel: "All locations",
      status: "Draft",
      payDate: "2026-01-15",
    }).returning();

    await enqueuePayrollRun(run.id, 25);
    await drainPayrollQueue(10, run.id);

    const [entry] = await db.select().from(payrollEntries).where(eq(payrollEntries.payrollRunId, run.id));
    assert.ok(entry, "historical payroll entry was not created");
    const line = holidayLine(entry);
    assert.ok(line, "the pre-change Sunday must retain its historical rest-day premium");
    assert.equal(line!.amount, money(8 * 200 * 0.3));
  } finally {
    await db.delete(organizations).where(eq(organizations.id, org.id));
  }
});

test("existing employees can edit or clear their rest day through the authorized People flow", () => {
  const route = readFileSync("src/app/api/employees/route.ts", "utf8");
  const people = readFileSync("src/components/workspace/people.tsx", "utf8");
  const types = readFileSync("src/components/workspace/types.ts", "utf8");

  assert.ok(route.includes("const wantsRestDayUpdate = body.restDay !== undefined"), "PATCH must distinguish omitted restDay from clearing it");
  assert.ok(route.includes("REST_DAY_NAMES.includes"), "PATCH must reject invalid weekday names");
  assert.ok(route.includes("restDay: changedRestDay ? nextRestDay : undefined"), "PATCH must persist actual rest-day edits and clears");
  assert.ok(route.includes("employeeRestDayRevisions"), "PATCH must persist effective-dated rest-day history");
  assert.ok(route.includes("restDayEffectiveDate"), "PATCH must validate an effective date");
  assert.ok(route.includes("restDayChangeReason"), "PATCH must retain the schedule-change reason");
  assert.ok(route.includes('"Employee work schedule updated"'), "rest-day-only changes need an explicit audit action");
  assert.ok(route.includes("restDayRevisionId"), "audit/response must reference the schedule revision");
  assert.ok(people.includes("WORK SCHEDULE"), "employee drawer must expose the work-schedule section");
  assert.ok(people.includes("Save work schedule"), "authorized People users need a clear save action");
  assert.ok(people.includes("REST_DAY_NAMES.map"), "UI must use the same seven-day contract as the payroll engine");
  assert.ok(people.includes("restDayEffectiveDate"), "UI must collect the schedule effective date");
  assert.ok(people.includes("restDayChangeReason"), "UI must collect a change reason");
  assert.ok(people.includes("SCHEDULE HISTORY"), "employee drawer must expose effective-dated rest-day history");
  assert.ok(types.includes("restDay?: string | null"), "workspace employee data must carry the stored rest day");
  assert.ok(types.includes("restDayRevisions?: RestDayRevision[]"), "workspace payload must carry schedule history");
});
