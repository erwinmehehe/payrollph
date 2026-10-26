import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("required CI fails closed if any PG16/PG18 audit LOGIN proof is skipped, cancelled or fails", () => {
  const ci = readFileSync(".github/workflows/ci.yml", "utf8");
  const matrix = ci.split("\n  audit-chain-real-logins:\n")[1]?.split("\n  audit-chain-protection:\n")[0];
  const auditGate = ci.split("\n  audit-chain-protection:\n")[1]?.split("\n  validation:\n")[0];
  const requiredGate = ci.split("\n  check:\n")[1];
  assert.ok(matrix && auditGate && requiredGate, "all audit and required status jobs must exist");

  for (const marker of [
    "postgres: [16, 18]", "foundation: [legacy-0109, forward-candidate]",
    "ISSUE908_ACCEPTANCE_MODE: isolated-ci-only",
    'PAYMONGO_DISBURSEMENTS_ENABLED: "false"',
    'XENDIT_PAYOUTS_ENABLED: "false"',
    "node --import tsx --test tests/audit-role-isolation-postgres.test.mjs",
  ]) assert.ok(matrix.includes(marker), "missing isolated audit contract " + marker);

  assert.ok(auditGate.includes("if: ${{ always() && needs.change-scope.result == 'success' && needs.change-scope.outputs.docs_only != 'true' }}"),
    "audit gate must run after a failed matrix but skip explicitly permitted docs-only PRs");
  assert.ok(auditGate.includes("needs: [change-scope, audit-chain-real-logins]"));
  assert.ok(auditGate.includes("MATRIX_RESULT: ${{ needs.audit-chain-real-logins.result }}"));
  assert.ok(auditGate.includes('if [ "$MATRIX_RESULT" != "success" ]; then'));
  assert.ok(auditGate.includes("exit 1"), "audit gate cannot silently pass a matrix failure");
  assert.ok(requiredGate.includes("if: ${{ always() }}"));
  assert.ok(requiredGate.includes("needs: [change-scope, test-shard, audit-chain-protection, validation]"));
  assert.ok(requiredGate.includes("AUDIT_RESULT: ${{ needs.audit-chain-protection.result }}"));
  assert.ok(requiredGate.includes('for result in "$REGRESSION_RESULT" "$AUDIT_RESULT" "$VALIDATION_RESULT"; do'));
  assert.ok(requiredGate.includes('if [ "$result" != "success" ]; then'));
});

test("real LOGIN proofs retain strict disposable DB and opt-in refusal", () => {
  const script = readFileSync("tests/audit-role-isolation-postgres.test.mjs", "utf8");
  assert.match(script, /ISSUE908_ACCEPTANCE_MODE/);
  assert.match(script, /isolated-ci-only/);
  assert.match(script, /127\.0\.0\.1:5432\/neondb/);
  assert.match(script, /audit grants, GUC spoofing/);
});
