import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { MAX_ATTENDANCE_OPERATIONS_DAYS, validAttendanceOperationsWindow }
  from "../src/lib/attendance-operations-window";

test("attendance operation windows are bounded and inclusive", () => {
  assert.equal(MAX_ATTENDANCE_OPERATIONS_DAYS, 42);
  for (const [a,b] of [
    ["2026-10-14", "2026-10-14"],
    ["2026-10-01", "2026-10-14"],
    ["2026-10-01", "2026-11-11"],
    ["2024-02-28", "2024-03-01"],
  ]) assert.equal(validAttendanceOperationsWindow(a,b), true, a);
});

test("reject impossible, reversed, noncanonical and overlong windows", () => {
  for (const [a,b] of [
    ["2026-02-30", "2026-03-01"],
    ["2026-13-01", "2026-13-02"],
    ["2026-04-31", "2026-05-01"],
    ["2026-10-14", "2026-10-01"],
    ["2026-10-01", "2026-11-12"],
    ["2026-10-01", "2027-10-01"],
    ["2026-1-01", "2026-01-02"],
    ["2026-01-01T00:00:00Z", "2026-01-02"],
    ["", "2026-10-14"],
  ]) assert.equal(validAttendanceOperationsWindow(a,b), false, a + " - " + b);
});

test("empty scoped roster must resolve persisted table columns before HTTP 200", () => {
  const source = readFileSync(
    "src/app/api/workforce/attendance-exception-events/route.ts", "utf8");
  const get = source.slice(source.indexOf("export async function GET("),
    source.indexOf("export async function POST("));
  const role = get.indexOf("const denied = await assertOrganizationRole(");
  const access = get.indexOf("const access = await getAccess(");
  const empty = get.indexOf("if (employeeIds.length === 0) {");
  const check = get.indexOf("await db.select().from(attendanceExceptionEvents)", empty);
  const success = get.indexOf("return Response.json({", empty);
  assert.ok(role >= 0 && access > role && empty > access);
  assert.ok(check > empty && check < success,
    "A missing relation must not masquerade as healthy zero events");
  assert.match(get.slice(check, success),
    /where\(eq\(attendanceExceptionEvents\.organizationId, organizationId\)\)\.limit\(0\)/);
  assert.match(get, /validAttendanceOperationsWindow\(startDate, endDate\)/);
  assert.match(get, /"Cache-Control": "private, no-store"/);
  assert.match(get.slice(success), /db\.select\(\)\.from\(attendanceExceptionEvents\)/);
});
