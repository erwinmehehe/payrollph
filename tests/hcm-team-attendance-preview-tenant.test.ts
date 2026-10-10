import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { eq, inArray } from "drizzle-orm";
import { db } from "../src/db";
import {
  organizations, orgUnits, employees, timePunches,
  shiftDefinitions, schedulePatterns, schedulePatternDays, schedulePatternSegments,
  employeeScheduleAssignments,
} from "../src/db/schema";
import {
  InvalidTeamAttendanceScopeError,
  TeamAttendanceSourceOverflowError,
  loadTeamAttendancePreview,
} from "../src/lib/hcm-team-attendance-preview-server";

/** Two employers, intentionally invalid source links and fake workers only. */
test("Team Attendance SQL applies tenant + current unit before page, respects WFM sources and fails closed", async () => {
  const tag = randomUUID().slice(0, 10);
  const [alpha, beta] = await db.insert(organizations).values([
    { name: "Preview Alpha " + tag, legalName: "Preview Alpha " + tag, plan: "Core" },
    { name: "Preview Beta " + tag, legalName: "Preview Beta " + tag, plan: "Core" },
  ]).returning();
  const now = new Date("2026-10-10T01:00:00Z");
  try {
    const [alphaTeam, alphaOther, betaTeam] = await db.insert(orgUnits).values([
      { organizationId: alpha.id, type: "department", code: "TEAM-" + tag,
        name: "Alpha Team", active: true, effectiveFrom: "2026-10-01" },
      { organizationId: alpha.id, type: "department", code: "OTHER-" + tag,
        name: "Alpha Other" },
      { organizationId: beta.id, type: "department", code: "TEAM-" + tag,
        name: "Beta Private Team" },
    ]).returning();
    const common = { title: "Synthetic operations staff", avatarInitials: "TS", basicRate: "20000.00", startDate: "2026-01-01" };
    const [alphaWorker, outsideWorker, foreignUnitLink, betaWorker] = await db.insert(employees).values([
      { ...common, organizationId: alpha.id, orgUnitId: alphaTeam.id, employeeNo: "W-" + tag, firstName: "Alice", lastName: "Synthetic" },
      { ...common, organizationId: alpha.id, orgUnitId: alphaOther.id, employeeNo: "OUT-" + tag, firstName: "Outside", lastName: "Private" },
      { ...common, organizationId: alpha.id, orgUnitId: betaTeam.id, employeeNo: "BAD-" + tag, firstName: "ForeignUnit", lastName: "Link" },
      { ...common, organizationId: beta.id, orgUnitId: betaTeam.id, employeeNo: "W-" + tag, firstName: "BetaPrivate", lastName: "Secret" },
    ]).returning();
    const [shift] = await db.insert(shiftDefinitions).values({
      organizationId: alpha.id, code: "DAY-" + tag, name: "Day shift",
      startTime: "09:00", endTime: "18:00", breakMinutes: 60,
    }).returning();
    const [pattern] = await db.insert(schedulePatterns).values({
      organizationId: alpha.id, code: "PAT-" + tag, name: "Synthetic daily rotation", cycleDays: 1,
    }).returning();
    const [day] = await db.insert(schedulePatternDays).values({
      patternId: pattern.id, dayIndex: 0, isRestDay: false,
    }).returning();
    await db.insert(schedulePatternSegments).values({
      patternDayId: day.id, shiftDefinitionId: shift.id, segmentOrder: 1,
    });
    await db.insert(employeeScheduleAssignments).values({
      organizationId: alpha.id, employeeId: alphaWorker.id, patternId: pattern.id,
      effectiveFrom: "2026-10-01", anchorDate: "2026-10-10",
    });

    // Second row deliberately has the wrong organization id for the same employee FK.
    // Matching employee_id alone must NEVER admit it to Alpha.
    await db.insert(timePunches).values([
      { organizationId: alpha.id, employeeId: alphaWorker.id, workDate: "2026-10-10",
        timeIn: new Date("2026-10-10T01:00:00Z"), timeOut: null },
      { organizationId: beta.id, employeeId: alphaWorker.id, workDate: "2026-10-10",
        timeIn: new Date("2026-10-10T01:00:00Z"), timeOut: new Date("2026-10-10T10:00:00Z") },
    ]);

    const scope = { kind: "unit" as const, orgUnitId: alphaTeam.id };
    const unitView = await loadTeamAttendancePreview({ organizationId: alpha.id, scope, cursor: 0, now });
    assert.equal(unitView.workDate, "2026-10-10");
    assert.equal(unitView.rows.length, 1);
    assert.equal(unitView.rows[0].employeeId, alphaWorker.id);
    assert.equal(unitView.rows[0].scheduledSegments, 1);
    assert.equal(unitView.rows[0].punchRecords, 1);
    assert.equal(unitView.rows[0].incompletePunchRecords, 1);
    assert.equal(unitView.rows[0].state, "review");
    assert.equal(unitView.page.hasMore, false);
    assert.ok(!JSON.stringify(unitView).includes("BetaPrivate"));
    assert.ok(!JSON.stringify(unitView).includes("ForeignUnit"));
    assert.ok(!JSON.stringify(unitView).includes("Outside"));

    const company = await loadTeamAttendancePreview({
      organizationId: alpha.id, scope: { kind: "company", orgUnitId: null }, cursor: 0, now,
    });
    assert.equal(company.rows.length, 3);
    assert.ok(company.rows.some(row => row.employeeId === outsideWorker.id));
    assert.ok(company.rows.some(row => row.employeeId === foreignUnitLink.id));
    assert.ok(!JSON.stringify(company).includes("BetaPrivate"));
    const betaView = await loadTeamAttendancePreview({
      organizationId: beta.id, scope: { kind: "company", orgUnitId: null }, cursor: 0, now,
    });
    assert.equal(betaView.rows.length, 1);
    assert.equal(betaView.rows[0].employeeId, betaWorker.id);
    assert.equal(betaView.rows[0].punchRecords, 0);

    // A scoped manager's unit must remain active and effective on Manila business date.
    await db.update(orgUnits).set({ effectiveFrom: "2026-10-11" }).where(eq(orgUnits.id, alphaTeam.id));
    await assert.rejects(
      loadTeamAttendancePreview({ organizationId: alpha.id, scope, cursor: 0, now }),
      InvalidTeamAttendanceScopeError,
    );
    await db.update(orgUnits).set({ effectiveFrom: "2026-10-01", active: false }).where(eq(orgUnits.id, alphaTeam.id));
    await assert.rejects(
      loadTeamAttendancePreview({ organizationId: alpha.id, scope, cursor: 0, now }),
      InvalidTeamAttendanceScopeError,
    );
    await db.update(orgUnits).set({ active: true }).where(eq(orgUnits.id, alphaTeam.id));
    await assert.rejects(
      loadTeamAttendancePreview({
        organizationId: beta.id, scope: { kind: "unit", orgUnitId: alphaTeam.id }, cursor: 0, now,
      }), InvalidTeamAttendanceScopeError,
    );

    // Over 500 matching punch rows means a hard error (no partial attendance/capacity display).
    await db.insert(timePunches).values(Array.from({ length: 500 }, () => ({
      organizationId: alpha.id, employeeId: alphaWorker.id, workDate: "2026-10-10",
      timeIn: null, timeOut: null,
    })));
    await assert.rejects(
      loadTeamAttendancePreview({ organizationId: alpha.id, scope, cursor: 0, now }),
      TeamAttendanceSourceOverflowError,
    );
  } finally {
    await db.delete(organizations).where(inArray(organizations.id, [alpha.id, beta.id]));
  }
});
