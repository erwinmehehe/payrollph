import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  approvalStepsForAmount,
  validateApprovalChainSteps,
} from "../src/lib/approval-chains";

const read = (path: string) => readFileSync(path, "utf8");

test("amount thresholds validate in ascending order with the first step at zero", () => {
  const valid = validateApprovalChainSteps([
    { label: "Manager", approver: "Manager", minimumAmount: 0 },
    { label: "Finance", approver: "Finance", minimumAmount: 100_000 },
    { label: "CFO", approver: "CFO", minimumAmount: 1_000_000 },
  ]);
  assert.ok(valid);
  assert.deepEqual(valid.map((step) => step.minimumAmount), [0, 100_000, 1_000_000]);

  assert.equal(validateApprovalChainSteps([
    { label: "Manager", approver: "Manager", minimumAmount: 1 },
  ]), null);

  assert.equal(validateApprovalChainSteps([
    { label: "Manager", approver: "Manager", minimumAmount: 0 },
    { label: "CFO", approver: "CFO", minimumAmount: 1_000_000 },
    { label: "Finance", approver: "Finance", minimumAmount: 100_000 },
  ]), null);
});

test("known amounts require only approval levels whose threshold was reached", () => {
  const steps = validateApprovalChainSteps([
    { label: "Manager", approver: "Manager", minimumAmount: 0 },
    { label: "Finance", approver: "Finance", minimumAmount: 100_000 },
    { label: "CFO", approver: "CFO", minimumAmount: 1_000_000 },
  ]);
  assert.ok(steps);

  assert.deepEqual(approvalStepsForAmount(steps, 99_999.99).map((step) => step.label), ["Manager"]);
  assert.deepEqual(approvalStepsForAmount(steps, 100_000).map((step) => step.label), ["Manager", "Finance"]);
  assert.deepEqual(approvalStepsForAmount(steps, 1_500_000).map((step) => step.label), ["Manager", "Finance", "CFO"]);
});

test("unknown amounts fail conservatively to the full configured chain", () => {
  const steps = validateApprovalChainSteps([
    { label: "Manager", approver: "Manager", minimumAmount: 0 },
    { label: "Finance", approver: "Finance", minimumAmount: 100_000 },
  ]);
  assert.ok(steps);
  assert.deepEqual(approvalStepsForAmount(steps, null).map((step) => step.label), ["Manager", "Finance"]);
  assert.throws(() => approvalStepsForAmount(steps, -1), /non-negative/);
});

test("0071 persists immutable amount and routing evidence", () => {
  const migration = read("drizzle/0071_amount_based_approval_limits.sql");
  const schema = read("src/db/schema.ts");
  const baseline = read("drizzle/baseline.sql");

  for (const source of [migration, schema, baseline]) {
    assert.ok(source.includes("amount"));
    assert.ok(source.includes("amount_currency") || source.includes("amountCurrency"));
    assert.ok(source.includes("amount_basis") || source.includes("amountBasis"));
    assert.ok(source.includes("routing_snapshot") || source.includes("routingSnapshot"));
  }
  assert.ok(migration.includes("approval_chain_instances_amount_nonnegative_check"));
  assert.ok(schema.includes("approval_chain_instances_amount_nonnegative_check"));
  assert.ok(baseline.includes("approval_chain_instances_amount_nonnegative_check"));
});

test("chain creation snapshots policy thresholds and rejects changed routing inputs on retry", () => {
  const engine = read("src/lib/approval-chains.ts");
  assert.ok(engine.includes("policySteps: steps"));
  assert.ok(engine.includes("appliedSteps: routedSteps"));
  assert.ok(engine.includes("amountBasis"));
  assert.ok(engine.includes("amountCurrency"));
  assert.ok(engine.includes("routing inputs changed after the chain started"));
  assert.ok(engine.includes("existingAmount !== amount"));
  assert.ok(engine.includes("Approval currency must be a three-letter ISO-style code."));
  assert.ok(engine.includes("Approval amount basis is required when an amount is supplied."));
});

test("payroll adjustments use absolute PHP magnitude for approval limits", () => {
  const engine = read("src/lib/automation.ts");
  assert.ok(engine.includes('sourceType: "automation_payroll_adjustment"'));
  assert.ok(engine.includes("amount: Math.abs(action.amount)"));
  assert.ok(engine.includes('amountCurrency: "PHP"'));
  assert.ok(engine.includes('amountBasis: "absolute_requested_adjustment"'));
  assert.ok(engine.includes("approvalChainCode?: string"));
  assert.ok(engine.includes("approvalAmount: Math.abs(action.amount)"));
});

test("Studio and approval-chain admin expose amount-based routing controls", () => {
  const admin = read("src/components/approval-chain-admin.tsx");
  const studio = read("src/components/automation-studio-panel.tsx");
  assert.ok(admin.includes("Starts at (PHP)"));
  assert.ok(admin.includes("minimumAmount"));
  assert.ok(admin.includes("Step 1 must start at PHP 0"));
  assert.ok(studio.includes("absolute PHP adjustment amount"));
  assert.ok(studio.includes("approvalChainCode: row.approvalChainCode || undefined"));
});
