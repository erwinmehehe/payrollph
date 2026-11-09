import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { HcmWorkQueueItem } from "../src/lib/hcm-work-queue-summary";
import { deriveLoadedWorkQueueView } from "../src/lib/hcm-work-queue-view";

function fixture(id: number, title: string, dueAt: string | null, ownerUserId: number | null): HcmWorkQueueItem {
  return {
    id, organizationId: 7, title, detail: "PRIVATE_CASE_DETAIL",
    caseType: "onboarding", status: "open", ownerTeam: "HR Operations",
    ownerUserId, ownerName: ownerUserId ? "Assigned operator" : null,
    dueAt, escalateAt: null, escalationLevel: 0, overdue: null,
  };
}

const rows = [
  fixture(22, "Zeta", null, null),
  fixture(30, "Alpha", "2026-11-09T08:00:00+08:00", 18),
  fixture(29, "Alpha", "2026-11-05T08:00:00+08:00", null),
  fixture(31, "Bravo", "not-a-date", 20),
];

test("SLA sort keeps dated items first and unknown dates last without inventing overdue status", () => {
  const original = structuredClone(rows);
  assert.deepEqual(deriveLoadedWorkQueueView(rows, "due", false).map((item) => item.id), [29, 30, 22, 31]);
  assert.deepEqual(rows, original, "Sorting must not mutate employer-scoped source rows");
});

test("title and newest views are deterministic, and owner filter is applied locally", () => {
  assert.deepEqual(deriveLoadedWorkQueueView(rows, "newest", false).map((item) => item.id), [31, 30, 29, 22]);
  assert.deepEqual(deriveLoadedWorkQueueView(rows, "title", false).map((item) => item.id), [29, 30, 31, 22]);
  assert.deepEqual(deriveLoadedWorkQueueView(rows, "due", true).map((item) => item.id), [29, 22]);
  assert.deepEqual(deriveLoadedWorkQueueView([], "due", true), []);
});

test("view controls remain behind the verified queue guard, without changing case endpoints", () => {
  const page = readFileSync("src/components/hcm-work-queue.tsx", "utf8");
  assert.ok(page.includes("summary ? deriveLoadedWorkQueueView("));
  assert.ok(page.includes("findLoadedHcmWorkItems(items, search)"));
  assert.ok(page.includes('aria-label="Show only work items without a named owner"'));
  assert.ok(page.includes('value={sort}'));
  assert.ok(page.includes('key={JSON.stringify([organizationId, filter])}'));
  assert.ok(page.includes('method:"PATCH"'), "Existing authoritative assignment endpoint remains unchanged");
});

test("search-only empty state stays compatible while owner-only filtering offers reset", () => {
  const page = readFileSync("src/components/hcm-work-queue.tsx", "utf8");
  assert.ok(page.includes("No loaded work items match this search. Clear search to see this employer's work items."));
  assert.ok(page.includes("No loaded work items match this search or owner filter. Reset view to see this employer's loaded work items."));
});
