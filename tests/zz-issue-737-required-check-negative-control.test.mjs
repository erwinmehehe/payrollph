import test from "node:test";
import assert from "node:assert/strict";

// ISSUE #737 NEGATIVE CONTROL — DELIBERATELY FAILING SOURCE, NEVER MERGE.
// This file exists only to exercise real GitHub main-branch required-check
// enforcement after aggregate-guard PR #1065 was merged.
// The test uses no database, network, environment secrets, payroll or app code.
test("ISSUE_737_CANARY_REQUIRED_CHECK_MUST_BE_RED_DO_NOT_MERGE", () => {
  assert.fail("ISSUE_737_INTENTIONAL_FAIL_REQUIRED_CHECK_DO_NOT_MERGE");
});
