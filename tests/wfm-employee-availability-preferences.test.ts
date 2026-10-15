import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { EmployeeAvailabilityPreferences } from "../src/components/employee-availability-preferences";
import { availabilityConflictForShift, preferredForShift } from "../src/lib/workforce-coverage";
import {
  addAvailabilityDays,
  availabilityRemovalDecision,
  contradictoryAvailability,
  parseAvailabilityRemoval,
  parseEmployeeAvailabilityDraft,
  sameAvailabilityRule,
  validAvailabilityDate,
  type EmployeeAvailabilityDraft,
} from "../src/lib/workforce-employee-availability-preferences";

const today = "2026-10-15";
const draft: EmployeeAvailabilityDraft = {
  weekday: 1,
  startTime: "08:00",
  endTime: "17:00",
  availabilityType: "preferred",
  effectiveFrom: "2026-10-15",
  effectiveUntil: "2027-01-31",
  notes: null,
};
const command = { action: "create", ...draft };

test("employee rules accept both preference types, Manila weekday convention, and strict valid dates", () => {
  const success = parseEmployeeAvailabilityDraft(command, today);
  assert.equal(success.ok, true);
  if (success.ok) assert.deepEqual(success.value, draft);
  const blocked = parseEmployeeAvailabilityDraft({ ...command, availabilityType: "unavailable", weekday: 0 }, today);
  assert.equal(blocked.ok, true);
  const saturday = parseEmployeeAvailabilityDraft({ ...command, weekday: 6 }, today);
  assert.equal(saturday.ok, true);
  for (const d of ["2026-02-29", "2026-04-31", "2026-13-01", "2026-1-01", "bad"]) {
    assert.equal(validAvailabilityDate(d), false, d);
  }
  assert.equal(validAvailabilityDate("2028-02-29"), true);
  assert.equal(addAvailabilityDays("2026-12-31", 1), "2027-01-01");
});

test("rejects forged employer/employee fields and unrecognized writable authority", () => {
  for (const injection of [
    { employeeId: 9001 }, { organizationId: 99 }, { approvalStatus: "approved" },
    { publishedRosterChanged: true }, { payrollMutationPerformed: true }, { action: "publish" },
  ]) {
    assert.equal(parseEmployeeAvailabilityDraft({ ...command, ...injection }, today).ok, false);
  }
  for (const invalid of [
    { weekday: -1 }, { weekday: 7 }, { weekday: 1.2 }, { weekday: "1" },
    { startTime: "24:00" }, { startTime: "9:00" }, { endTime: "08:00" },
    { endTime: "08:20" }, { startTime: "22:00", endTime: "06:00" },
    { availabilityType: "available" }, { effectiveFrom: "2026-10-14" },
    { effectiveFrom: "2027-11-01" }, { effectiveFrom: "2026-02-29" },
    { effectiveUntil: "2026-10-14" }, { effectiveUntil: "2027-11-01" },
    { notes: "x".repeat(241) }, { notes: 123 },
  ]) {
    assert.equal(parseEmployeeAvailabilityDraft({ ...command, ...invalid }, today).ok, false, JSON.stringify(invalid));
  }
  assert.equal(parseEmployeeAvailabilityDraft({ ...command, effectiveUntil: null }, today).ok, true);
  assert.equal(parseEmployeeAvailabilityDraft({ ...command, effectiveUntil: "" }, today).ok, true);
  assert.equal(parseEmployeeAvailabilityDraft(null, today).ok, false);
  assert.equal(parseEmployeeAvailabilityDraft([], today).ok, false);
});

test("same rule de-duplication and contradictory overlaps respect both effective and wall-time windows", () => {
  assert.equal(sameAvailabilityRule(draft, { ...draft, notes: "new notes" }), true);
  assert.equal(sameAvailabilityRule(draft, { ...draft, endTime: "18:00" }), false);
  assert.equal(contradictoryAvailability(draft, { ...draft, availabilityType: "unavailable" }), true);
  assert.equal(contradictoryAvailability(draft, { ...draft, availabilityType: "unavailable", startTime: "17:00", endTime: "18:00" }), false);
  assert.equal(contradictoryAvailability(draft, { ...draft, availabilityType: "unavailable", effectiveFrom: "2027-02-01" }), false);
  assert.equal(contradictoryAvailability(draft, { ...draft, availabilityType: "unavailable", weekday: 2 }), false);
  assert.equal(contradictoryAvailability(draft, { ...draft, availabilityType: "preferred" }), false);
});

test("withdrawals are scoped to a rule ID, retain past effective history, and never create payroll authority", () => {
  assert.deepEqual(parseAvailabilityRemoval({ action: "remove", ruleId: 17 }), { ok: true, ruleId: 17 });
  for (const input of [
    { action: "remove", ruleId: 17, employeeId: 8 },
    { action: "remove", ruleId: 17, organizationId: 2 },
    { action: "remove", ruleId: -1 }, { action: "remove", ruleId: 1.5 },
    { action: "delete", ruleId: 17 }, { action: "remove", ruleId: "17" },
  ]) {
    assert.equal(parseAvailabilityRemoval(input).ok, false);
  }
  assert.deepEqual(
    availabilityRemovalDecision({ effectiveFrom: "2026-11-01", effectiveUntil: null }, today),
    { action: "delete_future_rule" },
  );
  assert.deepEqual(
    availabilityRemovalDecision({ effectiveFrom: "2026-10-01", effectiveUntil: null }, today),
    { action: "close_current_rule", effectiveUntil: "2026-10-14" },
  );
  assert.deepEqual(
    availabilityRemovalDecision({ effectiveFrom: "2026-10-01", effectiveUntil: "2026-10-14" }, today),
    { action: "historical_rule", error: "Past availability history cannot be removed." },
  );
});

test("self API enforces opt-in flag, employee identity, cross-tenant boundaries, origin, rate and atomic audit", () => {
  const route = readFileSync("src/app/api/self/availability/route.ts", "utf8");
  const registry = readFileSync("src/lib/critical-release-flags.ts", "utf8");
  const manager = readFileSync("src/app/api/workforce/coverage/route.ts", "utf8");
  assert.ok(registry.includes('env: "WFM_EMPLOYEE_AVAILABILITY_ENABLED"'));
  assert.ok(route.includes('criticalReleaseFlagEnabled("wfmEmployeeAvailability")'));
  assert.ok(route.includes('session.role !== "employee"'));
  assert.ok(route.includes("session.employeeId"));
  assert.ok(route.includes("assertMembership(session.id, employee.organizationId)"));
  assert.ok(route.includes("eq(employeeAvailabilityRules.organizationId, scope.employee!.organizationId)"));
  assert.ok(route.includes("eq(employeeAvailabilityRules.employeeId, scope.employee!.id)"));
  assert.ok(route.includes("eq(employeeAvailabilityRules.organizationId, employee.organizationId)"));
  assert.ok(route.includes("eq(employeeAvailabilityRules.employeeId, employee.id)"));
  assert.ok(route.includes("eq(employeeAvailabilityRules.id, parsed.ruleId)"));
  assert.ok(route.includes("enforceSameOriginMutation(request)"));
  assert.ok(route.includes("enforceSensitiveActionRateLimit(request"));
  assert.ok(route.includes("publicDemoMutationDenied(session.email"));
  assert.ok(route.includes("readScheduleReceiptBody(request)"));
  assert.ok(route.includes('"Cache-Control": "private, no-store"'));
  assert.ok(route.includes('Vary: "Cookie"'));
  assert.ok(route.includes("db.transaction(async tx =>"));
  assert.ok(route.includes('action: "Employee WFM availability preference created"'));
  assert.ok(route.includes('action: "Employee WFM availability preference withdrawn"'));
  assert.ok(route.includes("publishedRosterChanged: false"));
  assert.ok(route.includes("payrollMutationPerformed: false"));
  for (const forbidden of [
    "scheduleOverrides", "employeeScheduleAssignments", "payrollRuns",
    "payrollEntries", "timePunches", "db.execute(sql",
  ]) {
    assert.equal(route.includes(forbidden), false, "Preference endpoint must not mutate " + forbidden);
  }
  assert.ok(manager.includes("availabilityConflictForShift"));
  assert.ok(manager.includes("preferredForShift"));
  assert.ok(manager.includes("employeeAvailabilityRules"));
  // Cross-midnight employee preferences must be loaded through the following
  // date; otherwise the engine cannot see Tuesday rules for Monday night.
  assert.ok(manager.includes("lte(employeeAvailabilityRules.effectiveFrom, addDays(endDate, 1))"));
  assert.equal(manager.split("lte(employeeAvailabilityRules.effectiveFrom, addDays(String(requirement.workDate), 1))").length - 1, 2);
  assert.ok(manager.includes("lte(employeeAvailabilityRules.effectiveFrom, addDays(String(shiftRow.workDate), 1))"));
});

test("the employee and manager workspaces use the same source without cross-employer HTML", () => {
  const panel = readFileSync("src/components/employee-workforce-panel.tsx", "utf8");
  const component = readFileSync("src/components/employee-availability-preferences.tsx", "utf8");
  const coverage = readFileSync("src/components/workspace/workforce-coverage-panel.tsx", "utf8");
  const planner = readFileSync("src/components/workspace/workforce-planner.tsx", "utf8");
  const portal = readFileSync("src/components/self-service-portal.tsx", "utf8");
  assert.ok(panel.includes('process.env.NEXT_PUBLIC_WFM_EMPLOYEE_AVAILABILITY_ENABLED === "true"'));
  assert.ok(panel.includes("<EmployeeAvailabilityPreferences language={language} />"));
  assert.ok(component.includes('fetch("/api/self/availability"'));
  assert.equal(component.includes("organizationId"), false);
  assert.equal(component.includes("employeeId"), false);
  assert.ok(component.includes('cache: "no-store"'));
  assert.ok(component.includes("controllerRef.current?.abort()"));
  assert.ok(component.includes("setSource(null)"));
  assert.ok(component.includes("No current or upcoming preferences recorded"));
  assert.ok(component.includes("Your published shifts, approved leave and payroll have not changed."));
  assert.ok(coverage.includes("data-wfm-employee-availability-evidence"));
  assert.ok(coverage.includes("(payload?.employees ?? []).map("));
  assert.ok(!coverage.includes("data.employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.employeeNo} · {employee.firstName} {employee.lastName}</option>)"));
  assert.ok(planner.includes("<WorkforceCoveragePanel key={organizationId}"));
  assert.ok(portal.includes("<EmployeeWorkforcePanel key={data.employer.id + ':' + data.employee.id}"));
  const html = renderToStaticMarkup(createElement(EmployeeAvailabilityPreferences, { language: "en" }));
  assert.match(html, /My availability and preferred shifts/);
  assert.match(html, /Save preference/);
  assert.match(html, /Overnight windows should be entered as two separate days/);
  assert.doesNotMatch(html, /organizationId|employeeId|Approved schedule/);
});


test("overnight shifts respect following-day unavailability and full split-day preference coverage", () => {
  const shift = { id: 12, startTime: "22:00", endTime: "06:00", spansMidnight: true };
  const monday = {
    id: 1, employeeId: 11, weekday: 1, startTime: "22:00",
    endTime: "23:59", availabilityType: "preferred" as const,
    effectiveFrom: "2026-10-05", effectiveUntil: null,
  };
  const tuesday = {
    id: 2, employeeId: 11, weekday: 2, startTime: "00:00",
    endTime: "06:00", availabilityType: "preferred" as const,
    effectiveFrom: "2026-10-06", effectiveUntil: null,
  };
  assert.equal(preferredForShift({
    rules: [monday, tuesday], date: "2026-10-05", shift,
  }), true, "continuous Monday 22:00-24:00 + Tuesday 00:00-06:00 matches entire overnight shift");
  assert.equal(preferredForShift({ rules: [monday], date: "2026-10-05", shift }), false,
    "a next-day preference is required; do not invent it");
  assert.equal(preferredForShift({
    rules: [{ ...monday, endTime: "23:58" }, tuesday], date: "2026-10-05", shift,
  }), false, "a missing minute means preference is not a full-shift match");
  assert.equal(preferredForShift({
    rules: [monday, { ...tuesday, effectiveFrom: "2026-10-07" }],
    date: "2026-10-05", shift,
  }), false, "future-dated following-day preferences cannot be applied early");

  const unavailableTuesday = {
    ...tuesday, availabilityType: "unavailable" as const,
    startTime: "02:00", endTime: "04:00",
  };
  assert.equal(availabilityConflictForShift({
    rules: [unavailableTuesday], date: "2026-10-05", shift,
  }), true, "next-day unavailability must be an overnight scheduling exclusion");
  assert.equal(availabilityConflictForShift({
    rules: [{ ...unavailableTuesday, startTime: "06:00", endTime: "08:00" }],
    date: "2026-10-05", shift,
  }), false, "time windows touching only at shift end do not overlap");
  assert.equal(availabilityConflictForShift({
    rules: [{ ...unavailableTuesday, effectiveUntil: "2026-10-05" }],
    date: "2026-10-05", shift,
  }), false, "expired rule must not block the next day");
  assert.equal(availabilityConflictForShift({
    rules: [{ ...monday, availabilityType: "unavailable", startTime: "00:00", endTime: "03:00" }],
    date: "2026-10-05", shift,
  }), false, "early Monday morning does not apply to Monday night/Tuesday morning");
  assert.equal(availabilityConflictForShift({
    rules: [{ ...unavailableTuesday, weekday: 3 }],
    date: "2026-10-05", shift,
  }), false, "Wednesday-only rule does not apply to Tuesday's shift segment");
});
