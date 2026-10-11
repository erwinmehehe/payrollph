import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { eq, inArray } from "drizzle-orm";
import { db } from "../src/db";
import { employees, organizations, workforceTimesheets } from "../src/db/schema";
import { markTimesheetsStaleForEmployeeDate } from "../src/lib/workforce-timesheet-server";
import { hashTimesheetSnapshot } from "../src/lib/workforce-timesheet";

/**
 * Regression: normal Web Bundy clock-out must invalidate approved/submitted
 * timesheets exactly as clock-in and breaks already do. This uses only
 * disposable synthetic employers in CI, never production payroll or punches.
 */
test("normal Web Bundy clock-out invalidates only the employee's affected approved timesheet", async () => {
  const seed = randomUUID().slice(0, 12);
  const [alpha, beta] = await db.insert(organizations).values([
    { name: "Synthetic Clock A " + seed, legalName: "Synthetic Clock A " + seed, plan: "Core" },
    { name: "Synthetic Clock B " + seed, legalName: "Synthetic Clock B " + seed, plan: "Core" },
  ]).returning();

  try {
    const [a, b] = await db.insert(employees).values([
      {
        organizationId: alpha.id, employeeNo: "CLK-" + seed,
        firstName: "ClockOut", lastName: "Alpha", title: "Operator",
        avatarInitials: "CA", basicRate: "21000.00", startDate: "2026-01-01",
      },
      {
        organizationId: beta.id, employeeNo: "CLK-" + seed,
        firstName: "ClockOut", lastName: "Beta", title: "Operator",
        avatarInitials: "CB", basicRate: "21000.00", startDate: "2026-01-01",
      },
    ]).returning();

    const firstPeriod = { periodStart: "2026-10-01", periodEnd: "2026-10-15" };
    const futurePeriod = { periodStart: "2026-10-16", periodEnd: "2026-10-31" };

    const fixtures = [
      { organizationId: alpha.id, employeeId: a.id, ...firstPeriod, status: "approved", version: 1 },
      { organizationId: alpha.id, employeeId: a.id, ...firstPeriod, status: "submitted", version: 2 },
      { organizationId: alpha.id, employeeId: a.id, ...futurePeriod, status: "approved", version: 1 },
      { organizationId: beta.id, employeeId: b.id, ...firstPeriod, status: "approved", version: 1 },
    ] as const;

    const created = await db.insert(workforceTimesheets).values(fixtures.map((row) => {
      const snapshot = { synthetic: true, employeeId: row.employeeId, version: row.version };
      return {
        ...row, snapshot, snapshotHash: hashTimesheetSnapshot(snapshot),
        submittedBy: "Synthetic Employee", decidedBy: "Independent Synthetic Checker",
      };
    })).returning();

    const invalidated = await markTimesheetsStaleForEmployeeDate({
      organizationId: alpha.id, employeeId: a.id, workDate: "2026-10-11",
    });

    assert.deepEqual(
      invalidated.map((item) => item.id).sort((x, y) => x - y),
      created.slice(0, 2).map((item) => item.id).sort((x, y) => x - y),
    );

    const after = await db.select().from(workforceTimesheets)
      .where(inArray(workforceTimesheets.id, created.map((row) => row.id)));
    const byId = new Map(after.map((row) => [row.id, row]));
    assert.equal(byId.get(created[0].id)?.status, "stale");
    assert.equal(byId.get(created[1].id)?.status, "stale");
    assert.equal(byId.get(created[2].id)?.status, "approved", "future cutoff stays approved");
    assert.equal(byId.get(created[3].id)?.status, "approved", "other employer stays approved");
  } finally {
    await db.delete(organizations).where(eq(organizations.id, alpha.id));
    await db.delete(organizations).where(eq(organizations.id, beta.id));
  }
});

test("every Web Bundy attendance mutation, including normal clock-out, invalidates timesheets", () => {
  const route = readFileSync("src/app/api/web-bundy/route.ts", "utf8");
  // Branch-specific slice, not just existence of the helper somewhere in the file.
  const labels = [
    '"Web Bundy Break START"',
    '"Web Bundy Break END"',
    '"Web Bundy Clock IN"',
    '"Web Bundy Clock OUT without IN"',
    '"Web Bundy Clock OUT"',
  ];
  for (let index = 0; index < labels.length; index++) {
    const start = route.indexOf("action: " + labels[index]);
    const end = index + 1 < labels.length
      ? route.indexOf("action: " + labels[index + 1])
      : route.length;
    assert.ok(start >= 0 && end > start, labels[index]);
    const portion = route.slice(start, end);
    assert.match(portion, /markTimesheetsStaleForEmployeeDate\(\{\s*organizationId,\s*employeeId,\s*workDate: effectiveWorkDate/, labels[index]);
    assert.match(portion, /syncAttendanceExceptionEvents\(organizationId, employeeId, effectiveWorkDate\)/, labels[index]);
  }
});
