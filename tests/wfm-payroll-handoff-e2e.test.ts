import assert from "node:assert/strict";
import test from "node:test";
import { eq } from "drizzle-orm";
import { db } from "../src/db";
import {
  attendanceCorrectionRequests,
  employeePayProfiles,
  employeeScheduleAssignments,
  employees,
  organizations,
  payrollEntries,
  payrollRuns,
  schedulePatternDays,
  schedulePatternSegments,
  schedulePatterns,
  shiftDefinitions,
  timePunches,
  workforceTimesheetPolicies,
  workforceTimesheets,
} from "../src/db/schema";
import {
  attendancePunchSnapshot,
  normalizeAttendanceCorrection,
  punchStatusAfterCorrection,
} from "../src/lib/workforce-attendance-correction";
import {
  buildEmployeeTimesheetSnapshot,
  loadTimesheetPayrollGate,
  markTimesheetsStaleForEmployeeDate,
} from "../src/lib/workforce-timesheet-server";
import { drainPayrollQueue, enqueuePayrollRun } from "../src/lib/payroll-engine";

test("WFM evidence closes schedule -> punch -> correction -> timesheet -> payroll without bypassing the gate", async () => {
  const [org] = await db.insert(organizations).values({
    name: "WFM Payroll Handoff Certification",
    legalName: "WFM Payroll Handoff Certification Inc.",
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
      startDate: "2026-01-01",
      mobile: "09171234567",
    }).returning();

    await db.insert(employeePayProfiles).values({
      organizationId: org.id,
      employeeId: employee.id,
      payBasis: "monthly",
      rateAmount: "30000.00",
      standardWorkDaysPerMonth: "22",
      standardHoursPerDay: "8",
    });

    const [shift] = await db.insert(shiftDefinitions).values({
      organizationId: org.id,
      code: "E2E-DAY",
      name: "E2E Day",
      startTime: "08:00",
      endTime: "17:00",
      breakMinutes: 60,
      spansMidnight: false,
    }).returning();

    const [pattern] = await db.insert(schedulePatterns).values({
      organizationId: org.id,
      code: "E2E-15D",
      name: "One governed workday in cutoff",
      cycleDays: 15,
    }).returning();

    const days = await db.insert(schedulePatternDays).values(
      Array.from({ length: 15 }, (_, dayIndex) => ({
        patternId: pattern.id,
        dayIndex,
        isRestDay: dayIndex !== 4,
        label: dayIndex === 4 ? "Certified workday" : "Rest",
      })),
    ).returning();

    const workday = days.find((day) => day.dayIndex === 4);
    assert.ok(workday);
    await db.insert(schedulePatternSegments).values({
      patternDayId: workday.id,
      shiftDefinitionId: shift.id,
      segmentOrder: 1,
    });

    await db.insert(employeeScheduleAssignments).values({
      organizationId: org.id,
      employeeId: employee.id,
      patternId: pattern.id,
      effectiveFrom: "2026-10-01",
      anchorDate: "2026-10-01",
      reason: "WFM-to-payroll certification schedule",
    });

    const [punch] = await db.insert(timePunches).values({
      organizationId: org.id,
      employeeId: employee.id,
      workDate: "2026-10-05",
      timeIn: new Date("2026-10-05T08:10:00+08:00"),
      timeOut: new Date("2026-10-05T17:00:00+08:00"),
      breakStart: new Date("2026-10-05T12:00:00+08:00"),
      breakEnd: new Date("2026-10-05T13:00:00+08:00"),
      shiftStart: "08:00",
      shiftEnd: "17:00",
      status: "Complete",
      source: "web_bundy",
    }).returning();

    const original = attendancePunchSnapshot(punch);
    const proposed = normalizeAttendanceCorrection({
      original,
      proposedTimeIn: "2026-10-05T08:00:00+08:00",
    });

    const [correction] = await db.insert(attendanceCorrectionRequests).values({
      organizationId: org.id,
      employeeId: employee.id,
      punchId: punch.id,
      workDate: "2026-10-05",
      originalPunchSnapshot: original,
      proposedPunchSnapshot: proposed,
      reason: "Badge reader recorded the first scan ten minutes late.",
      status: "pending",
      requestedBy: "WFM E2E",
    }).returning();

    await db.insert(workforceTimesheetPolicies).values({
      organizationId: org.id,
      enforcementMode: "block",
      active: true,
      updatedBy: "WFM E2E",
    });

    const blockedSnapshot = await buildEmployeeTimesheetSnapshot({
      organizationId: org.id,
      employeeId: employee.id,
      periodStart: "2026-10-01",
      periodEnd: "2026-10-15",
    });
    assert.ok(blockedSnapshot.blockerCount > 0, "a pending correction must block timesheet approval");
    assert.ok(
      blockedSnapshot.snapshot.days.some((day) =>
        day.pendingCorrectionIds.includes(correction.id)
        && day.exceptions.some((exception) => exception.severity === "blocker")
      ),
    );

    const missingTimesheetGate = await loadTimesheetPayrollGate({
      organizationId: org.id,
      employeeIds: [employee.id],
      periodStart: "2026-10-01",
      periodEnd: "2026-10-15",
    });
    assert.equal(missingTimesheetGate.gate.allowed, false);
    assert.deepEqual(missingTimesheetGate.gate.missingEmployeeIds, [employee.id]);

    await db.update(timePunches).set({
      timeIn: proposed.timeIn ? new Date(proposed.timeIn) : null,
      timeOut: proposed.timeOut ? new Date(proposed.timeOut) : null,
      breakStart: proposed.breakStart ? new Date(proposed.breakStart) : null,
      breakEnd: proposed.breakEnd ? new Date(proposed.breakEnd) : null,
      status: punchStatusAfterCorrection(proposed),
    }).where(eq(timePunches.id, punch.id));
    await db.update(attendanceCorrectionRequests).set({
      status: "approved",
      decidedBy: "WFM Manager",
      decidedAt: new Date(),
      decisionNote: "Badge evidence verified.",
      appliedAt: new Date(),
      updatedAt: new Date(),
    }).where(eq(attendanceCorrectionRequests.id, correction.id));
    await markTimesheetsStaleForEmployeeDate({
      organizationId: org.id,
      employeeId: employee.id,
      workDate: "2026-10-05",
    });

    const correctedSnapshot = await buildEmployeeTimesheetSnapshot({
      organizationId: org.id,
      employeeId: employee.id,
      periodStart: "2026-10-01",
      periodEnd: "2026-10-15",
    });
    assert.equal(correctedSnapshot.blockerCount, 0);
    assert.equal(correctedSnapshot.workedMinutes, 480);
    const correctedDay = correctedSnapshot.snapshot.days.find((day) => day.date === "2026-10-05");
    assert.ok(correctedDay);
    assert.equal(correctedDay.schedule.segments[0]?.shiftCode, "E2E-DAY");
    assert.equal(correctedDay.punches[0]?.status, "Corrected");
    assert.equal(correctedDay.pendingCorrectionIds.length, 0);

    await db.insert(workforceTimesheets).values({
      organizationId: org.id,
      employeeId: employee.id,
      periodStart: "2026-10-01",
      periodEnd: "2026-10-15",
      version: 1,
      status: "approved",
      scheduledMinutes: correctedSnapshot.scheduledMinutes,
      workedMinutes: correctedSnapshot.workedMinutes,
      overtimeMinutes: correctedSnapshot.overtimeMinutes,
      exceptionCount: correctedSnapshot.exceptionCount,
      blockerCount: correctedSnapshot.blockerCount,
      snapshot: correctedSnapshot.snapshot,
      snapshotHash: correctedSnapshot.snapshotHash,
      submittedBy: "WFM Manager",
      submittedAt: new Date(),
      decidedBy: "Payroll Checker",
      decidedAt: new Date(),
      decisionNote: "Authoritative WFM evidence approved for payroll.",
    });

    const approvedGate = await loadTimesheetPayrollGate({
      organizationId: org.id,
      employeeIds: [employee.id],
      periodStart: "2026-10-01",
      periodEnd: "2026-10-15",
    });
    assert.equal(approvedGate.gate.allowed, true);
    assert.deepEqual(approvedGate.gate.approvedEmployeeIds, [employee.id]);

    const [run] = await db.insert(payrollRuns).values({
      organizationId: org.id,
      periodLabel: "Oct 1-15 WFM handoff certification",
      periodStart: "2026-10-01",
      periodEnd: "2026-10-15",
      scopeLabel: "All locations",
      status: "Draft",
      payDate: "2026-10-15",
    }).returning();

    await enqueuePayrollRun(run.id);
    await drainPayrollQueue(20, run.id);

    const [entry] = await db.select().from(payrollEntries)
      .where(eq(payrollEntries.payrollRunId, run.id))
      .limit(1);
    assert.ok(entry, "approved WFM evidence must reach a payroll entry");
    assert.ok(Number(entry.grossPay) > 0);
    assert.ok(Number(entry.netPay) > 0);

    const trace = entry.trace as {
      workforceSchedule?: {
        mode?: string;
        days?: Array<{
          date?: string;
          assignmentId?: number | null;
          segments?: Array<{ shiftDefinitionId?: number; shiftCode?: string }>;
        }>;
      };
      payableTime?: {
        segments?: Array<{ date?: string; punchId?: number; shiftDefinitionId?: number }>;
      };
    };

    const payrollDay = trace.workforceSchedule?.days?.find((day) => day.date === "2026-10-05");
    assert.ok(payrollDay, "payroll trace must retain the resolved WFM schedule date");
    assert.equal(payrollDay.segments?.[0]?.shiftDefinitionId, shift.id);
    assert.equal(payrollDay.segments?.[0]?.shiftCode, "E2E-DAY");
    assert.ok(
      JSON.stringify(trace.payableTime ?? {}).includes(String(punch.id)),
      "payroll trace must retain the authoritative corrected punch evidence",
    );
  } finally {
    await db.delete(organizations).where(eq(organizations.id, org.id));
  }
});

test("the production payroll path enforces approved WFM timesheets instead of relying only on the certification test", () => {
  const payrollRoute = require("node:fs").readFileSync("src/app/api/payroll-runs/route.ts", "utf8");
  const correctionRoute = require("node:fs").readFileSync("src/app/api/workforce/attendance-corrections/route.ts", "utf8");
  const timesheetServer = require("node:fs").readFileSync("src/lib/workforce-timesheet-server.ts", "utf8");

  assert.ok(payrollRoute.includes("loadTimesheetPayrollGate"));
  assert.ok(payrollRoute.includes("TIMESHEET_APPROVAL_REQUIRED"));
  assert.ok(correctionRoute.includes("markTimesheetsStaleForEmployeeDate"));
  assert.ok(timesheetServer.includes("attendance correction request(s)"));
  assert.ok(timesheetServer.includes('severity: "blocker"'));
});
