import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Worker360History } from "../src/components/hcm-worker-360-history";
import {
  projectWorker360Events, validWorker360EventCursor, worker360EventBeforeCursor,
  type Worker360Event,
} from "../src/lib/hcm-worker-360-projection";

const asOf = "2026-10-15";
const source: Worker360Event[] = [
  { id: 10, effectiveDate: "2026-10-15", eventType: "hire", positionAssignmentId: 5 },
  { id: 9, effectiveDate: "2026-10-15", eventType: "promotion", positionAssignmentId: 5 },
  { id: 8, effectiveDate: "2026-09-12", eventType: "transfer", positionAssignmentId: 4 },
  { id: 7, effectiveDate: "2026-08-12", eventType: "payroll/secret not allowed", positionAssignmentId: null },
  { id: 6, effectiveDate: "2027-01-01", eventType: "future", positionAssignmentId: null },
  { id: 5, effectiveDate: "2025-11-01", eventType: "offboard", positionAssignmentId: 3 },
];

test("Worker 360 pages by stable effective-date + ID cursor, never duplicating tie-day events", () => {
  const before = JSON.stringify(source);
  const first = projectWorker360Events(source, asOf, 2);
  assert.deepEqual(first.items.map(item => item.id), [10, 9]);
  assert.deepEqual(first.nextCursor, { effectiveDate: asOf, id: 9 });
  assert.equal(first.hasMore, true);
  const second = projectWorker360Events(source, asOf, 2, first.nextCursor!);
  assert.deepEqual(second.items.map(item => item.id), [8, 7]);
  assert.equal(second.items[1].eventType, "other", "private or legacy free-text type is sanitized");
  assert.deepEqual(second.nextCursor, { effectiveDate: "2026-08-12", id: 7 });
  const third = projectWorker360Events(source, asOf, 2, second.nextCursor!);
  assert.deepEqual(third.items.map(item => item.id), [5]);
  assert.equal(third.hasMore, false);
  assert.equal(third.partial, false);
  assert.equal(third.nextCursor, null);
  assert.deepEqual([...first.items, ...second.items, ...third.items].map(item => item.id), [10, 9, 8, 7, 5]);
  assert.equal(JSON.stringify(source), before, "projection does not mutate source data");
});

test("cursor validation rejects impossible, future, fractional, zero and forged input", () => {
  assert.equal(validWorker360EventCursor({ effectiveDate: asOf, id: 1 }, asOf), true);
  assert.equal(validWorker360EventCursor({ effectiveDate: "2026-02-29", id: 1 }, asOf), false);
  assert.equal(validWorker360EventCursor({ effectiveDate: "2026-10-16", id: 1 }, asOf), false);
  for (const id of [0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(validWorker360EventCursor({ effectiveDate: asOf, id }, asOf), false);
  }
  assert.equal(worker360EventBeforeCursor({ effectiveDate: asOf, id: 8 }, { effectiveDate: asOf, id: 9 }), true);
  assert.equal(worker360EventBeforeCursor({ effectiveDate: asOf, id: 10 }, { effectiveDate: asOf, id: 9 }), false);
  assert.throws(() => projectWorker360Events(source, asOf, 2, { effectiveDate: "2027-01-01", id: 9 }));
});

test("history widget renders a source preview and read-only older-events action", () => {
  const partial = projectWorker360Events(source, asOf, 2);
  const markup = renderToStaticMarkup(createElement(Worker360History, {
    organizationId: 11, employeeId: 3, asOfDate: asOf, preview: partial,
  }));
  assert.match(markup, /Recorded events/);
  assert.match(markup, /Load older events/);
  assert.match(markup, /history shown here is incomplete/);
  assert.match(markup, /Event #10/);
  assert.doesNotMatch(markup, /payroll\/secret not allowed/);
  assert.doesNotMatch(markup, /\bApprove\b|\bRelease\b|\bExport\b/);
  const final = renderToStaticMarkup(createElement(Worker360History, {
    organizationId: 11, employeeId: 3, asOfDate: asOf,
    preview: projectWorker360Events(source, asOf, 25),
  }));
  assert.doesNotMatch(final, /Load older events/);
});

test("cursor enters the authorized no-store GET and tenant-filtered source SQL before the limit", () => {
  const route = readFileSync("src/app/api/hcm/worker-360/route.ts", "utf8");
  const server = readFileSync("src/lib/hcm-worker-360-server.ts", "utf8");
  const client = readFileSync("src/components/hcm-worker-360-history.tsx", "utf8");
  const parent = readFileSync("src/components/hcm-worker-360.tsx", "utf8");
  assert.match(route, /HCM_WORKER_360_ENABLED/);
  assert.match(route, /Cache-Control/);
  assert.ok(route.indexOf("assertOrganizationRole(") < route.indexOf("loadWorker360Summary("));
  assert.ok(route.includes('["owner", "admin", "hr"]'));
  assert.match(route, /validWorker360EventCursor/);
  assert.match(route, /params\.has\("beforeDate"\) \|\| params\.has\("beforeId"\)/);
  assert.match(server, /eq\(workerEmploymentEvents\.organizationId, organizationId\)/);
  assert.match(server, /eq\(workerEmploymentEvents\.employeeId, employeeId\)/);
  assert.match(server, /lte\(workerEmploymentEvents\.effectiveDate, asOfDate\)/);
  assert.match(server, /lt\(workerEmploymentEvents\.effectiveDate, before\.effectiveDate\)/);
  assert.match(server, /lt\(workerEmploymentEvents\.id, before\.id\)/);
  assert.match(server, /limit\(WORKER_360_EVENT_PAGE_SIZE \+ 1\)/);
  assert.match(client, /MAX_DISPLAYED_EVENTS = 125/);
  assert.match(client, /controller\.signal/);
  assert.match(client, /const payload: unknown = await response\.json\(\)/);
  assert.match(client, /isVerifiedWorker360OlderPage\(/);
  const verify = client.indexOf("if (!isVerifiedWorker360OlderPage(");
  const append = client.indexOf("setOlder(current =>");
  assert.ok(verify >= 0 && verify < append,
    "fully verify the continuation source and cursor before appending older events");
  assert.match(parent, /Worker360History key=\{scope\}/);
  assert.doesNotMatch(server, /db\.(insert|update|delete)\(/);
});
