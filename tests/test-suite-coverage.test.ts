import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync } from "node:fs";

test("the default CI regression runner includes both .test.ts and .test.mjs files", () => {
  const pkg = JSON.parse(readFileSync("package.json", "utf8")) as {
    scripts: Record<string, string>;
  };
  const command = pkg.scripts.test;
  assert.match(command, /tsx --test --test-concurrency=1 tests\/\*\.test\.ts/);
  assert.match(command, /node --test --test-concurrency=1 tests\/\*\.test\.mjs/);

  const files = readdirSync("tests");
  const ts = files.filter((name) => name.endsWith(".test.ts"));
  const mjs = files.filter((name) => name.endsWith(".test.mjs"));
  assert.ok(ts.length > 0, "TypeScript tests must exist");
  assert.ok(mjs.length > 0, "Operational JavaScript tests must exist");
  // Each shard still uses an independent disposable PostgreSQL service.
  // Validation runs in parallel; the stable required check aggregates all
  // results and MUST fail if any applicable shard, audit or validation fails,
  // is cancelled, or is unexpectedly skipped.
  const ci = readFileSync(".github/workflows/ci.yml", "utf8");
  assert.match(ci, /shard: \[0, 1, 2, 3\]/);
  assert.match(ci, /node scripts\/run-sharded-tests\.mjs/);
  assert.match(ci, /DATABASE_URL: postgresql:\/\/postgres/);

  const regression = ci.split("\n  test-shard:\n")[1]?.split("\n  audit-chain-real-logins:\n")[0];
  assert.ok(regression, "The four-shard regression job must exist");
  assert.match(regression, /needs: change-scope/);
  assert.match(regression, /needs\.change-scope\.outputs\.docs_only != 'true'/);

  const validation = ci.split("\n  validation:\n")[1]?.split("\n  check:\n")[0];
  assert.ok(validation, "Independent lint/build/payroll validation must exist");
  assert.match(validation, /needs: change-scope/);
  assert.doesNotMatch(validation, /needs: \[.*test-shard/, "Validation must not wait for regression shards");

  const auditGate = ci.split("\n  audit-chain-protection:\n")[1]?.split("\n  validation:\n")[0];
  assert.ok(auditGate, "The audit isolation matrix must have a fail-closed gate");
  assert.match(auditGate, /needs: \[change-scope, audit-chain-real-logins\]/);
  assert.match(auditGate, /if \[ "\$MATRIX_RESULT" != "success" \]; then/);

  const gate = ci.split("\n  check:\n")[1];
  assert.ok(gate, "The main ruleset's required check status must always exist");
  assert.match(gate, /if: \$\{\{ always\(\) \}\}/);
  assert.match(gate, /needs: \[change-scope, test-shard, audit-chain-protection, validation\]/);
  assert.match(gate, /if \[ "\$SCOPE_RESULT" != "success" \]; then/);
  assert.match(gate, /for result in "\$REGRESSION_RESULT" "\$AUDIT_RESULT" "\$VALIDATION_RESULT"; do/);
  assert.match(gate, /if \[ "\$result" != "success" \]; then/);
  // The docs-only exception must be proven by scope classification and
  // require all three heavy jobs to be skipped, not quietly pass a failure.
  assert.match(gate, /if \[ "\$DOCS_ONLY" = "true" \]; then/);
  assert.match(gate, /"\$REGRESSION_RESULT" != "skipped"/);
  assert.match(gate, /"\$AUDIT_RESULT" != "skipped"/);
  assert.match(gate, /"\$VALIDATION_RESULT" != "skipped"/);
});
