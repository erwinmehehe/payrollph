import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { createRows } from "../scripts/qa/tenant-table-rows/write/performance-growth.mjs";
import { tenantFamilyCatalog } from "../scripts/qa/tenant-table-catalog.mjs";

const rows = createRows({ assert });
const c = { orgId: 11, workerId: 21, rank: 1, marker: "Fictional-own", owner: { id: 31, name: "Fictional owner" },
  seeded: { id: 41, skillId: 42, jobProfileId: 51, reviewId: 61 },
  victim: { org: { id: 99 }, worker: { id: 102 } }, victimSeeded: { id: 101, skillId: 103 } };

function evidence(key) {
  let before = [], after, json;
  if (key === "POST performance") {
    json = { id: 71, organizationId: 11, employeeId: 21, title: c.marker + " new goal", scope: "employee", weight: "25.00", progress: 0, status: "active", dueDate: "2099-12-31", createdByUserId: 31 }; after = [json];
  } else if (key === "PATCH performance") {
    const old = { id: 41, organizationId: 11, employeeId: 21, title: c.marker + " existing goal", progress: 0, status: "active" }; before = [old]; after = [{ ...old, progress: 40 }]; json = after[0];
  } else if (key === "POST performance/competencies") {
    json = { id: 71, organizationId: 11, jobProfileId: 41, skillId: 42, minimumProficiency: 3, mandatory: true, createdByUserId: 31 }; after = [json];
  } else if (key === "PATCH performance/competencies") {
    const old = { id: 41, organizationId: 11, jobProfileId: 51, skillId: 42, minimumProficiency: 1, mandatory: true }; before = [old]; after = [{ ...old, minimumProficiency: 4, mandatory: false }]; json = after[0];
  } else if (key === "POST performance/continuous") {
    json = { id: 71, organizationId: 11, employeeId: 21, managerUserId: 31, createdByUserId: 31, agenda: c.marker + " new meeting", status: "scheduled", scheduledFor: "2099-03-01T09:00:00.000Z" }; after = [json];
  } else if (key === "POST performance/development-plans") {
    json = { id: 71, organizationId: 11, planId: 41, title: c.marker + " new milestone", detail: c.marker, dueDate: "2099-12-01", status: "open" };
    before = { milestones: [], events: [], plans: [{ id: 41, organizationId: 11, status: "planned" }] };
    after = { milestones: [json], events: [{ id: 81, organizationId: 11, planId: 41, actorUserId: 31, eventType: "milestone_created", afterSnapshot: { milestoneId: 71 } }], plans: before.plans };
  } else if (key === "POST performance/calibration") {
    json = { id: 71, organizationId: 11, cycleId: 41, name: c.marker + " calibration session", notes: c.marker, status: "open", createdByUserId: 31, finalizedAt: null };
    before = { sessions: [], entries: [], flags: [], reviews: [{ id: 61, organizationId: 11, finalScore: "3.00" }] };
    after = { sessions: [json], entries: [{ id: 81, organizationId: 11, sessionId: 71, reviewId: 61, originalScore: "3.00", calibratedScore: null }], flags: [], reviews: before.reviews };
  } else {
    const snapshot = key === "PATCH performance/calibration"
      ? { version: 1, minimumManagerSample: 11, managerMeanDeviationThreshold: 1, highRatingThreshold: 4, highRatingShareThreshold: 80, lowRatingThreshold: 2, lowRatingShareThreshold: 50, largeScoreChangeThreshold: 1, requireFlagResolution: true }
      : { version: 1, enabled: false, reminderDaysBefore: 6, escalationDaysOverdue: 11, notifyManagerOnEmployeeItem: false, notifyPeopleAdminOnEscalation: false };
    before = { policies: [], events: [] };
    after = { policies: [{ ...snapshot, id: 71, organizationId: 11, updatedByUserId: 31 }], events: [{ id: 81, organizationId: 11, policyId: 71, actorUserId: 31, fromVersion: null, toVersion: 1, beforeSnapshot: null, afterSnapshot: snapshot }] };
    json = { [key === "PATCH performance/calibration" ? "policy" : "reminderPolicy"]: snapshot };
  }
  return { before: structuredClone(before), after: structuredClone(after), response: { json: structuredClone(json) } };
}

for (const row of rows) {
  test(row.key + " rejects unchanged, foreign and swapped-response evidence", () => {
    const { before, after, response } = evidence(row.key); row.expect(before, after, c, response);
    assert.throws(() => row.expect(before, before, c, response));
    assert.throws(() => row.expect(before, after, { ...c, orgId: 99 }, response));
    assert.throws(() => row.expect(before, after, c, { json: {} }));
    const foreign = structuredClone(after);
    const target = Array.isArray(foreign) ? foreign[0] : Object.values(foreign).find(v => Array.isArray(v) && v.length)[0];
    target.organizationId = 99; assert.throws(() => row.expect(before, foreign, c, response));
    if (response.json.id) assert.throws(() => row.expect(before, after, c, { json: { ...response.json, id: 999 } }));
  });
  test(row.key + " keeps real victim requests separate from own requests", () => {
    const own = row.ownBody(c), foreign = row.foreignBody(c); assert.notDeepEqual(own, foreign);
    if (row.key === "PATCH performance") { assert.equal(own.id, 41); assert.equal(foreign.id, 101); }
    else { assert.equal(own.organizationId, 11); assert.equal(foreign.organizationId, 99); }
    if (row.forged) {
      const forged = row.forged.body(c); assert.equal(forged.organizationId, 11); assert.notDeepEqual(own, forged);
      assert.ok(Object.values(forged).some(v => [101, 102, 103].includes(v))); assert.equal(row.forged.status, 404);
    }
  });
}

test("companion evidence is employer/actor/target bound and cannot be omitted", () => {
  for (const key of ["POST performance/development-plans", "POST performance/calibration", "PATCH performance/calibration", "PATCH performance/follow-through-governance"]) {
    const row = rows.find(r => r.key === key), { before, after, response } = evidence(key);
    const field = key === "POST performance/calibration" ? "entries" : "events";
    assert.throws(() => row.expect(before, { ...after, [field]: [] }, c, response));
    const wrong = structuredClone(after); wrong[field][0][field === "entries" ? "reviewId" : "actorUserId"] = 999;
    assert.throws(() => row.expect(before, wrong, c, response));
  }
});

test("milestone and calibration creation cannot silently rewrite plan or review evidence", () => {
  for (const [key, field] of [["POST performance/development-plans", "plans"], ["POST performance/calibration", "reviews"]]) {
    const row = rows.find(r => r.key === key), { before, after, response } = evidence(key);
    after[field][0].status = "tampered"; assert.throws(() => row.expect(before, after, c, response));
  }
});

test("new method proofs reject unrelated own-row mutations", () => {
  for (const key of ["POST performance", "PATCH performance", "POST performance/competencies", "PATCH performance/competencies", "POST performance/continuous"]) {
    const row = rows.find(r => r.key === key), { before, after, response } = evidence(key);
    before.push({ id: 901, organizationId: 11, marker: "keep" }); after.push({ id: 901, organizationId: 11, marker: "changed" });
    assert.throws(() => row.expect(before, after, c, response));
  }
});

test("family keeps nine unique methods with only reviewed calibration creation credited", () => {
  assert.equal(rows.length, 9); assert.equal(new Set(rows.map(r => r.key)).size, 9);
  const excluded = ["PATCH performance/action-items", "PATCH performance/continuous", "POST performance/action-items", "PATCH performance/development-plans"];
  assert.ok(rows.every(r => !excluded.includes(r.key)));
  const catalog = tenantFamilyCatalog("write"); assert.equal(catalog.filter(r => r.file.endsWith("/performance-growth.mjs")).length, 9);
  const file = "scripts/qa/tenant-isolation-coverage-manifest.json", text = readFileSync(file, "utf8"), manifest = JSON.parse(text);
  for (const row of rows) {
    const [method, route] = row.key.split(" "), record = Object.values(manifest.allApiRouteFiles).find(r => r.route === route);
    assert.equal(record.methods.find(m => m.name === method).status, row.key === "POST performance/calibration" ? "COVERED" : "GAP");
  }
  const report = JSON.parse(execFileSync(process.execPath, ["scripts/qa/tenant-table-credit.mjs", "--refresh-links", "--check"], { encoding: "utf8" }));
  assert.equal(report.newlyCredited, 0); assert.deepEqual(report.before, report.after); assert.equal(readFileSync(file, "utf8"), text);
});
