import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { createRows } from "../scripts/qa/tenant-table-rows/write/performance.mjs";

const rows = createRows({ assert });
const context = { orgId: 11, workerId: 21, marker: "Fictional-own", owner: { id: 31 },
  seeded: { id: 41, oneOnOneId: 51 }, victim: { org: { id: 99 } }, victimSeeded: { id: 101 } };

function evidence(key) {
  const before = { meetings: [], items: [], events: [] };
  const after = structuredClone(before);
  let id;
  if (key === "PATCH performance/action-items") {
    const item = { id: 41, organizationId: 11, employeeId: 21, oneOnOneId: 51, title: context.marker + " seeded action", status: "open" };
    before.items.push(item); after.items.push({ ...item, status: "in_progress" });
    after.events.push({ id: 61, organizationId: 11, actorUserId: 31, actionItemId: 41, eventType: "status_changed", beforeSnapshot: { status: "open" }, afterSnapshot: { status: "in_progress" } });
    id = 41;
  } else if (key === "PATCH performance/continuous") {
    const meeting = { id: 41, organizationId: 11, employeeId: 21, managerUserId: 31, agenda: "original", status: "scheduled", scheduledFor: "2026-03-01T09:00:00.000Z" };
    before.meetings.push(meeting); after.meetings.push({ ...meeting, agenda: context.marker + " rescheduled", scheduledFor: "2026-03-02T09:00:00.000Z" });
    id = 41;
  } else {
    after.items.push({ id: 71, organizationId: 11, employeeId: 21, oneOnOneId: 41, title: context.marker + " new action", ownerKind: "employee", ownerEmployeeId: 21, visibility: "employee_shared", createdByUserId: 31, status: "open", dueDate: "2026-03-10" });
    after.events.push({ id: 81, organizationId: 11, actionItemId: 71, employeeId: 21, actorUserId: 31, eventType: "created", beforeSnapshot: null, afterSnapshot: { id: 71 } });
    id = 71;
  }
  return { before, after, response: { json: { id, organizationId: 11 } } };
}

for (const key of ["PATCH performance/action-items", "PATCH performance/continuous", "POST performance/action-items"]) {
  const row = rows.find(r => r.key === key);
  test(key + " proof rejects unchanged, other-employer and mismatched response evidence", () => {
    const { before, after, response } = evidence(key);
    row.expect(before, after, context, response);
    assert.throws(() => row.expect(before, before, context, response));
    assert.throws(() => row.expect(before, after, { ...context, orgId: 12 }, response));
    assert.throws(() => row.expect(before, after, { ...context, workerId: 22 }, response));
    assert.throws(() => row.expect(before, after, context, { json: { ...response.json, id: 999 } }));
    assert.throws(() => row.expect(before, after, context, { json: { ...response.json, organizationId: 99 } }));
    if (after.events.length) {
      const wrongActor = structuredClone(after); wrongActor.events[0].actorUserId = 999;
      assert.throws(() => row.expect(before, wrongActor, context, response));
      assert.throws(() => row.expect(before, { ...after, events: [] }, context, response));
    }
  });
  test(key + " own, foreign and forged selectors stay distinct", () => {
    const own = row.ownBody(context), foreign = row.foreignBody(context), forged = row.forged.body(context);
    const idField = key === "PATCH performance/action-items" ? "id" : "oneOnOneId";
    assert.equal(own.organizationId, 11); assert.equal(own[idField], 41);
    assert.equal(foreign.organizationId, 99); assert.equal(foreign[idField], 101);
    assert.equal(forged.organizationId, 11); assert.equal(forged[idField], 101);
    assert.equal(row.forged.status, 404);
  });
}

test("source-link refresh preserves the three executed Performance credits", () => {
  const file = "scripts/qa/tenant-isolation-coverage-manifest.json";
  const before = readFileSync(file, "utf8");
  const report = JSON.parse(execFileSync(process.execPath, ["scripts/qa/tenant-table-credit.mjs", "--refresh-links", "--check"], { encoding: "utf8" }));
  assert.equal(report.newlyCredited, 0); assert.deepEqual(report.before, report.after);
  assert.equal(readFileSync(file, "utf8"), before);
  const manifest = JSON.parse(before);
  for (const key of ["PATCH performance/action-items", "PATCH performance/continuous", "POST performance/action-items"]) {
    const [verb, route] = key.split(" ");
    const record = Object.values(manifest.allApiRouteFiles).find(r => r.route === route);
    assert.equal(record.methods.find(m => m.name === verb).status, "COVERED");
  }
});
