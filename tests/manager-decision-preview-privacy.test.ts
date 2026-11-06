import assert from "node:assert/strict";
import test from "node:test";
import type { ManagerDecisionPage } from "../src/lib/hcm-manager-decision-contract";
import { assertManagerDecisionPreviewPrivacy } from "./helpers/manager-decision-preview-privacy";

const employee = { id: 94000, employeeNo: "EMP-a94000f-abc", name: "Visible Worker" };
function fixture(): ManagerDecisionPage[] {
  return [{ organizationId: 17, source: "leave", scope: { kind: "unit", orgUnitId: 7 },
    observedAt: "2026-01-01T00:00:00.000Z", notice: "Read only",
    page: { size: 25, hasMore: false, nextCursor: null },
    totals: { assignedItemsThisPage: 1, overdueItemsThisPage: 0 },
    items: [{ id: 1, source: "leave", sourceRecordId: 2, approvalTaskId: 3,
      processType: "Leave request", stepType: "approval", status: "pending",
      priority: "normal", assignment: "role", dueAt: null, dueState: "unscheduled",
      employee: { ...employee } }],
  }];
}
const verify = (pages: ManagerDecisionPage[]) => assertManagerDecisionPreviewPrivacy(pages, employee, ["Private beta", "Restricted leave reason"]);

test("salary-like digits in an authorized employee number or ID are not salary disclosure", () => {
  assert.doesNotThrow(() => verify(fixture()));
});
test("numeric and string pay fields, nested private metadata and root leaks still fail", () => {
  for (const salary of [94000, "94000", "94000.00"]) {
    for (const target of ["root", "item", "employee"] as const) {
      const pages = fixture();
      const object = target === "root" ? pages[0] : target === "item" ? pages[0].items[0] : pages[0].items[0].employee!;
      Object.assign(object, { basicRate: salary });
      assert.throws(() => verify(pages));
    }
  }
  const nested = fixture(); Object.assign(nested[0].items[0], { metadata: { salary: 94000 } });
  assert.throws(() => verify(nested));
});
test("replacing the permitted employee identity with another worker or a salary fails", () => {
  for (const mutation of [{ id: 99 }, { employeeNo: "94000.00" }, { name: "Private beta" }]) {
    const pages = fixture(); Object.assign(pages[0].items[0].employee!, mutation);
    assert.throws(() => verify(pages));
  }
});
test("private source text remains forbidden even inside permitted string fields", () => {
  const pages = fixture(); pages[0].notice = "Restricted leave reason";
  assert.throws(() => verify(pages), /Sensitive source value exposed/);
});
