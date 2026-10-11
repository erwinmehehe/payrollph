import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { eq } from "drizzle-orm";
import { db } from "../src/db";
import {
  employees,
  organizations,
  workforceTimesheetPolicies,
  workforceTimesheets,
} from "../src/db/schema";
import {
  latestTimesheetsForPeriod,
  loadTimesheetPayrollGate,
  markTimesheetsStaleForEmployeeDate,
} from "../src/lib/workforce-timesheet-server";
import {
  payableTimeEvidenceFlagsForPayroll,
  segmentPayableTime,
  WFM_PREMIUM_ALLOCATION_UNVERIFIED,
} from "../src/lib/workforce-payroll";
import { hashTimesheetSnapshot } from "../src/lib/workforce-timesheet";

/**
 * WFM-07: A complete overnight shift must preserve two PH calendar dates,
 * night differential and post-shift OT boundaries before payroll sees it.
 * This verifies TIME EVIDENCE, not a government-approved peso calculation.
 */
test("WFM-07: overnight worked minutes retain PH midnight, night and overtime boundaries", () => {
  const segmentation = segmentPayableTime({
    punch: {
      id: 42,
      workDate: "2026-10-05",
      timeIn: "2026-10-05T22:00:00+08:00",
      timeOut: "2026-10-06T07:00:00+08:00",
      breakStart: "2026-10-06T02:00:00+08:00",
      breakEnd: "2026-10-06T03:00:00+08:00",
    },
    shift: { start: "22:00", end: "06:00", breakMinutes: 60, spansMidnight: true },
  });

  assert.equal(segmentation.allocationComplete, true);
  assert.deepEqual(segmentation.attendanceCalendarDates, ["2026-10-05", "2026-10-06"]);
  assert.equal(segmentation.segments.reduce((total, row) => total + row.minutes, 0), 480);
  assert.equal(segmentation.segments.filter((row) => row.night)
    .reduce((total, row) => total + row.minutes, 0), 420);
  assert.equal(segmentation.segments.filter((row) => row.overtime)
    .reduce((total, row) => total + row.minutes, 0), 60);
  assert.equal(segmentation.segments.filter((row) => row.overtime && row.night)
    .reduce((total, row) => total + row.minutes, 0), 0);
  assert.deepEqual(payableTimeEvidenceFlagsForPayroll(segmentation, 480), []);

  const uncertainBreak = segmentPayableTime({
    punch: {
      id: 43,
      workDate: "2026-10-05",
      timeIn: "2026-10-05T22:00:00+08:00",
      timeOut: "2026-10-06T07:00:00+08:00",
      breakStart: "invalid-clock-value",
      breakEnd: null,
    },
    shift: { start: "22:00", end: "06:00", breakMinutes: 60, spansMidnight: true },
  });
  assert.equal(uncertainBreak.allocationComplete, false);
  assert.ok(payableTimeEvidenceFlagsForPayroll(uncertainBreak, 480)
    .some((flag) => flag.startsWith(WFM_PREMIUM_ALLOCATION_UNVERIFIED + ":")),
    "Ambiguous break evidence crossing payroll premium classes must block approval");
});

/**
 * WFM-08: Two fictional employers can use the same worker number and cutoff.
 * A post-approval correction must invalidate only the matching employee/cutoff
 * while preserving the other employer and future cutoff. Reapproval requires
 * a new approved version, not resurrection of a stale older approval.
 */
test("WFM-08: corrected attendance stales only its tenant/cutoff and requires newest approval", async () => {
  const key = randomUUID().slice(0, 12);
  const [alpha, beta] = await db.insert(organizations).values([
    { name: "Synthetic WFM Alpha " + key, legalName: "Synthetic WFM Alpha " + key, plan: "Core" },
    { name: "Synthetic WFM Beta " + key, legalName: "Synthetic WFM Beta " + key, plan: "Core" },
  ]).returning();

  const periodStart = "2026-10-01";
  const periodEnd = "2026-10-15";
  const nextStart = "2026-10-16";
  const nextEnd = "2026-10-31";

  async function payrollGate(organizationId: number, employeeId: number, future = false) {
    return loadTimesheetPayrollGate({
      organizationId,
      employeeIds: [employeeId],
      periodStart: future ? nextStart : periodStart,
      periodEnd: future ? nextEnd : periodEnd,
    });
  }

  try {
    const [workerA, workerB] = await db.insert(employees).values([
      {
        organizationId: alpha.id, employeeNo: "SAME-WFM-" + key,
        firstName: "Synthetic", lastName: "Alpha",
        title: "Night Associate", avatarInitials: "SA",
        basicRate: "30000.00", startDate: "2026-01-01",
      },
      {
        organizationId: beta.id, employeeNo: "SAME-WFM-" + key,
        firstName: "Synthetic", lastName: "Beta",
        title: "Night Associate", avatarInitials: "SB",
        basicRate: "40000.00", startDate: "2026-01-01",
      },
    ]).returning();
    assert.equal(workerA.employeeNo, workerB.employeeNo);

    await db.insert(workforceTimesheetPolicies).values([
      { organizationId: alpha.id, active: true, enforcementMode: "block", updatedBy: "Synthetic QA" },
      { organizationId: beta.id, active: true, enforcementMode: "block", updatedBy: "Synthetic QA" },
    ]);

    const evidenceA = { employeeId: workerA.id, cutoff: periodStart, synthetic: true };
    const evidenceB = { employeeId: workerB.id, cutoff: periodStart, synthetic: true };
    const futureEvidence = { employeeId: workerA.id, cutoff: nextStart, synthetic: true };

    const [aApproved, bApproved, aFuture] = await db.insert(workforceTimesheets).values([
      {
        organizationId: alpha.id, employeeId: workerA.id,
        periodStart, periodEnd, version: 1, status: "approved",
        snapshot: evidenceA, snapshotHash: hashTimesheetSnapshot(evidenceA),
        submittedBy: "Synthetic Employee", decidedBy: "Independent Checker",
      },
      {
        organizationId: beta.id, employeeId: workerB.id,
        periodStart, periodEnd, version: 1, status: "approved",
        snapshot: evidenceB, snapshotHash: hashTimesheetSnapshot(evidenceB),
        submittedBy: "Synthetic Employee", decidedBy: "Independent Checker",
      },
      {
        organizationId: alpha.id, employeeId: workerA.id,
        periodStart: nextStart, periodEnd: nextEnd, version: 1, status: "approved",
        snapshot: futureEvidence, snapshotHash: hashTimesheetSnapshot(futureEvidence),
        submittedBy: "Synthetic Employee", decidedBy: "Independent Checker",
      },
    ]).returning();

    for (const [organizationId, employeeId] of [
      [alpha.id, workerA.id], [beta.id, workerB.id],
    ]) {
      const ready = await payrollGate(organizationId, employeeId);
      assert.equal(ready.policy.enforcementMode, "block");
      assert.equal(ready.gate.allowed, true);
      assert.deepEqual(ready.gate.approvedEmployeeIds, [employeeId]);
    }

    // A date outside either approved cutoff must not stale anything.
    const unrelated = await markTimesheetsStaleForEmployeeDate({
      organizationId: alpha.id,
      employeeId: workerA.id,
      workDate: "2026-09-30",
    });
    assert.deepEqual(unrelated, []);
    assert.equal((await payrollGate(alpha.id, workerA.id)).gate.allowed, true);

    const invalidated = await markTimesheetsStaleForEmployeeDate({
      organizationId: alpha.id,
      employeeId: workerA.id,
      workDate: "2026-10-05",
    });
    assert.deepEqual(invalidated.map((row) => row.id), [aApproved.id]);

    const blocked = await payrollGate(alpha.id, workerA.id);
    assert.equal(blocked.gate.allowed, false);
    assert.equal(blocked.gate.blocking, true);
    assert.deepEqual(blocked.gate.nonApprovedEmployeeIds, [workerA.id]);
    assert.deepEqual(blocked.gate.approvedEmployeeIds, []);

    assert.equal((await payrollGate(beta.id, workerB.id)).gate.allowed, true,
      "Beta's approved timesheet must remain valid");
    assert.equal((await payrollGate(alpha.id, workerA.id, true)).gate.allowed, true,
      "Alpha's future payroll cutoff must remain valid");
    assert.equal((await db.select().from(workforceTimesheets)
      .where(eq(workforceTimesheets.id, bApproved.id)))[0]?.status, "approved");
    assert.equal((await db.select().from(workforceTimesheets)
      .where(eq(workforceTimesheets.id, aFuture.id)))[0]?.status, "approved");

    // A new submission is not an approval, even if an older version was approved.
    const revisedEvidence = { ...evidenceA, correctedAttendance: true };
    await db.insert(workforceTimesheets).values({
      organizationId: alpha.id, employeeId: workerA.id,
      periodStart, periodEnd, version: 2, status: "submitted",
      snapshot: revisedEvidence, snapshotHash: hashTimesheetSnapshot(revisedEvidence),
      submittedBy: "Synthetic Employee",
    });
    const pendingReview = await payrollGate(alpha.id, workerA.id);
    assert.equal(pendingReview.gate.allowed, false);
    assert.equal(pendingReview.timesheets[0]?.version, 2);

    await db.insert(workforceTimesheets).values({
      organizationId: alpha.id, employeeId: workerA.id,
      periodStart, periodEnd, version: 3, status: "approved",
      snapshot: revisedEvidence, snapshotHash: hashTimesheetSnapshot(revisedEvidence),
      submittedBy: "Synthetic Employee", decidedBy: "Independent Checker",
    });
    const approvedAgain = await payrollGate(alpha.id, workerA.id);
    assert.equal(approvedAgain.gate.allowed, true);
    assert.equal(approvedAgain.timesheets[0]?.version, 3);
    assert.equal((await db.select().from(workforceTimesheets)
      .where(eq(workforceTimesheets.id, aApproved.id)))[0]?.status, "stale",
      "Old approved evidence must never be resurrected");
  } finally {
    // All records are synthetic; tenant FK cascade removes policies/timesheets.
    await db.delete(organizations).where(eq(organizations.id, alpha.id));
    await db.delete(organizations).where(eq(organizations.id, beta.id));
  }
});

/** The live processing endpoints, not a test harness, own payroll release. */
test("WFM-08: processing and recalculation still consume the governed timesheet gate", () => {
  const create = readFileSync("src/app/api/payroll-runs/route.ts", "utf8");
  const process = readFileSync("src/app/api/payroll-runs/[id]/process/route.ts", "utf8");
  const corrections = readFileSync("src/app/api/workforce/attendance-corrections/route.ts", "utf8");
  assert.match(create, /if \(processNow && !timesheetGate\.gate\.allowed\)/);
  assert.ok(create.includes("TIMESHEET_APPROVAL_REQUIRED"));
  assert.ok(process.includes("loadTimesheetPayrollGate"));
  assert.ok(process.includes("TIMESHEET_APPROVAL_REQUIRED"));
  assert.ok(corrections.includes("markTimesheetsStaleForEmployeeDate"));
  assert.ok(corrections.includes("payrollIsImmutable(run.status)"));
});
