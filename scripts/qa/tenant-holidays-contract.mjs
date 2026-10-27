/**
 * Pure fail-closed contracts for the uncredited Holiday Calendar GET/POST/PATCH/DELETE.
 * No app, DB, provider, global release flag or manifest imports.
 */
import assert from "node:assert/strict";

const sortIds = (xs) => [...xs].sort((a, b) => a - b);
const protectedTables = Object.freeze([
  "organization", "employees", "units", "worksites", "payrollRuns",
  "payrollEntries", "approvalTasks",
]);
const actionNames = Object.freeze({
  create: "Payroll holiday declared",
  update: "Payroll holiday updated",
  delete: "Payroll holiday removed",
});

export function assertHolidayList(response, { organizationId, rows, forbiddenIds = [], forbiddenMarkers = [] }) {
  assert.equal(response.status, 200, "authorized holiday GET must return 200");
  assert.ok(Array.isArray(response.json?.holidays), "holidays must be a real array");
  assert.ok(rows.length > 0, "positive control must have populated persisted holidays");
  const actual = response.json.holidays;
  assert.deepEqual(sortIds(actual.map((row) => row.id)), sortIds(rows.map((row) => row.id)),
    "GET must return the exact owned and authorized holiday IDs (not an empty or foreign list)");
  for (const row of actual) {
    assert.equal(row.organizationId, organizationId, "GET disclosed another employer's holiday");
    assert.ok(!forbiddenIds.includes(row.id), "GET exposed an excluded real holiday ID");
    const match = rows.find((expected) => expected.id === row.id);
    assert.ok(match, "unexpected holiday in GET");
    for (const name of ["holidayDate", "name", "kind", "orgUnitId", "worksiteId"]) {
      assert.equal(row[name] ?? null, match[name] ?? null,
        "GET substituted another tenant, unit or worksite " + name);
    }
  }
  for (const marker of forbiddenMarkers) {
    assert.ok(marker && !response.text.includes(marker),
      "GET response disclosed a foreign tenant or restricted unit marker");
  }
}

export function assertHolidayDenial(response, expectedStatus, forbiddenMarkers = []) {
  assert.equal(response.status, expectedStatus, "unauthorized or invalid holiday operation was not rejected");
  for (const marker of forbiddenMarkers) {
    assert.ok(marker && !response.text.includes(marker), "holiday denial leaked restricted employer data");
    assert.ok(![...response.headers].some(([k, v]) => (k + ":" + v).includes(marker)),
      "holiday denial leaked restricted employer data in a header");
  }
}

export function assertHolidayUnchanged(before, after, label) {
  assert.deepEqual(after, before, label + ": holiday, payroll, approval and audit DB rows must remain unchanged");
}

export function assertHolidayTransition(before, after, response, {
  action, organizationId, ownerName, holidayId, holidayDate, name,
  kind, orgUnitId = null, worksiteId = null, releasedRunId,
}) {
  assert.ok(Object.hasOwn(actionNames, action), "unknown holiday action");
  assert.equal(response.status, action === "create" ? 201 : 200,
    "own mutation must return genuine success");
  for (const key of protectedTables) {
    assert.deepEqual(after[key], before[key],
      "holiday mutation must not change " + key + ", including payroll and approvals");
  }
  const oldRow = before.holidays.find((r) => r.id === holidayId);
  const newRow = after.holidays.find((r) => r.id === holidayId);
  const beforeOthers = before.holidays.filter((r) => r.id !== holidayId);
  const afterOthers = after.holidays.filter((r) => r.id !== holidayId);
  assert.deepEqual(afterOthers, beforeOthers,
    "only the explicitly targeted holiday may change");
  if (action === "create") {
    assert.ok(!oldRow && newRow, "201 must persist a NEW owned holiday");
    assert.equal(after.holidays.length, before.holidays.length + 1);
  } else if (action === "update") {
    assert.ok(oldRow && newRow, "200 update must preserve the target row ID");
    assert.equal(after.holidays.length, before.holidays.length);
    assert.notDeepEqual(newRow, oldRow, "a successful PATCH cannot be a no-op");
  } else {
    assert.ok(oldRow && !newRow, "200 DELETE must actually remove the owned holiday");
    assert.equal(after.holidays.length, before.holidays.length - 1);
  }
  if (action !== "delete") {
    assert.ok(Number.isSafeInteger(holidayId) && holidayId > 0);
    assert.equal(response.json?.id, holidayId);
    for (const [key, value] of Object.entries({
      organizationId, holidayDate, name, kind, orgUnitId, worksiteId,
    })) {
      assert.equal(newRow[key] ?? null, value, "persisted holiday " + key + " does not match");
      assert.equal(response.json?.[key] ?? null, value, "HTTP holiday " + key + " does not match");
    }
  } else {
    assert.equal(response.json?.ok, true, "DELETE must confirm the deleted record");
  }
  assert.equal(after.audit.length, before.audit.length + 1,
    "each successful holiday mutation must append exactly one audit event");
  assert.deepEqual(after.audit.slice(0, -1), before.audit, "existing audits must remain immutable");
  const event = after.audit.at(-1);
  assert.equal(event.organizationId, organizationId);
  assert.equal(event.actor, ownerName);
  assert.equal(event.action, actionNames[action]);
  assert.equal(event.metadata?.holidayId, holidayId);
  assert.deepEqual(event.metadata?.invalidatedPayrollRunIds, [],
    "never invalidate a Released synthetic payroll run");
  assert.deepEqual(event.metadata?.releasedPayrollRunIdsRequiringRetroReview, [releasedRunId],
    "Released synthetic payroll run must remain untouched but be flagged for retro review");
}
