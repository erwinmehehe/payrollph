import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {load} from 'js-yaml';

// A-3 protection against a false green: source changes to money-critical
// modules must invoke the focused synthetic PG16 release regression suites.
// This is *not* independent financial sign-off or real-employer evidence.
const workflow = readFileSync(".github/workflows/money-closes-qa.yml", "utf8");

function assertLockedBrowserTooling(job){
  const steps=job.steps,installIndex=steps.findIndex(step=>step.run?.includes('npm install')&&step.run.includes('playwright@'));
  assert.ok(installIndex>=0,'Pinned browser dependency installation is required');
  const install=steps[installIndex];
  assert.ok(steps.slice(0,installIndex).some(step=>step.run==='npm ci'),'Locked application dependencies must be installed first');
  assert.match(install.run,/npm install --no-save --package-lock=true playwright@1\.55\.0/);
  assert.ok(!install.run.includes('--package-lock=false'),'Browser setup must not re-resolve the application runtime');
  assert.match(install.run,/git diff --exit-code -- package\.json package-lock\.json/);
  assert.ok(!install.run.includes('||'),'Dependency drift must fail the browser gate');
  assert.notEqual(install['continue-on-error'],true);
  assert.ok(steps.slice(installIndex+1).some(step=>step.run==='node --import tsx scripts/qa/money-closes-component-browser.mjs'),'The real browser proof must still execute');
}

test('browser setup retains locked runtime inputs and refuses hidden dependency drift',()=>{
  const job=load(workflow).jobs['flag-on-money'];
  assert.doesNotThrow(()=>assertLockedBrowserTooling(job));
  for(const mutate of [
    step=>{step.run=step.run.replace('--package-lock=true','--package-lock=false');},
    step=>{step.run=step.run.replace('git diff --exit-code -- package.json package-lock.json','echo ignored');},
    step=>{step.run+=' || true';},
    step=>{step['continue-on-error']=true;},
  ]){
    const changed=structuredClone(job),install=changed.steps.find(step=>step.run?.includes('npm install')&&step.run.includes('playwright@'));
    mutate(install);assert.throws(()=>assertLockedBrowserTooling(changed));
  }
});

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
