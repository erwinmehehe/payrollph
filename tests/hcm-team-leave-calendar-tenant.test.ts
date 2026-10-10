import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { eq } from "drizzle-orm";
import { db } from "../src/db";
import { employees, leaveRequests, orgUnits, organizations } from "../src/db/schema";
import {
  loadTeamLeaveMonth,
  TeamLeaveInvalidMonthError, TeamLeaveScopeError, TeamLeaveSourceOverflowError,
} from "../src/lib/hcm-team-leave-calendar-server";

const NOW = new Date("2026-10-10T12:00:00.000Z");

test("calendar displays only current scoped source cases and never foreign employer details", async () => {
  const id = randomUUID().slice(0, 10);
  const [alpha, beta] = await db.insert(organizations).values([
    { name: "Calendar Alpha " + id, legalName: "Calendar Alpha " + id, plan: "Core" },
    { name: "Calendar Beta " + id, legalName: "Calendar Beta " + id, plan: "Core" },
  ]).returning();

  try {
    const [teamUnit, otherUnit, foreignUnit] = await db.insert(orgUnits).values([
      { organizationId: alpha.id, code: "CT-" + id, name: "Alpha Team", type: "department" },
      { organizationId: alpha.id, code: "CO-" + id, name: "Alpha Other", type: "department" },
      { organizationId: beta.id, code: "CB-" + id, name: "Private Beta Unit", type: "department" },
    ]).returning();
    const [visible, outside, foreign, corrupted] = await db.insert(employees).values([
      {
        organizationId: alpha.id, orgUnitId: teamUnit.id,
        employeeNo: "TEAM-" + id, firstName: "Visible", lastName: "Person",
        title: "Operator", avatarInitials: "VP", basicRate: "20000.00",
        startDate: "2026-01-01",
      },
      {
        organizationId: alpha.id, orgUnitId: otherUnit.id,
        employeeNo: "OUTSIDE-" + id, firstName: "Restricted", lastName: "Other",
        title: "Operator", avatarInitials: "RO", basicRate: "20000.00",
        startDate: "2026-01-01",
      },
      {
        organizationId: beta.id, orgUnitId: foreignUnit.id,
        employeeNo: "TEAM-" + id, firstName: "Restricted", lastName: "Beta",
        title: "Operator", avatarInitials: "RB", basicRate: "99999.00",
        startDate: "2026-01-01",
      },
      {
        organizationId: alpha.id, orgUnitId: foreignUnit.id,
        employeeNo: "BROKEN-" + id, firstName: "Unverified", lastName: "Unit",
        title: "Operator", avatarInitials: "UU", basicRate: "21000.00",
        startDate: "2026-01-01",
      },
    ]).returning();

    await db.insert(leaveRequests).values([
      {
        organizationId: alpha.id, employeeId: visible.id,
        leaveType: "Sensitive personal", reason: "Private Alpha Leave Reason",
        startDate: "2026-09-30", endDate: "2026-10-02",
        days: "0.5", status: "Approved",
      },
      {
        organizationId: alpha.id, employeeId: visible.id,
        leaveType: "Sensitive personal", reason: "Pending Private Reason",
        startDate: "2026-10-11", endDate: "2026-11-02",
        days: "1.0", status: "Pending",
      },
      {
        organizationId: alpha.id, employeeId: visible.id,
        leaveType: "Sensitive personal", reason: "Declined Reason",
        startDate: "2026-10-04", endDate: "2026-10-04",
        days: "1.0", status: "Declined",
      },
      {
        organizationId: alpha.id, employeeId: outside.id,
        leaveType: "Sensitive personal", reason: "Private Other Unit Reason",
        startDate: "2026-10-01", endDate: "2026-10-02",
        days: "1.0", status: "Approved",
      },
      {
        organizationId: beta.id, employeeId: foreign.id,
        leaveType: "Sensitive personal", reason: "Private Beta Reason",
        startDate: "2026-10-01", endDate: "2026-10-02",
        days: "1.0", status: "Approved",
      },
      {
        organizationId: alpha.id, employeeId: corrupted.id,
        leaveType: "Sensitive personal", reason: "Foreign-linked Unit Reason",
        startDate: "2026-10-01", endDate: "2026-10-02",
        days: "1.0", status: "Approved",
      },
      {
        // Invalid foreign-tenant employee reference must NEVER appear in
        // the other employer's source calendar.
        organizationId: alpha.id, employeeId: foreign.id,
        leaveType: "Sensitive personal", reason: "Foreign-linked Worker Reason",
        startDate: "2026-10-01", endDate: "2026-10-02",
        days: "1.0", status: "Approved",
      },
    ]);

    const scope = { kind: "unit" as const, orgUnitId: teamUnit.id };
    const oct = await loadTeamLeaveMonth({
      organizationId: alpha.id, scope, month: "2026-10", now: NOW,
    });
    assert.equal(oct.cases.length, 2);
    assert.deepEqual(oct.summary, {
      approvedRequestRecords: 1, pendingRequestRecords: 1,
    });
    assert.ok(oct.cases.every((item) => item.employeeId === visible.id));
    assert.deepEqual(oct.cases.map((item) => item.startDate).sort(),
      ["2026-09-30", "2026-10-11"]);

    const november = await loadTeamLeaveMonth({
      organizationId: alpha.id, scope, month: "2026-11", now: NOW,
    });
    assert.equal(november.cases.length, 1);
    assert.equal(november.cases[0].status, "Pending");

    const response = JSON.stringify([oct, november]);
    for (const secret of [
      "Private Alpha Leave Reason", "Pending Private Reason",
      "Private Other Unit Reason", "Private Beta Reason",
      "Private Beta Unit", "Foreign-linked Worker Reason", "Sensitive personal",
      "99999", "Declined Reason", "Restricted Other", "Restricted Beta",
    ]) {
      assert.ok(!response.includes(secret), "Sensitive source value leaked: " + secret);
    }

    const company = await loadTeamLeaveMonth({
      organizationId: alpha.id,
      scope: { kind: "company", orgUnitId: null },
      month: "2026-10", now: NOW,
    });
    assert.ok(company.cases.some((item) => item.employeeId === outside.id));
    assert.ok(company.cases.some((item) => item.employeeId === corrupted.id));
    assert.ok(!company.cases.some((item) => item.employeeId === foreign.id));
    assert.ok(!JSON.stringify(company).includes("Private Beta Unit"));

    await assert.rejects(loadTeamLeaveMonth({
      organizationId: alpha.id,
      scope: { kind: "unit", orgUnitId: foreignUnit.id },
      month: "2026-10", now: NOW,
    }), TeamLeaveScopeError);
    await assert.rejects(loadTeamLeaveMonth({
      organizationId: alpha.id, scope, month: "2026-09", now: NOW,
    }), TeamLeaveInvalidMonthError);

    // A pilot must refuse a partial/truncated calendar rather than showing
    // a falsely empty or falsely complete staffing picture.
    await db.insert(leaveRequests).values(
      Array.from({ length: 399 }, (_, index) => ({
        organizationId: alpha.id, employeeId: visible.id,
        leaveType: "Synthetic", reason: "Synthetic record " + index,
        startDate: "2026-10-20", endDate: "2026-10-20",
        days: "0.5", status: "Pending",
      })),
    );
    await assert.rejects(loadTeamLeaveMonth({
      organizationId: alpha.id, scope, month: "2026-10", now: NOW,
    }), TeamLeaveSourceOverflowError);
  } finally {
    await db.delete(organizations).where(eq(organizations.id, alpha.id));
    await db.delete(organizations).where(eq(organizations.id, beta.id));
  }
});
