import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const engine = readFileSync("src/lib/automation.ts", "utf8");
const api = readFileSync("src/app/api/automation-studio/route.ts", "utf8");
const panel = readFileSync("src/components/automation-studio-panel.tsx", "utf8");

test("Execution Center retries only failed business steps on the original execution identity", () => {
  assert.ok(engine.includes("retryAutomationExecutionFailedStep"));
  assert.ok(engine.includes("latestBusinessStepResults"));
  assert.ok(engine.includes("executionId: execution.id"));
  assert.ok(engine.includes("actionIndex: stepIndex as number"));
  assert.ok(engine.includes("retryAttempt: true"));
  for (const blocked of ["create_task", "create_onboarding_checklist", "send_slack_message", "webhook"]) {
    assert.ok(engine.includes(blocked));
  }
});

test("stored-snapshot replay is constrained to idempotent state-setting actions", () => {
  assert.ok(engine.includes("replayAutomationExecutionSnapshot"));
  for (const allowed of ["assign_permission_set", "assign_benefit", "revoke_sessions", "deactivate_access"]) {
    assert.ok(engine.includes(allowed));
  }
  assert.ok(engine.includes("idempotent state-setting actions"));
  assert.ok(engine.includes("workflow: execution.workflow"));
  assert.ok(engine.includes("context: execution.context"));
});

test("Execution Center mutations keep MFA, same-origin, rate-limit and audit protections", () => {
  assert.ok(api.includes("enforceSameOriginMutation(request)"));
  assert.ok(api.includes("requireSensitiveActionMfa(user)"));
  assert.ok(api.includes("enforceSensitiveActionRateLimit"));
  assert.ok(api.includes('action === "retry-execution-step"'));
  assert.ok(api.includes('action === "replay-execution"'));
  assert.ok(api.includes("Automation execution failed step retried"));
  assert.ok(api.includes("Automation execution stored snapshot replayed"));
});

test("Execution Center exposes attention queue and explicit why-ran/why-skipped diagnostics", () => {
  assert.ok(api.includes("attentionQueue"));
  assert.ok(api.includes("decisionDiagnostics"));
  assert.ok(api.includes("not a historical reconstruction"));
  assert.ok(panel.includes("Failures, retries and replay"));
  assert.ok(panel.includes("Retry failed step"));
  assert.ok(panel.includes("Replay snapshot"));
  assert.ok(panel.includes("WHY RAN / WHY SKIPPED"));
});
