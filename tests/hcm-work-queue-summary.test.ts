import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { summarizeVerifiedWorkQueue } from "../src/lib/hcm-work-queue-summary";

const scopedRows = [
  { overdue: true, ownerUserId: null },
  { overdue: false, ownerUserId: 42 },
  { overdue: true, ownerUserId: 21 },
];

test("pending, denied, stale or failed work-queue reads cannot render zero counts", () => {
  assert.equal(summarizeVerifiedWorkQueue([], false), null);
  assert.equal(summarizeVerifiedWorkQueue(scopedRows, false), null);
});

test("verified empty employer view explicitly reports zero, not unknown", () => {
  assert.deepEqual(summarizeVerifiedWorkQueue([], true), {
    total: 0, overdue: 0, unassigned: 0,
  });
});

test("verified scoped queue counts only the source rows in the current view", () => {
  assert.deepEqual(summarizeVerifiedWorkQueue(scopedRows, true), {
    total: 3, overdue: 2, unassigned: 1,
  });
  assert.equal(scopedRows.length, 3, "Read projection must not mutate source records");
});

test("HR Work Queue displays unknown until an active, error-free scoped response exists", () => {
  const ui = readFileSync("src/app/hcm/work-items/page.tsx", "utf8");
  assert.ok(ui.includes("summarizeVerifiedWorkQueue(items, activeQueue !== null && !loadError)"));
  assert.ok(ui.includes("summary?.total ?? null"));
  assert.ok(ui.includes("summary?.overdue ?? null"));
  assert.ok(ui.includes("summary?.unassigned ?? null"));
  assert.ok(ui.includes('value === null ? "—" : value'));
  assert.ok(ui.includes('role="status"'));
  assert.ok(ui.includes("Queue counts are unavailable"));
  assert.ok(ui.includes("key={JSON.stringify([organizationId, filter])}"),
    "Scope/filter changes must discard old queue and pending editor state");
  assert.ok(ui.includes("controller.abort()"),
    "A stale request must be aborted when employer/filter/revision changes");
  assert.ok(ui.includes("{summary ? ("),
    "The work-items table must only render when the active read is verified");
  assert.ok(ui.includes("items.length===0&&"),
    "Only a verified empty view may display the no-work-items message");
  assert.ok(ui.includes('Work items could not be loaded. Use Refresh to retry.'),
    "A failed read needs a dedicated, clearly differentiated table state");
  assert.ok(ui.includes("Work items are loading…"),
    "A pending read cannot render an empty table");
  assert.ok(ui.includes("Select a valid organization to see work items."),
    "Invalid workspace selection cannot look like a verified empty table");
  assert.ok(!ui.includes("activeQueue&&!loadError&&items.length===0"),
    "Unknown reads must use the explicit verified-table guard");
});
