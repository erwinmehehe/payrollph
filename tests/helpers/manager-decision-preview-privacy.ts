import assert from "node:assert/strict";
import type { ManagerDecisionPage } from "../../src/lib/hcm-manager-decision-contract";

function keys(value: object, expected: string[], label: string) {
  assert.deepEqual(Object.keys(value).sort(), [...expected].sort(), label + ": unexpected private field");
}

/** Validate the actual serialized projection, including fields TypeScript can miss at runtime. */
export function assertManagerDecisionPreviewPrivacy(
  pages: readonly ManagerDecisionPage[],
  employee: { id: number; employeeNo: string; name: string },
  privateText: readonly string[],
) {
  for (const page of pages) {
    keys(page, ["organizationId", "source", "scope", "observedAt", "items", "page", "totals", "notice"], "page");
    keys(page.scope, ["kind", "orgUnitId"], "scope");
    keys(page.page, ["size", "hasMore", "nextCursor"], "pagination");
    keys(page.totals, ["assignedItemsThisPage", "overdueItemsThisPage"], "totals");
    for (const item of page.items) {
      keys(item, ["id", "source", "sourceRecordId", "approvalTaskId", "processType", "stepType",
        "status", "priority", "assignment", "dueAt", "dueState", "employee"], "item");
      assert.deepEqual(item.employee, employee, "only the exact authorized employee identity may be returned");
      keys(item.employee!, ["id", "employeeNo", "name"], "employee");
    }
  }
  const serialized = JSON.stringify(pages);
  for (const secret of privateText) {
    assert.ok(!serialized.includes(secret), "Sensitive source value exposed: " + secret);
  }
}
