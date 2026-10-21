import assert from "node:assert/strict";
import test from "node:test";
import { readVerifiedManagerDecisionPage } from "../src/lib/hcm-manager-decision-read";

const item = {
  id: 20, source: "hcm", sourceRecordId: 5, approvalTaskId: 8,
  processType: "promotion", stepType: "approval", status: "pending",
  priority: "normal", assignment: "named", dueAt: null,
  dueState: "unscheduled", employee: { id: 90, employeeNo: "A090", name: "Worker" },
};
const empty = {
  organizationId: 10, source: "hcm", scope: { kind: "company", orgUnitId: null },
  observedAt: "2026-10-21T00:00:00.000Z", items: [],
  page: { size: 20, hasMore: false, nextCursor: null },
  totals: { assignedItemsThisPage: 0, overdueItemsThisPage: 0 },
  notice: "Preview only",
};
test("manager source must prove employer, source, complete totals and verified empty", () => {
  assert.deepEqual(readVerifiedManagerDecisionPage(true, empty, 10, "hcm", null), empty);
  assert.equal(readVerifiedManagerDecisionPage(false, empty, 10, "hcm", null), null);
  assert.equal(readVerifiedManagerDecisionPage(true, {}, 10, "hcm", null), null);
  assert.equal(readVerifiedManagerDecisionPage(true, { ...empty, organizationId: 20 }, 10, "hcm", null), null);
  assert.equal(readVerifiedManagerDecisionPage(true, { ...empty, items: undefined }, 10, "hcm", null), null);
  assert.equal(readVerifiedManagerDecisionPage(true, { ...empty, totals: undefined }, 10, "hcm", null), null);
  assert.equal(readVerifiedManagerDecisionPage(true, { ...empty, totals: { assignedItemsThisPage: 1, overdueItemsThisPage: 0 } }, 10, "hcm", null), null);
});
test("manager source nested authorization and cursor claims must be valid", () => {
  const filled = { ...empty, items: [item], totals: { ...empty.totals, assignedItemsThisPage: 1 } };
  assert.deepEqual(readVerifiedManagerDecisionPage(true, filled, 10, "hcm", null), filled);
  for (const mutated of [
    { ...item, status: "approved" }, { ...item, assignment: undefined },
    { ...item, employee: { ...item.employee, id: 0 } },
    { ...item, source: "leave" }, { ...item, dueState: "upcoming", dueAt: null },
    { ...item, sourceRecordId: null },
  ]) assert.equal(readVerifiedManagerDecisionPage(true,
    { ...filled, items: [mutated] }, 10, "hcm", null), null);
  assert.equal(readVerifiedManagerDecisionPage(true, filled, 10, "hcm", 20), null);
  assert.equal(readVerifiedManagerDecisionPage(true, { ...filled,
    page: { size: 20, hasMore: true, nextCursor: null } }, 10, "hcm", null), null);
  assert.equal(readVerifiedManagerDecisionPage(false, filled, 10, "hcm", null), null);
  assert.deepEqual(readVerifiedManagerDecisionPage(true, filled, 10, "hcm", null), filled);
});
