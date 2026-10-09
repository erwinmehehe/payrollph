import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const route = readFileSync("src/app/api/workforce/live-floor/route.ts", "utf8");
const ui = readFileSync("src/components/workspace/workforce-live-floor.tsx", "utf8");

test("manager live floor enforces tenant membership, scope and custom role gates before reading workers", () => {
  assert.match(route, /getSessionUser\(\)/);
  assert.match(route, /assertOrganizationRole\(user\.id, organizationId, WORKFORCE_MANAGER_ROLES/);
  assert.match(route, /access\.companyWide/);
  assert.match(route, /eq\(employees\.orgUnitId, access\.orgUnitId!\)/);
  assert.match(route, /\.where\(scope\)/);
});
test("live floor queries workers with bounded SQL pagination, not all tenant workers or N+1 schedule reads", () => {
  assert.match(route, /\.limit\(pageSize\)\.offset\(\(page - 1\) \* pageSize\)/);
  assert.match(route, /schedulePatterns/);
  assert.match(route, /resolveDailySchedule\(/);
  assert.doesNotMatch(route, /resolveEmployeeScheduleWindow\(/);
  assert.match(route, /leaveRequestIntervals/);
  assert.match(route, /separationRecords/);
});
test("live floor has no roster, payroll or clocking mutations and clearly distinguishes page-local counts", () => {
  assert.doesNotMatch(route, /db\.(insert|update|delete)\(/);
  assert.match(route, /"Cache-Control": "private, no-store"/);
  assert.match(ui, /Counts apply to this page only/);
  assert.match(ui, /Not proof of onsite presence or an absence finding/);
});
