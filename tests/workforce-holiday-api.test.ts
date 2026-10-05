import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const holidayRoute = readFileSync("src/app/api/holidays/route.ts", "utf8");
const payroll = readFileSync("src/lib/payroll-engine.ts", "utf8");
const panel = readFileSync(
  "src/components/workspace/workforce-worksites-panel.tsx",
  "utf8",
);

test("holiday API validates worksite tenant ownership and optional org-unit consistency", () => {
  assert.ok(holidayRoute.includes("validateWorksite("));
  assert.ok(holidayRoute.includes("eq(worksites.organizationId, organizationId)"));
  assert.ok(holidayRoute.includes("The selected worksite does not belong to this organization."));
  assert.ok(holidayRoute.includes("The selected worksite does not belong to the selected organization unit."));
});

test("holiday mutations persist and audit physical worksite scope", () => {
  assert.ok(holidayRoute.includes("worksiteId,"));
  assert.ok(holidayRoute.includes("worksiteId: existing.worksiteId"));
  assert.ok(holidayRoute.includes("after: { holidayDate, name, kind, orgUnitId, worksiteId }"));
});

test("payroll filters local holidays by resolved worksite on the holiday date", () => {
  assert.ok(payroll.includes("workforceHolidayApplies({"));
  assert.ok(payroll.includes("resolveWorkforceScheduleForDate(holiday.date).worksiteId"));
  assert.ok(payroll.includes("worksiteId: row.worksiteId"));
  assert.ok(payroll.includes("workforceHolidayScope: applicableLocalHolidayRows.map"));
  assert.ok(payroll.includes("resolvedWorksiteId: resolveWorkforceScheduleForDate(holiday.date).worksiteId"));
  assert.ok(!payroll.includes("if (row.worksiteId != null) return [];"));
});

test("worksite UI exposes local holiday creation without changing national rules", () => {
  assert.ok(panel.includes("Worksite holiday calendar"));
  assert.ok(panel.includes('fetch("/api/holidays"'));
  assert.ok(panel.includes("worksiteId: Number(holidayWorksiteId)"));
  assert.ok(panel.includes("Special non-working"));
});
