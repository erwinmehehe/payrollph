import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  ageBucket,
  ageHoursSince,
  daysUntilDate,
  deadlineBucket,
} from "../src/lib/automation-temporal-events";

const read = (path: string) => readFileSync(path, "utf8");

test("deadline buckets escalate once through stable temporal thresholds", () => {
  assert.equal(deadlineBucket(8), null);
  assert.equal(deadlineBucket(7), "within_7_days");
  assert.equal(deadlineBucket(4), "within_7_days");
  assert.equal(deadlineBucket(3), "within_3_days");
  assert.equal(deadlineBucket(2), "within_3_days");
  assert.equal(deadlineBucket(1), "within_1_day");
  assert.equal(deadlineBucket(0), "due_today");
  assert.equal(deadlineBucket(-1), "overdue_1_2_days");
  assert.equal(deadlineBucket(-2), "overdue_1_2_days");
  assert.equal(deadlineBucket(-4), "overdue_3_6_days");
  assert.equal(deadlineBucket(-6), "overdue_3_6_days");
  assert.equal(deadlineBucket(-7), "overdue_7_plus_days");
  assert.equal(deadlineBucket(-30), "overdue_7_plus_days");
});

test("aging buckets escalate unresolved items without per-hour event spam", () => {
  assert.equal(ageBucket(3), null);
  assert.equal(ageBucket(4), "4h");
  assert.equal(ageBucket(7), "4h");
  assert.equal(ageBucket(8), "8h");
  assert.equal(ageBucket(23), "8h");
  assert.equal(ageBucket(24), "24h");
  assert.equal(ageBucket(47), "24h");
  assert.equal(ageBucket(48), "48h");
  assert.equal(ageBucket(71), "48h");
  assert.equal(ageBucket(72), "72h_plus");
  assert.equal(ageBucket(240), "72h_plus");
});

test("deadline and age math is deterministic from explicit dates", () => {
  assert.equal(daysUntilDate("2026-10-10", "2026-10-07"), 3);
  assert.equal(daysUntilDate("2026-10-07", "2026-10-07"), 0);
  assert.equal(daysUntilDate("2026-10-05", "2026-10-07"), -2);

  const now = new Date("2026-10-07T12:00:00.000Z");
  assert.equal(ageHoursSince(new Date("2026-10-07T04:00:00.000Z"), now), 8);
  assert.equal(ageHoursSince(new Date("2026-10-08T04:00:00.000Z"), now), 0);
});

test("Automation Studio exposes temporal payroll and WFM SLA triggers", () => {
  const engine = read("src/lib/automation.ts");
  for (const trigger of [
    "payroll.pay_date_approaching",
    "timesheet.cutoff_approaching",
    "timesheet.missing_approaching",
    "attendance.exception_aging",
    "coverage.gap_approaching",
  ]) {
    assert.ok(engine.includes(`"${trigger}"`), `missing temporal trigger ${trigger}`);
  }

  for (const field of [
    "deadlineType",
    "deadlineBucket",
    "daysUntilDeadline",
    "ageHours",
    "ageBucket",
    "timesheetStatus",
    "timesheetBlockerCount",
    "timesheetExpectationId",
    "timesheetExpectationVersion",
    "timesheetExpectationStatus",
    "openShiftId",
    "coverageSlots",
  ]) {
    assert.ok(engine.includes(`value: "${field}"`), `missing temporal condition field ${field}`);
  }
});

test("scheduler emits bucket-keyed events only for unresolved authoritative records", () => {
  const temporal = read("src/lib/automation-temporal-events.ts");
  const scheduler = read("src/lib/scheduler.ts");

  assert.ok(temporal.includes('const SCHEDULE_JOB = "automation-temporal-sla-events"'));
  assert.ok(temporal.includes('ne(payrollRuns.status, "Released")'));
  assert.ok(temporal.includes('inArray(workforceTimesheets.status, ["submitted", "rejected", "stale"])'));
  assert.ok(temporal.includes('eq(attendanceExceptionEvents.status, "open")'));
  assert.ok(temporal.includes('eq(openShifts.status, "open")'));

  assert.ok(temporal.includes('eventKey: `payroll-pay-date:${row.id}:${bucket}`'));
  assert.ok(temporal.includes('eventKey: `timesheet-cutoff:${row.id}:${row.version}:${bucket}`'));
  assert.ok(temporal.includes('eventKey: `attendance-exception-aging:${row.id}:${bucket}`'));
  assert.ok(temporal.includes('eventKey: `coverage-gap:${row.id}:${bucket}`'));

  assert.ok(scheduler.includes("runScheduledAutomationTemporalEvents"));
  assert.ok(scheduler.includes("automationTemporalEvents"));
});

test("missing-timesheet SLA is emitted only from explicit frozen expectations", () => {
  const temporal = read("src/lib/automation-temporal-events.ts");
  assert.ok(temporal.includes("workforceTimesheetExpectations"));
  assert.ok(temporal.includes('eq(workforceTimesheetExpectations.status, "expected")'));
  assert.ok(temporal.includes('notInArray(payrollRuns.status, ["Released", "Failed", "Cancelled", "Voided", "Superseded"])'));
  assert.ok(temporal.includes('trigger: "timesheet.missing_approaching"'));
  assert.ok(temporal.includes('eventKey: `timesheet-missing:${row.expectationId}:${row.expectationVersion}:${bucket}`'));
  assert.ok(temporal.includes("timesheetExpectationId: row.expectationId"));
  assert.ok(temporal.includes("timesheetExpectationVersion: row.expectationVersion"));
});
