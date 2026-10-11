import assert from "node:assert/strict";
import test from "node:test";
import {
  canPreviewHcmAssignment,
  resolveApproversFromRows,
  roleApproverMatchesRole,
} from "../src/lib/delegation";

test("read-only permission snapshot retains canonical role matching", () => {
  const none: [] = [];
  assert.equal(canPreviewHcmAssignment("role:hr", "Someone", "hr", none), true);
  assert.equal(canPreviewHcmAssignment("role:hr", "Someone", "owner", none), true);
  assert.equal(canPreviewHcmAssignment("role:hr", "Someone", "bookkeeper", none), false);
  assert.equal(canPreviewHcmAssignment("role:manager", "Someone", "manager", none), true);
  assert.equal(canPreviewHcmAssignment("role:finance", "Someone", "hr", none), false);
  assert.equal(canPreviewHcmAssignment("Alice", "Alice", null, none), true);
  assert.equal(canPreviewHcmAssignment("Alice", "aLIce", null, none), true);
  assert.equal(canPreviewHcmAssignment("Alice", "Bob", "hr", none), false);
  assert.equal(roleApproverMatchesRole("role:owner", "owner"), true);
});

test("delegation snapshot follows original, active delegate and chain of at most three", () => {
  const edges = [
    { fromApprover: "A", toApprover: "B", reason: "One" },
    { fromApprover: "B", toApprover: "C", reason: "Two" },
    { fromApprover: "C", toApprover: "D", reason: "Three" },
    { fromApprover: "D", toApprover: "E", reason: "Four" },
  ];
  const result = resolveApproversFromRows("A", edges);
  assert.deepEqual(result.allowed, ["a", "b", "c", "d"]);
  assert.equal(result.chain.length, 3);
  assert.equal(canPreviewHcmAssignment("A", "D", null, edges), true);
  assert.equal(canPreviewHcmAssignment("A", "E", null, edges), false);
  assert.equal(canPreviewHcmAssignment("A", "A", null, edges), true);
});

test("cyclic and duplicate delegation edges cannot inflate preview authority", () => {
  const edges = [
    { fromApprover: "A", toApprover: "B", reason: "First match" },
    { fromApprover: "A", toApprover: "E", reason: "Ignored duplicate" },
    { fromApprover: "B", toApprover: "A", reason: "Cycle" },
  ];
  const result = resolveApproversFromRows("A", edges);
  assert.deepEqual(result.allowed, ["a", "b"]);
  assert.equal(result.chain.length, 1);
  assert.equal(canPreviewHcmAssignment("A", "E", null, edges), false);
});
