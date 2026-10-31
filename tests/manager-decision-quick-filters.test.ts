import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { ManagerDecisionItem } from "../src/lib/hcm-manager-decision-contract";
import {
  managerDecisionPreferenceKey, readManagerDecisionPreferences, selectManagerDecisionItems,
} from "../src/lib/manager-decision-quick-filters";

const item = (id: number, dueState: ManagerDecisionItem["dueState"], dueAt: string | null): ManagerDecisionItem => ({
  id, source: "hcm", sourceRecordId: id, approvalTaskId: null,
  processType: "hire", stepType: "review", status: "pending",
  priority: "normal", assignment: "named", dueAt, dueState, employee: null,
});

test("filters only the already-verified source page without mutating rows", () => {
  const rows = [
    item(1, "unscheduled", null), item(2, "upcoming", "2026-11-12T00:00:00.000Z"),
    item(3, "overdue", "2026-10-01T00:00:00.000Z"),
    item(4, "upcoming", "2026-11-05T00:00:00.000Z"),
  ];
  const before = structuredClone(rows);
  assert.deepEqual(selectManagerDecisionItems(rows, "overdue", "source").map(row => row.id), [3]);
  assert.deepEqual(selectManagerDecisionItems(rows, "upcoming", "deadline").map(row => row.id), [4, 2]);
  assert.deepEqual(selectManagerDecisionItems(rows, "unscheduled", "source").map(row => row.id), [1]);
  assert.deepEqual(selectManagerDecisionItems(rows, "all", "deadline").map(row => row.id), [3, 4, 2, 1]);
  assert.deepEqual(rows, before);
});

test("view preference is versioned and isolated by employer and authorized scope", () => {
  const a = managerDecisionPreferenceKey(11, { kind: "unit", orgUnitId: 5 });
  assert.notEqual(a, managerDecisionPreferenceKey(12, { kind: "unit", orgUnitId: 5 }));
  assert.notEqual(a, managerDecisionPreferenceKey(11, { kind: "unit", orgUnitId: 6 }));
  assert.notEqual(a, managerDecisionPreferenceKey(11, { kind: "company", orgUnitId: null }));
  assert.deepEqual(readManagerDecisionPreferences({ filter: "overdue", order: "deadline" }),
    { filter: "overdue", order: "deadline" });
  assert.deepEqual(readManagerDecisionPreferences({ filter: "__unexpected__", order: "unknown" }),
    { filter: "all", order: "source" });
  assert.deepEqual(readManagerDecisionPreferences(null), { filter: "all", order: "source" });
});

test("inbox keeps server-authorized reads and stores no employee data in preferences", () => {
  const source = readFileSync("src/components/hcm-manager-decision-inbox.tsx", "utf8");
  assert.match(source, /readVerifiedManagerDecisionPage/);
  assert.match(source, /selectManagerDecisionItems\(page\.items, filter, order\)/);
  assert.match(source, /window\.sessionStorage\.setItem\(preferenceKey/);
  assert.match(source, /page\.page\.nextCursor/);
  assert.doesNotMatch(source, /method:\s*["'](POST|PATCH|DELETE)["']/);
});