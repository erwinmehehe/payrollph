import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("required CI fails closed if any PG16/PG18 audit LOGIN proof is skipped, cancelled or fails", () => {
  const ci = readFileSync(".github/workflows/ci.yml", "utf8");
  assert.match(ci, /audit-chain-real-logins:\n/);
  assert.match(ci, /postgres: \[16, 18\]/);
  assert.match(ci, /foundation: \[legacy-0109, forward-candidate\]/);
  assert.match(ci, /ISSUE908_ACCEPTANCE_MODE: isolated-ci-only/);
  assert.match(ci, /PAYMONGO_DISBURSEMENTS_ENABLED: "false"/);
  assert.match(ci, /XENDIT_PAYOUTS_ENABLED: "false"/);
  assert.match(ci, /node --import tsx --test tests\/audit-role-isolation-postgres.test.mjs/);
  assert.match(ci, /audit-chain-protection:\n    name: audit-chain-protection\n    if: \$\{\{ always\(\) \}\}/);
  assert.match(ci, /needs: audit-chain-real-logins/);
  assert.match(ci, /if \[ "\$MATRIX_RESULT" != "success" \]/);
  assert.match(ci, /needs: \[test-shard, audit-chain-protection\]/);
  assert.match(ci, /needs.audit-chain-protection.result != 'success'/);
});

test("real LOGIN proofs retain strict disposable DB and opt-in refusal", () => {
  const script = readFileSync("tests/audit-role-isolation-postgres.test.mjs", "utf8");
  assert.match(script, /ISSUE908_ACCEPTANCE_MODE/);
  assert.match(script, /isolated-ci-only/);
  assert.match(script, /127\.0\.0\.1:5432\/neondb/);
  assert.match(script, /audit grants, GUC spoofing/);
});
