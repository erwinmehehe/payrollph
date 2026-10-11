import assert from "node:assert/strict";
import test from "node:test";
import { pendingReviewSelection } from "../src/lib/scoped-review-selection";

test("bulk decisions exclude removed and already decided requests", () => {
  const choice = { scopeKey: "employer A, manager", ids: new Set([1, 2, 3, 4]) };
  const rows = [{ id: 1, status: "pending" }, { id: 2, status: "approved" }, { id: 3, status: "rejected" }, { id: 5, status: "pending" }];
  assert.deepEqual([...pendingReviewSelection(choice, choice.scopeKey, rows)], [1]);
  assert.deepEqual([...choice.ids], [1, 2, 3, 4], "derivation must not mutate stored selection");
});

test("employer and access changes hide a selection even when request IDs coincide", () => {
  const choice = { scopeKey: "employer A, owner", ids: new Set([1]) };
  const rows = [{ id: 1, status: "pending" }];
  assert.equal(pendingReviewSelection(choice, "employer B, owner", rows).size, 0);
  assert.equal(pendingReviewSelection(choice, "employer A, manager", rows).size, 0);
  assert.equal(pendingReviewSelection(null, choice.scopeKey, rows).size, 0);
});

test("refresh hides selection until current pending rows return without selecting new rows", () => {
  const choice = { scopeKey: "employer A", ids: new Set([1]) };
  assert.equal(pendingReviewSelection(choice, choice.scopeKey, []).size, 0);
  assert.deepEqual([...pendingReviewSelection(choice, choice.scopeKey, [{ id: 1, status: "pending" }, { id: 2, status: "pending" }])], [1]);
});
