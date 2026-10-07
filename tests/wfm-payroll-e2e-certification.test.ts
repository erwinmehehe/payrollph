import assert from "node:assert/strict";
import test from "node:test";
import { eq } from "drizzle-orm";
import { db } from "../src/db";
import {
  employees,
  organizations,
  payrollEntries,
  payrollRuns,
  timePunches,
} from "../src/db/schema";
import {
  attendancePunchSnapshot,
  normalizeAttendanceCorrection,
  punchStatusAfterCorrection,
} from "../src/lib/workforce-attendance-correction";
import {
  matchPunchesToWorkforceSegments,
  segmentPayableTime,
} from "../src/lib/workforce-payroll";
import { evaluateTimesheetPayrollGate } from "../src/lib/workforce-timesheet";
import { drainPayrollQueue, enqueuePayrollRun } from "../src/lib/payroll-engine";
import type { ResolvedDailySchedule } from "../src/lib/workforce-scheduling";

function traceValue(trace: unknown, key: string) {
  const inputs = trace && typeof trace === "object"
    ? (trace as { inputs?: unknown }).inputs
    : null;
  if (!Array.isArray(inputs)) return null;
  const prefix = `${key}=`;
  const row = inputs.find((value) => typeof value === "string" && value.startsWith(prefix));
  if (typeof row !== "string") return null;
  return row.slice(prefix.length);
}

test("WFM certification: governed correction and approved timesheet evidence reaches payroll", async () => {
  const schedule: ResolvedDailySchedule = {
    date: "2026-10-05",
    source: "pattern",
    isRestDay: false,
    assignmentId: 11,
    patternId: 21,
    patternDayIndex: 0,
    overrideId: null,
    workLocationOrgUnitId: null,
    worksiteId: null,
    segments: [{
      shiftDefinitionId: 31,
      shiftCode: "DAY",
      shiftName: "Day",
      segmentOrder: 1,
      startTime: "09:00",
      endTime: "18:00",
      breakMinutes: 60,
      spansMidnight: false,
    }],
    audit: [],
  };

  const original = attendancePunchSnapshot({
    workDate: "2026-10-05",
    timeIn: "2026-10-05T09:20:00+08:00",
    timeOut: "2026-10-05T17:00:00+08:00",
    status: "Complete",
  });
  const corrected = normalizeAttendanceCorrection({
    original,
    proposedTimeIn: "2026-10-05T09:00:00+08:00",
    proposedTimeOut: "2026-10-05T18:00:00+08:00",
    proposedBreakStart: "2026-10-05T12:00:00+08:00",
    proposedBreakEnd: "2026-10-05T13:00:00+08:00",
  });
  assert.equal(punchStatusAfterCorrection(corrected), "Corrected");

  const mapping = matchPunchesToWorkforceSegments({
    date: schedule.date,
    schedule,
    punches: [{ id: 1, timeIn: corrected.timeIn }],
  });
  assert.equal(mapping.exception, null);
  assert.equal(mapping.segmentByPunchId.get(1)?.shiftCode, "DAY");

  const segmented = segmentPayableTime({
    punch: {
      id: 1,
      workDate: corrected.workDate,
      timeIn: corrected.timeIn,
      timeOut: corrected.timeOut,
      breakStart: corrected.breakStart,
      breakEnd: corrected.breakEnd,
    },
    shift: { start: "09:00", end: "18:00", breakMinutes: 60 },
  });
  assert.equal(segmented.allocationComplete, true);
  assert.equal(segmented.segments.reduce((sum, row) => sum + row.minutes, 0), 480);

  const gate = evaluateTimesheetPayrollGate({
    policy: { active: true, enforcementMode: "block" },
    employeeIds: [1],
    latestTimesheets: [{ employeeId: 1, status: "approved", version: 2 }],
  });
  assert.equal(gate.allowed, true);
  assert.equal(gate.blocking, false);

  const [org] = await db.insert(organizations).values({
    name: "WFM Payroll E2E Certification",
    legalName: "WFM Payroll E2E Certification Inc.",
    plan: "Core",
  }).returning();

  try {
    const [employee] = await db.insert(employees).values({
      organizationId: org.id,
      employeeNo: "WFM-E2E-001",
      firstName: "WFM",
      lastName: "Certified",
      title: "Operations Associate",
      avatarInitials: "WC",
      basicRate: "30000.00",
      startDate: "2025-01-01",
    }).returning();

    await db.insert(timePunches).values({
      organizationId: org.id,
      employeeId: employee.id,
      workDate: corrected.workDate,
      timeIn: corrected.timeIn ? new Date(corrected.timeIn) : null,
      timeOut: corrected.timeOut ? new Date(corrected.timeOut) : null,
      breakStart: corrected.breakStart ? new Date(corrected.breakStart) : null,
      breakEnd: corrected.breakEnd ? new Date(corrected.breakEnd) : null,
      shiftStart: "09:00",
      shiftEnd: "18:00",
      status: "Corrected",
      source: "attendance_correction",
      notes: "Approved WFM attendance correction",
    });

    const [run] = await db.insert(payrollRuns).values({
      organizationId: org.id,
      periodLabel: "Oct 1-15, 2026 WFM certification",
      periodStart: "2026-10-01",
      periodEnd: "2026-10-15",
      scopeLabel: "All locations",
      status: "Draft",
      payDate: "2026-10-15",
    }).returning();

    await enqueuePayrollRun(run.id, 25);
    await drainPayrollQueue(10, run.id);

    const [entry] = await db.select().from(payrollEntries)
      .where(eq(payrollEntries.payrollRunId, run.id));
    assert.ok(entry, "corrected WFM attendance must reach a payroll entry");
    assert.equal(traceValue(entry.trace, "punches"), "1");
    assert.equal(traceValue(entry.trace, "regularMinutes"), "480");
  } finally {
    await db.delete(organizations).where(eq(organizations.id, org.id));
  }
});
