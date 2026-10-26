import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

// Permanent regression for #737 after the controlled negative-head proof.
// The intentional failure existed only on unmerged SHA
// 60e7cb03fbaa6ecfe4dcae77c9796f8e7402e213.
test("#737 required status always materializes and rejects failed, cancelled or missing dependencies", () => {
  const workflow = readFileSync(".github/workflows/ci.yml", "utf8");
  const check = workflow.split("\n  check:\n")[1];
  const audit = workflow.split("\n  audit-chain-protection:\n")[1]?.split("\n  validation:\n")[0];
  const validation = workflow.split("\n  validation:\n")[1]?.split("\n  check:\n")[0];
  assert.ok(check && audit && validation, "all mandatory gates must exist");

  assert.ok(check.includes("if: ${{ always() }}"), "required check must never be implicitly skipped");
  assert.ok(check.includes("needs: [change-scope, test-shard, audit-chain-protection, validation]"));
  assert.ok(check.includes("SCOPE_RESULT: ${{ needs.change-scope.result }}"));
  assert.ok(check.includes("REGRESSION_RESULT: ${{ needs.test-shard.result }}"));
  assert.ok(check.includes("AUDIT_RESULT: ${{ needs.audit-chain-protection.result }}"));
  assert.ok(check.includes("VALIDATION_RESULT: ${{ needs.validation.result }}"));
  assert.ok(check.includes("set -euo pipefail"));
  assert.ok(check.includes('if [ "$SCOPE_RESULT" != "success" ]; then'),
    "a missing/failed classifier can never authorize a bypass");
  assert.ok(check.includes('for result in "$REGRESSION_RESULT" "$AUDIT_RESULT" "$VALIDATION_RESULT"; do'));
  assert.ok(check.includes('if [ "$result" != "success" ]; then'),
    "matrix failure, cancelled validation or skipped audit must block the required status");
  assert.ok(check.includes("exit 1"), "an unsatisfied mandatory check must exit nonzero");

  // Markdown-only PRs are a narrow, explicit exception: all heavy jobs must
  // have SKIPPED results, never a failure or cancellation.
  assert.ok(check.includes('if [ "$DOCS_ONLY" = "true" ]; then'));
  for (const variable of ["REGRESSION_RESULT", "AUDIT_RESULT", "VALIDATION_RESULT"]) {
    assert.ok(check.includes('"$' + variable + '" != "skipped"'),
      "docs-only bypass must reject unexpected " + variable);
  }

  assert.ok(audit.includes("needs: [change-scope, audit-chain-real-logins]"));
  assert.ok(audit.includes('if [ "$MATRIX_RESULT" != "success" ]; then'));
  assert.ok(workflow.includes("run: node scripts/run-sharded-tests.mjs"));
  assert.ok(workflow.includes("shard: [0, 1, 2, 3]"));

  // Independent financial certifications still run in parallel validation.
  assert.ok(validation.includes("needs: change-scope"));
  for (const command of ["npm run payroll:golden", "npm run payroll:golden:phase2a",
    "npm run payroll:golden:phase2b", "npm run payroll:golden:pay-rules"]) {
    assert.ok(validation.includes(command), "independent certification missing: " + command);
  }
});
