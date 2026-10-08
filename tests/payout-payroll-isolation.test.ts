import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(path, "utf8");

test("payout pull requests cannot modify protected payroll computation or golden baselines", () => {
  const guard = read("scripts/verify-payout-payroll-isolation.ts");
  const workflow = read(".github/workflows/payout-payroll-isolation.yml");

  for (const protectedMarker of [
    "payroll-engine",
    "payroll-rules",
    "pay-policy-engine",
    "workforce-payroll",
    "leave-payroll",
    "golden-payroll-certification",
    "golden-payroll-phase2a",
    "golden-payroll-phase2b",
    "golden-pay-rules-phase3",
    "open-payroll-data",
  ]) {
    assert.ok(guard.includes(protectedMarker), `isolation guard missing protected marker ${protectedMarker}`);
  }

  for (const payoutMarker of [
    "bank-validations",
    "payout-destination-changes",
    "payout-profiles",
    "treasury-controls",
    "payroll-payout-",
    "paymongo",
    "payout-",
    "treasury-",
    "exporters",
  ]) {
    assert.ok(guard.includes(payoutMarker), `isolation guard missing payout marker ${payoutMarker}`);
  }

  assert.ok(guard.includes('"merge-base"'),
    "payout guard must compare changes from an actual merge-base");
  assert.ok(guard.includes('"refs/remotes/origin/main"'),
    "payout guard must use the current base branch, not stale PR webhook base SHA");
  assert.ok(guard.includes("PAYOUT/PAYROLL ISOLATION FAILED"));
  assert.ok(guard.includes("Split payroll math changes into a separate pull request."));
  assert.ok(workflow.includes("PAYOUT_GUARD_BASE_SHA"));
  assert.ok(workflow.includes("PAYOUT_GUARD_HEAD_SHA"));
  assert.ok(workflow.includes("fetch-depth: 0"));
});

test("bank and payout changes always trigger the fresh-tenant payroll pilot", () => {
  const workflow = read(".github/workflows/pilot-payroll-qa.yml");

  for (const path of [
    'src/app/api/compliance/bank-validations/**',
    'src/app/api/payout-destination-changes/**',
    'src/app/api/payout-profiles/**',
    'src/app/api/treasury-controls/**',
    'src/app/api/webhooks/paymongo/**',
    'src/lib/bank-**',
    'src/lib/paymongo.ts',
    'src/lib/paymongo-**',
    'src/lib/payout-**',
    'src/lib/treasury-**',
    'src/lib/exporters.ts',
    'src/components/payout-profiles-panel.tsx',
    'tests/*bank*.test.ts',
    'tests/*paymongo*.test.ts',
    'tests/*payout*.test.ts',
    'tests/*treasury*.test.ts',
  ]) {
    assert.ok(workflow.includes(`"${path}"`), `pilot workflow missing payout path ${path}`);
  }

  assert.ok(workflow.includes("Run fresh tenant payroll pilot"));
  assert.ok(workflow.includes("npx tsx scripts/pilot-payroll-qa.ts"));
});

test("general CI keeps independent payroll and statutory certification mandatory", () => {
  const workflow = read(".github/workflows/ci.yml");

  for (const command of [
    "npx tsx --test tests/*.test.ts",
    "npm run payroll:golden",
    "npm run payroll:golden:phase2a",
    "npm run payroll:golden:phase2b",
    "npm run payroll:golden:pay-rules",
  ]) {
    assert.ok(workflow.includes(command), `CI missing required payroll proof: ${command}`);
  }

  assert.ok(workflow.includes("Upload golden payroll certification evidence"));
  assert.ok(workflow.includes("Upload Phase 2A payroll reconciliation evidence"));
  assert.ok(workflow.includes("Upload Phase 2B payroll reconciliation evidence"));
  assert.ok(workflow.includes("Upload Pay Rules golden reconciliation evidence"));
});
