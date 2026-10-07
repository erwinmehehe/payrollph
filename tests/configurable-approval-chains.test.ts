import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");

test("0070 adds versioned approval-chain policies and immutable instances", () => {
  const migration = read("drizzle/0070_configurable_approval_chains.sql");
  assert.ok(migration.includes('CREATE TABLE IF NOT EXISTS "approval_chain_policies"'));
  assert.ok(migration.includes('CREATE TABLE IF NOT EXISTS "approval_chain_instances"'));
  assert.ok(migration.includes('CREATE TABLE IF NOT EXISTS "approval_chain_instance_steps"'));
  assert.ok(migration.includes('"steps_snapshot" jsonb NOT NULL'));
  assert.ok(migration.includes("approval_chain_instances_source_unique"));
  assert.ok(migration.includes("approval_chain_instance_steps_unique"));
  assert.ok(migration.includes('"approval_chain_instance_id"'));
});

test("fresh database schema mirrors approval-chain persistence", () => {
  const schema = read("src/db/schema.ts");
  const baseline = read("drizzle/baseline.sql");
  for (const source of [schema, baseline]) {
    assert.ok(source.includes("approval_chain_policies"));
    assert.ok(source.includes("approval_chain_instances"));
    assert.ok(source.includes("approval_chain_instance_steps"));
    assert.ok(source.includes("approval_chain_instances_source_unique"));
  }
  assert.ok(schema.includes("approvalChainInstanceId"));
  assert.ok(schema.includes("approval_chain_instances_status_check"));
  assert.ok(schema.includes("approval_chain_instance_steps_status_check"));
});

test("chain creation snapshots policy version and steps before creating first task", () => {
  const engine = read("src/lib/approval-chains.ts");
  assert.ok(engine.includes("policyVersion: policy.version"));
  assert.ok(engine.includes("stepsSnapshot: steps"));
  assert.ok(engine.includes("approvalChainInstanceId: instance.id"));
  assert.ok(engine.includes("approvalChainStepIndex: 0"));
  assert.ok(engine.includes("approval_chain_instances"));
  assert.ok(engine.includes("for update"));
});

test("chain source keys are idempotent and existing instances reuse the current task", () => {
  const engine = read("src/lib/approval-chains.ts");
  assert.ok(engine.includes("sourceType"));
  assert.ok(engine.includes("sourceKey"));
  assert.ok(engine.includes("Existing approval chain instance is missing its current approval task."));
});

test("approval decisions and chain advancement share the same transaction", () => {
  const route = read("src/app/api/approvals/[id]/route.ts");
  assert.ok(route.includes("advanceApprovalChainAfterDecisionTx(tx"));
  assert.ok(route.includes("const decisionResult = await db.transaction"));
  assert.equal(route.includes("const chain = await advanceApprovalChainAfterDecision({"), false);
  assert.ok(route.includes("nextApprovalTaskId: chainResult.nextTaskId"));
});

test("intermediate chain approval keeps Automation Studio waiting on the next task", () => {
  const route = read("src/app/api/approvals/[id]/route.ts");
  assert.ok(route.includes("chain.isChain && !chain.final && chain.nextTaskId"));
  assert.ok(route.includes("waitingApprovalTaskId: chain.nextTaskId"));
  assert.ok(route.includes('status: "waiting_approval"'));
});

test("Automation Studio approval actions support optional chain routing with single-step fallback", () => {
  const engine = read("src/lib/automation.ts");
  assert.ok(engine.includes("approvalChainCode?: string"));
  assert.ok(engine.includes("createApprovalFromConfiguredChain"));
  assert.ok(engine.includes('sourceType: "automation_request_approval"'));
  assert.ok(engine.includes('sourceType: "automation_approval_gate"'));
  assert.ok(engine.includes("fallbackApprover"));
});

test("approval-chain administration is company-wide, MFA protected, audited and demo-safe", () => {
  const api = read("src/app/api/approval-chains/route.ts");
  assert.ok(api.includes("ORG_ADMIN_ROLES"));
  assert.ok(api.includes("companyWide"));
  assert.ok(api.includes("requireSensitiveActionMfa"));
  assert.ok(api.includes("enforceSensitiveActionRateLimit"));
  assert.ok(api.includes("enforceSameOriginMutation"));
  assert.ok(api.includes("publicDemoMutationDenied"));
  assert.ok(api.includes("recordAuditEvent"));
});

test("Approval Studio UI can configure and select chains", () => {
  const admin = read("src/components/approval-chain-admin.tsx");
  const studio = read("src/components/automation-studio-panel.tsx");
  assert.ok(admin.includes("Configurable approval chains"));
  assert.ok(admin.includes("Save new version"));
  assert.ok(admin.includes('action: "save-policy"'));
  assert.ok(admin.includes('action: "set-active"'));
  assert.ok(studio.includes("ApprovalChainAdmin"));
  assert.ok(studio.includes("approvalChainCode"));
  assert.ok(studio.includes("Single approver"));
});
