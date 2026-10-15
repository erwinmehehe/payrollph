import assert from "node:assert/strict";
import test from "node:test";

// Deliberately red test used for a controlled ruleset enforcement probe.
// This MUST be replaced with permanent positive regression assertions
// before the PR is eligible for merge. This file touches no production code.
test("#737 controlled required-check failure must block merging", () => {
  assert.fail("RULESET737_INTENTIONAL_FAILURE_DO_NOT_MERGE");
});
