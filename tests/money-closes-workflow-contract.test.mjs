import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

// A-3 protection against a false green: source changes to money-critical
// modules must invoke the focused synthetic PG16 release regression suites.
// This is *not* independent financial sign-off or real-employer evidence.
const workflow = readFileSync(".github/workflows/money-closes-qa.yml", "utf8");

test("A-3 money-critical source changes trigger focused financial CI", () => {
  const criticalPaths = [
    "src/lib/final-pay*",
    "src/lib/thirteenth-month-centavos.ts",
    "src/lib/ph-compliance.ts",
    "src/lib/year-end.ts",
    "src/lib/payroll-engine.ts",
    "src/lib/payroll-money.ts",
    "src/lib/payroll-mandatory-shortfall.ts",
    "src/lib/payroll-assurance*.ts",
    "src/lib/payroll-retro-statutory-source-period.ts",
    "src/lib/payroll-m10-*.ts",
    "src/lib/payroll-rules.ts",
    "src/lib/ph-statutory-rule-packs.ts",
    "src/lib/pay-basis.ts",
    "src/lib/payroll-release-checklist.ts",
    "src/lib/payroll-release-segregation.ts",
  ];
  for (const path of criticalPaths) {
    assert.ok(workflow.includes(`- '${path}'`), `Missing PR-path trigger: ${path}`);
  }
});

test("A-3 dedicated CI executes existing M-3/M-6/M-8/M-10 and release-blocking cases", () => {
  const scope = workflow.split("name: Execute real migration rollback, rounding and financial-source behavior")[1]
    ?.split("name: Golden payroll with both new flags ON")[0];
  assert.ok(scope, "Financial-source job must be present");
  const requiredSuites = [
    "tests/a3-money-path-centavos.test.ts",
    "tests/money-closes.test.ts",
    "tests/final-pay-shortfall-evidence.test.ts",
    "tests/payroll-mandatory-shortfall.test.ts",
    "tests/payroll-mandatory-shortfall-integration.test.ts",
    "tests/payroll-assurance.test.ts",
    "tests/payroll-retro-statutory-source-period.test.ts",
    "tests/payroll-m10-readonly-review.test.ts",
    "tests/payroll-m10-centavo-evidence.test.ts",
    "tests/payroll-release-checklist.test.ts",
    "tests/payroll-release-segregation.test.ts",
  ];
  for (const path of requiredSuites) {
    assert.ok(scope.includes(path), `Missing focused regression suite: ${path}`);
  }
  assert.match(workflow, /MONEY_CLOSES_POSTGRES_QA: 'true'/);
  assert.match(workflow, /DATABASE_URL: postgresql:\/\/postgres:postgres@127\.0\.0\.1:5432\/app_db/);
  assert.match(workflow, /FINAL_PAY_SIGNED_REVIEW_ENABLED: 'true'/);
  assert.match(workflow, /EXACT_THIRTEENTH_CENTAVOS_ENABLED: 'true'/);
  assert.match(workflow, /npm run payroll:golden:pay-rules/);
});
