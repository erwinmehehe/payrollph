import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { createRows } from "../scripts/qa/tenant-table-rows/write/workforce-operations.mjs";
import { createRows as readRows } from "../scripts/qa/tenant-table-rows/read/workforce-rules.mjs";
import { TENANT_TABLE_PROFILES } from "../scripts/qa/tenant-table-env.mjs";
import { tenantFamilyCatalog } from "../scripts/qa/tenant-table-catalog.mjs";

const rows = createRows({ assert });
const c = { orgId: 11, workerId: 21, rank: 1, marker: "Fictional-own", owner: { id: 31, name: "Fictional owner" },
  seeded: { id: 41, shiftId: 61, shiftCode: "Fictional-own-SWAP", patternId: 51, requesterAssignmentId: 71, counterpartyAssignmentId: 72 },
  victim: { org: { id: 99 }, worker: { id: 102 } }, victimSeeded: { id: 101 } };

function evidence(key) {
  let before = [], after, json;
  if (key === "POST workforce/schedules") {
    const shift = { id: 91, organizationId: 11, code: c.marker.toUpperCase() + "-NEW", name: c.marker, startTime: "09:00", endTime: "18:00", breakMinutes: 60, spansMidnight: false }; after = [shift]; json = { shift };
  } else if (key === "POST workforce/overtime") {
    const request = { id: 91, organizationId: 11, employeeId: 21, workDate: "2099-03-03", requestedMinutes: 60, requestKind: "pre_approved", reason: c.marker, requestedByUserId: 31, requestedBy: c.owner.name, status: "pending", decidedAt: null }; after = [request]; json = { request };
  } else if (key === "POST workforce/coverage") {
    const availability = { id: 91, organizationId: 11, employeeId: 21, weekday: 1, startTime: "09:00", endTime: "18:00", availabilityType: "preferred", effectiveFrom: "2099-01-01", notes: c.marker, createdByUserId: 31 }; after = [availability]; json = { availability };
  } else if (key === "POST workforce/attendance-corrections") {
    const original = { workDate: "2026-03-03", timeIn: "2026-03-03T09:00:00.000Z", timeOut: "2026-03-03T18:00:00.000Z", breakStart: null, breakEnd: null, status: "Complete" };
    const correction = { id: 91, organizationId: 11, employeeId: 21, punchId: 41, workDate: "2026-03-03", reason: c.marker, originalPunchSnapshot: original, proposedPunchSnapshot: { ...original, timeIn: "2026-03-03T08:45:00.000Z" }, requestedByUserId: 31, status: "pending", decidedAt: null, appliedAt: null };
    before = { corrections: [], punches: [{ id: 41, organizationId: 11, employeeId: 21, ...original }] }; after = { corrections: [correction], punches: before.punches }; json = { correction };
  } else if (key === "POST workforce/schedule-swaps") {
    const snapshot = (date, assignmentId) => ({ date, source: "pattern", overrideId: null, assignmentId, patternId: 51, isRestDay: false, segments: [{ shiftDefinitionId: 61, shiftCode: c.seeded.shiftCode, startTime: "09:00", endTime: "18:00", breakMinutes: 60 }] });
    const swap = { id: 91, organizationId: 11, requesterEmployeeId: 21, counterpartyEmployeeId: 41, status: "pending", reason: c.marker, requestedByUserId: 31, requesterWorkDate: "2099-03-03", counterpartyWorkDate: "2099-03-04", requesterScheduleSnapshot: snapshot("2099-03-03", 71), counterpartyScheduleSnapshot: snapshot("2099-03-04", 72) };
    before = { swaps: [], assignments: [{ id: 71, organizationId: 11, employeeId: 21 }], overrides: [] }; after = { swaps: [swap], assignments: before.assignments, overrides: [] }; json = { swap };
  } else {
    const isRoster = key === "POST workforce/roster-rules";
    const policy = isRoster ? { active: false, maxDailyMinutes: 730, maxRollingSevenDayMinutes: 2880, minRestBetweenShiftsMinutes: 660, ordinaryDailyMinutes: 480, approvedOvertimeCapMinutes: 0, enforcementMode: "advisory" }
      : { minimumRestMinutes: 610, maxConsecutiveWorkingDays: 5, rollingSevenDayMinutes: 2400, enforcementMode: "advisory", active: false };
    const row = { id: 91, organizationId: 11, ...policy, ...(isRoster ? { updatedByUserId: 31 } : { updatedBy: c.owner.name }) };
    const audit = { id: 92, organizationId: 11, actor: c.owner.name, action: isRoster ? "WFM roster policy updated" : "WFM schedule guardrail policy updated", metadata: isRoster ? { changedByUserId: 31, reason: c.marker + " fictional policy", after: policy } : { policyId: 91, ...policy } };
    before = { policies: [], audits: [{ id: 1, organizationId: 11, action: "earlier action" }] }; after = { policies: [row], audits: [...before.audits, audit] }; json = { configured: true, policy };
  }
  return { before: structuredClone(before), after: structuredClone(after), response: { json: structuredClone(json) } };
}

for (const row of rows) {
  test(row.key + " requires genuine own persisted changes and rejects empty, foreign or swapped-response evidence", () => {
    const { before, after, response } = evidence(row.key); row.expect(before, after, c, response);
    assert.throws(() => row.expect(before, before, c, response));
    assert.throws(() => row.expect(before, after, { ...c, orgId: 99 }, response));
    assert.throws(() => row.expect(before, after, c, { json: {} }));
    const foreign = structuredClone(after); const target = Array.isArray(foreign) ? foreign[0] : Object.values(foreign).find(v => Array.isArray(v) && v.length)[0]; target.organizationId = 99;
    assert.throws(() => row.expect(before, foreign, c, response));
    if (response.json.policy) assert.throws(() => row.expect(before, after, c, { json: { ...response.json, configured: false } }));
    else {
      const badResponse = structuredClone(response); Object.values(badResponse.json)[0].id = 999;
      assert.throws(() => row.expect(before, after, c, badResponse));
    }
  });
  test(row.key + " binds real victim selectors without changing the own employer in forgery tests", () => {
    const own = row.ownBody(c), foreign = row.foreignBody(c); assert.equal(own.organizationId, 11); assert.equal(foreign.organizationId, 99); assert.notDeepEqual(own, foreign);
    if (row.forged) { const forged = row.forged.body(c); assert.equal(forged.organizationId, 11); assert.notDeepEqual(own, forged); assert.ok(Object.values(forged).some(v => [101, 102].includes(v))); assert.equal(row.forged.status, 404); }
  });
}

test("pending correction cannot rewrite the original punch or record an applied result", () => {
  const row = rows.find(r => r.key === "POST workforce/attendance-corrections");
  for (const mutate of [e => { e.after.punches[0].timeIn = "tampered"; }, e => { e.after.corrections[0].appliedAt = "2026-03-03"; }, e => { e.after.corrections[0].proposedPunchSnapshot = e.after.corrections[0].originalPunchSnapshot; }]) {
    const e = evidence(row.key); mutate(e); assert.throws(() => row.expect(e.before, e.after, c, e.response));
  }
});

test("pending swaps require genuine own schedules and cannot mutate assignments or overrides", () => {
  const row = rows.find(r => r.key === "POST workforce/schedule-swaps");
  for (const mutate of [e => { e.after.assignments[0].employeeId = 999; }, e => { e.after.overrides.push({ id: 999 }); }, e => { e.after.swaps[0].requesterScheduleSnapshot.source = "unassigned"; }, e => { e.after.swaps[0].counterpartyScheduleSnapshot.segments[0].shiftDefinitionId = 999; }]) {
    const e = evidence(row.key); mutate(e); assert.throws(() => row.expect(e.before, e.after, c, e.response));
  }
});

test("policy proofs require an actor-bound audit with the exact persisted policy", () => {
  for (const key of ["POST workforce/schedule-guardrails", "POST workforce/roster-rules"]) {
    const row = rows.find(r => r.key === key);
    for (const mutate of [e => { e.after.audits.pop(); }, e => { e.after.audits.at(-1).actor = "Foreign"; }, e => { e.after.audits.at(-1).metadata = {}; }, e => { e.after.policies[0].active = true; }]) {
      const e = evidence(key); mutate(e); assert.throws(() => row.expect(e.before, e.after, c, e.response));
    }
  }
});

test("roster GET proves configured own policy and rejects defaults or another employer's thresholds", () => {
  const row = readRows({ assert }).find(r => r.key === "GET workforce/roster-rules");
  const policy = evidence("POST workforce/roster-rules").response.json.policy, context = { ...c, seeded: { id: 41, policy } };
  row.prove({ json: { configured: true, policy } }, context);
  assert.throws(() => row.prove({ json: { configured: false, policy } }, context));
  assert.throws(() => row.prove({ json: { configured: true, policy: { ...policy, maxDailyMinutes: 740 } } }, context));
  assert.throws(() => row.prove({ json: {} }, context));
});

test("roster feature remains isolated to the synthetic flagged profile", () => {
  assert.equal(TENANT_TABLE_PROFILES["flagged-reads"].WFM_ROSTER_SCALE_RULES_ENABLED, "true");
  assert.equal(TENANT_TABLE_PROFILES.default.WFM_ROSTER_SCALE_RULES_ENABLED, undefined);
  const roster = rows.find(r => r.key === "POST workforce/roster-rules"); assert.equal(roster.profile, "flagged-reads");
  assert.deepEqual(roster.flags, ["WFM_ROSTER_SCALE_RULES_ENABLED"]);
});

test("all eight Workforce scenarios are credited, and every multi-action route proves each of its actions", () => {
  const keys = [...rows.map(r => r.key), "GET workforce/roster-rules"];
  assert.equal(keys.length, 8);
  assert.equal(new Set(keys).size, 8);
  // These five were held as GAP while only one action each was exercised. Each row now proves every action
  // branch its route handles (the primary request plus `exercise`), so all eight are credited.
  const multiAction = ["POST workforce/schedules", "POST workforce/overtime", "POST workforce/attendance-corrections",
    "POST workforce/coverage", "POST workforce/schedule-swaps"];
  const catalog = [...tenantFamilyCatalog("write"), ...tenantFamilyCatalog("read")];
  for (const key of keys) assert.equal(catalog.filter(r => r.key === key).length, 1);
  for (const key of multiAction) {
    const row = rows.find(r => r.key === key);
    assert.equal(typeof row.exercise, "function", key + " must execute its remaining action branches");
    const source = readFileSync("src/app/api/" + key.split(" ")[1] + "/route.ts", "utf8");
    const actions = [...new Set([...source.matchAll(/action === "([a-z_]+)"/g)].map(m => m[1]))];
    assert.ok(actions.length >= 2, key + " is a multi-action route");
    const text = catalog.find(r => r.key === key).text;
    for (const action of actions) assert.ok(text.includes('action: "' + action + '"'), key + " must exercise action " + action);
  }
  const file = "scripts/qa/tenant-isolation-coverage-manifest.json";
  const text = readFileSync(file, "utf8"), manifest = JSON.parse(text);
  for (const key of keys) {
    const [method, route] = key.split(" ");
    const record = Object.values(manifest.allApiRouteFiles).find(r => r.route === route);
    const entry = record.methods.find(m => m.name === method);
    assert.equal(entry.status, "COVERED", key);
    assert.ok(entry.testedBy?.rowFile, key + " requires a source-pinned executable proof");
  }
  const report = JSON.parse(execFileSync(process.execPath,
    ["scripts/qa/tenant-table-credit.mjs", "--refresh-links", "--check"], { encoding: "utf8" }));
  assert.equal(report.newlyCredited, 0);
  assert.deepEqual(report.before, report.after);
  assert.equal(readFileSync(file, "utf8"), text, "proof-link dry runs must not modify the inventory");
});
