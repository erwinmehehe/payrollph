import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { eq } from "drizzle-orm";
import { db } from "../src/db";
import { employees, leaveRequests, orgUnits, organizations, overtimeRequests } from "../src/db/schema";
import { InvalidMyTeamScopeError, loadHcmMyTeam } from "../src/lib/hcm-my-team-server";

/** Synthetic PostgreSQL-only test. Never query real employee data or payroll. */
test("My Team isolates employer and exact unit, with SQL paging before request counts", async () => {
  const code = randomUUID().slice(0, 11);
  const [alpha, beta] = await db.insert(organizations).values([
    { name: "My Team Alpha " + code, legalName: "My Team Alpha " + code, plan: "Core" },
    { name: "My Team Beta " + code, legalName: "My Team Beta " + code, plan: "Core" },
  ]).returning();

  try {
    const [alphaUnit, alphaOther, betaUnit] = await db.insert(orgUnits).values([
      { organizationId: alpha.id, code: "TEAM-" + code, name: "Alpha Source Team", type: "department" },
      { organizationId: alpha.id, code: "OTHER-" + code, name: "Alpha Other Unit", type: "department" },
      { organizationId: beta.id, code: "TEAM-" + code, name: "Private Beta Team", type: "department" },
    ]).returning();

    const staff = await db.insert(employees).values(
      Array.from({ length: 27 }, (_, index) => ({
        organizationId: alpha.id,
        orgUnitId: alphaUnit.id,
        employeeNo: "MY-" + code + "-" + String(index + 1).padStart(2, "0"),
        firstName: "ScopedAlpha" + index,
        lastName: "Synthetic",
        title: "Operations staff",
        status: index === 26 ? "On leave" : "Active",
        avatarInitials: "SA",
        basicRate: "20000.00",
        region: "NCR",
        startDate: "2026-01-01",
      })),
    ).returning();
    const byId = [...staff].sort((a, b) => a.id - b.id);
    const firstWorker = byId[0];

    const [alphaOutside, foreignLink, betaWorker] = await db.insert(employees).values([
      {
        organizationId: alpha.id,
        orgUnitId: alphaOther.id,
        employeeNo: "ALT-" + code,
        firstName: "OutsideAlpha",
        lastName: "Synthetic",
        title: "Staff",
        avatarInitials: "OA",
        basicRate: "22000.00",
        startDate: "2026-01-01",
      },
      {
        organizationId: alpha.id,
        orgUnitId: betaUnit.id,
        employeeNo: "FOREIGN-" + code,
        firstName: "UnverifiedLink",
        lastName: "Synthetic",
        title: "Staff",
        avatarInitials: "UL",
        basicRate: "22000.00",
        startDate: "2026-01-01",
      },
      {
        organizationId: beta.id,
        orgUnitId: betaUnit.id,
        employeeNo: firstWorker.employeeNo,
        firstName: "PrivateBetaOnly",
        lastName: "Synthetic",
        title: "Restricted",
        avatarInitials: "PB",
        basicRate: "99000.00",
        startDate: "2026-01-01",
      },
    ]).returning();

    await db.insert(leaveRequests).values([
      {
        organizationId: alpha.id, employeeId: firstWorker.id,
        leaveType: "Vacation", startDate: "2026-11-01", endDate: "2026-11-01",
        days: "1.0", reason: "Synthetic only", status: "Pending",
      },
      {
        organizationId: beta.id, employeeId: betaWorker.id,
        leaveType: "Vacation", startDate: "2026-11-01", endDate: "2026-11-01",
        days: "1.0", reason: "Foreign-tenant sensitive detail", status: "Pending",
      },
    ]);
    await db.insert(overtimeRequests).values([
      {
        organizationId: alpha.id, employeeId: firstWorker.id,
        workDate: "2026-10-04", requestedMinutes: 90,
        reason: "Synthetic only", requestedBy: "Synthetic", status: "pending",
      },
      {
        organizationId: beta.id, employeeId: betaWorker.id,
        workDate: "2026-10-04", requestedMinutes: 90,
        reason: "Foreign-tenant sensitive detail", requestedBy: "Synthetic", status: "pending",
      },
    ]);

    const scope = { kind: "unit" as const, orgUnitId: alphaUnit.id };
    const first = await loadHcmMyTeam({
      organizationId: alpha.id, scope, cursor: 0, query: "", statusFilter: "all",
    });
    assert.equal(first.items.length, 25);
    assert.equal(first.page.hasMore, true);
    assert.equal(first.summary.employeeRecordsThisPage, 25);
    assert.equal(first.summary.pendingLeaveRecordsThisPage, 1);
    assert.equal(first.summary.pendingOvertimeRecordsThisPage, 1);
    assert.ok(first.page.nextCursor !== null);
    assert.ok(first.items.every((row) => row.orgUnitName === "Alpha Source Team"));
    assert.ok(first.items.every((row) => row.orgUnitIntegrity === "verified"));

    const second = await loadHcmMyTeam({
      organizationId: alpha.id, scope,
      cursor: first.page.nextCursor!, query: "", statusFilter: "all",
    });
    assert.equal(second.items.length, 2);
    assert.equal(second.page.hasMore, false);
    assert.equal(second.page.nextCursor, null);

    const filtered = await loadHcmMyTeam({
      organizationId: alpha.id, scope, cursor: 0,
      query: "ScopedAlpha26", statusFilter: "On leave",
    });
    assert.equal(filtered.items.length, 1);
    assert.equal(filtered.items[0].status, "On leave");

    const otherUnit = await loadHcmMyTeam({
      organizationId: alpha.id, scope, cursor: 0,
      query: "OutsideAlpha", statusFilter: "all",
    });
    assert.equal(otherUnit.items.length, 0);
    assert.ok(!JSON.stringify([first, second]).includes("PrivateBetaOnly"));
    assert.ok(!JSON.stringify([first, second]).includes("Foreign-tenant sensitive detail"));

    const company = await loadHcmMyTeam({
      organizationId: alpha.id,
      scope: { kind: "company", orgUnitId: null },
      cursor: 0, query: "UnverifiedLink", statusFilter: "all",
    });
    assert.equal(company.items.length, 1);
    assert.equal(company.items[0].id, foreignLink.id);
    assert.equal(company.items[0].orgUnitName, null);
    assert.equal(company.items[0].orgUnitIntegrity, "unverified");
    assert.ok(!JSON.stringify(company).includes("Private Beta Team"));

    await assert.rejects(
      loadHcmMyTeam({
        organizationId: alpha.id,
        scope: { kind: "unit", orgUnitId: betaUnit.id },
        cursor: 0, query: "", statusFilter: "all",
      }),
      InvalidMyTeamScopeError,
    );
    assert.ok(alphaOutside.id > 0);
  } finally {
    await db.delete(organizations).where(eq(organizations.id, alpha.id));
    await db.delete(organizations).where(eq(organizations.id, beta.id));
  }
});
