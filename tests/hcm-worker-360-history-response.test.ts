import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { isVerifiedWorker360OlderPage as valid } from "../src/lib/hcm-worker-360-history-response";

const asOf = "2026-10-15";
const cursor = { effectiveDate: "2026-10-15", id: 9 };
const displayed = [11, 10, 9];

function response() {
  return {
    tenantId: 21, employeeId: 31, asOfDate: asOf,
    observedAt: "2026-10-15T07:00:00.000Z",
    worker: {
      source: "employees", id: 31, employeeNo: "FICTIONAL-31",
      name: "Fictional Employee", currentTitle: "Operator",
      currentStatus: "Active", startedOn: "2026-01-05",
    },
    primaryAssignment: {
      source: "position_assignments",
      selection: { status: "not_recorded", assignment: null },
    },
    employmentEvents: {
      source: "worker_employment_events",
      preview: {
        items: [
          { id: 8, effectiveDate: "2026-09-10", eventType: "promotion", positionAssignmentId: null },
          { id: 7, effectiveDate: "2026-08-01", eventType: "transfer", positionAssignmentId: null },
        ],
        hasMore: true, partial: true,
        nextCursor: { effectiveDate: "2026-08-01", id: 7 },
      },
    },
  };
}

function changed(fn: (r: ReturnType<typeof response>) => void) {
  const r = response();
  fn(r);
  return r;
}

test("valid authorized continuation and bounded terminal pages are accepted", () => {
  assert.equal(valid(response(), 21, 31, asOf, cursor, displayed), true);
  assert.equal(valid(changed(r => {
    r.employmentEvents.preview.items = [];
    r.employmentEvents.preview.hasMore = false;
    r.employmentEvents.preview.partial = false;
    r.employmentEvents.preview.nextCursor = null as unknown as typeof r.employmentEvents.preview.nextCursor;
  }), 21, 31, asOf, cursor, displayed), true);
});

test("cross-employer and mismatched nested employee identity never render", () => {
  assert.equal(valid(response(), 22, 31, asOf, cursor, displayed), false);
  assert.equal(valid(response(), 21, 32, asOf, cursor, displayed), false);
  assert.equal(valid(changed(r => { r.worker.id = 32; }), 21, 31, asOf, cursor, displayed), false);
  assert.equal(valid(changed(r => { r.worker.source = "other"; }), 21, 31, asOf, cursor, displayed), false);
});

test("cursor pages cannot replay an already displayed event or return a newer row", () => {
  assert.equal(valid(changed(r => { r.employmentEvents.preview.items[0].id = 11; }), 21, 31, asOf, cursor, displayed), false);
  assert.equal(valid(changed(r => {
    r.employmentEvents.preview.items[0].id = 10;
    r.employmentEvents.preview.items[0].effectiveDate = "2026-10-15";
  }), 21, 31, asOf, cursor, displayed), false);
  assert.equal(valid(changed(r => {
    r.employmentEvents.preview.items[0].id = 12;
    r.employmentEvents.preview.items[0].effectiveDate = "2026-10-15";
  }), 21, 31, asOf, cursor, displayed), false);
  assert.equal(valid(response(), 21, 31, asOf,
    { effectiveDate: "2026-02-30", id: 9 }, displayed), false);
});

test("unsorted, future, untrusted or forged continuation data fail closed", () => {
  assert.equal(valid(changed(r => { r.employmentEvents.preview.items.reverse(); }), 21, 31, asOf, cursor, displayed), false);
  assert.equal(valid(changed(r => { r.employmentEvents.preview.items[0].effectiveDate = "2027-01-01"; }), 21, 31, asOf, cursor, displayed), false);
  assert.equal(valid(changed(r => { r.employmentEvents.preview.items[0].eventType = "private notes / salary"; }), 21, 31, asOf, cursor, displayed), false);
  assert.equal(valid(changed(r => { r.employmentEvents.preview.nextCursor.id = 8; }), 21, 31, asOf, cursor, displayed), false);
  assert.equal(valid(changed(r => { r.employmentEvents.preview.partial = false; }), 21, 31, asOf, cursor, displayed), false);
  assert.equal(valid(changed(r => { r.observedAt = "2026-02-30T07:00:00.000Z"; }), 21, 31, asOf, cursor, displayed), false);
});

test("malformed HTTP JSON is never treated as a successful history read", () => {
  for (const v of [null, {}, [], { tenantId: 21, employeeId: 31 }, "OK"]) {
    assert.equal(valid(v, 21, 31, asOf, cursor, displayed), false);
  }
  assert.equal(valid(response(), 21, 31, asOf, cursor, [9, -1]), false);
});

test("component verifies the complete continuation before appending and never edits the API", () => {
  const client = readFileSync("src/components/hcm-worker-360-history.tsx", "utf8");
  const guard = client.indexOf("if (!isVerifiedWorker360OlderPage(");
  const append = client.indexOf("setOlder(current =>");
  assert.ok(guard >= 0 && guard < append);
  assert.match(client, /const payload: unknown = await response\.json\(\)/);
  assert.match(client, /displayed\.map\(event => event\.id\)/);
  assert.match(client, /controller\.signal\.aborted/);
  assert.ok(!client.includes('method: "POST"'));
  assert.ok(!client.includes('method: "PATCH"'));
});
