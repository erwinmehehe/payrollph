import assert from "node:assert/strict";
import test from "node:test";
import { readVerifiedManagerDecisionPage } from "../src/lib/hcm-manager-decision-read";

import type { DecisionSource } from "../src/lib/hcm-manager-decision-contract";

const companyScope = { kind: "company", orgUnitId: null } as const;
function verify(
  ok: boolean, payload: unknown, employer: number, source: DecisionSource, beforeId: number | null,
) {
  return readVerifiedManagerDecisionPage(ok, payload, employer, source, beforeId, companyScope);
}

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
  assert.deepEqual(verify(true, empty, 10, "hcm", null), empty);
  assert.equal(verify(false, empty, 10, "hcm", null), null);
  assert.equal(verify(true, {}, 10, "hcm", null), null);
  assert.equal(verify(true, { ...empty, organizationId: 20 }, 10, "hcm", null), null);
  assert.equal(verify(true, { ...empty, items: undefined }, 10, "hcm", null), null);
  assert.equal(verify(true, { ...empty, totals: undefined }, 10, "hcm", null), null);
  assert.equal(verify(true, { ...empty, totals: { assignedItemsThisPage: 1, overdueItemsThisPage: 0 } }, 10, "hcm", null), null);
});
test("manager source nested authorization and cursor claims must be valid", () => {
  const filled = { ...empty, items: [item], totals: { ...empty.totals, assignedItemsThisPage: 1 } };
  assert.deepEqual(verify(true, filled, 10, "hcm", null), filled);
  for (const mutated of [
    { ...item, status: "approved" }, { ...item, assignment: undefined },
    { ...item, employee: { ...item.employee, id: 0 } },
    { ...item, source: "leave" }, { ...item, dueState: "upcoming", dueAt: null },
    { ...item, sourceRecordId: null },
  ]) assert.equal(verify(true,
    { ...filled, items: [mutated] }, 10, "hcm", null), null);
  assert.equal(verify(true, filled, 10, "hcm", 20), null);
  assert.equal(verify(true, { ...filled,
    page: { size: 20, hasMore: true, nextCursor: null } }, 10, "hcm", null), null);
  assert.equal(verify(false, filled, 10, "hcm", null), null);
  assert.deepEqual(verify(true, filled, 10, "hcm", null), filled);
});
test("manager response must match trusted server-derived company or unit scope", () => {
  const unitPage = { ...empty, scope: { kind: "unit", orgUnitId: 7 } };
  assert.deepEqual(
    readVerifiedManagerDecisionPage(true, unitPage, 10, "hcm", null, { kind: "unit", orgUnitId: 7 }),
    unitPage,
  );
  assert.equal(
    readVerifiedManagerDecisionPage(true, unitPage, 10, "hcm", null, { kind: "unit", orgUnitId: 8 }),
    null,
  );
  assert.equal(verify(true, unitPage, 10, "hcm", null), null);
  assert.equal(
    readVerifiedManagerDecisionPage(true, empty, 10, "hcm", null, { kind: "unit", orgUnitId: 7 }),
    null,
  );
  assert.equal(
    readVerifiedManagerDecisionPage(true, unitPage, 10, "hcm", null, null as never),
    null,
  );
});

test("pagination validates candidate cursor progress without rejecting filtered sparse pages", () => {
  // Source pagination scans up to 20 candidates before role/assignment filtering.
  const filtered = { ...empty, page: { size: 20, hasMore: true, nextCursor: 12 } };
  assert.deepEqual(verify(true, filtered, 10, "hcm", null), filtered);
  const visible = { ...filtered,
    items: [item, { ...item, id: 15, sourceRecordId: 6 }],
    totals: { ...empty.totals, assignedItemsThisPage: 2 },
  };
  assert.deepEqual(verify(true, visible, 10, "hcm", null), visible);
  assert.equal(verify(true, visible, 10, "hcm", 12), null);
  assert.equal(verify(true, visible, 10, "hcm", -1), null);
  assert.equal(verify(true, { ...visible,
    page: { ...visible.page, nextCursor: 16 },
  }, 10, "hcm", null), null);
  assert.equal(verify(true, { ...visible,
    items: [...visible.items].reverse(),
  }, 10, "hcm", null), null);
  assert.equal(verify(true, { ...filtered,
    page: { ...filtered.page, nextCursor: 0 },
  }, 10, "hcm", null), null);
  assert.deepEqual(verify(true, { ...filtered,
    page: { ...filtered.page, nextCursor: 10 },
  }, 10, "hcm", 20), { ...filtered, page: { ...filtered.page, nextCursor: 10 } });
});
