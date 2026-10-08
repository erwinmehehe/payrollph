import assert from "node:assert/strict";
import { draftAutomationFromLanguage } from "../src/lib/automation-language-draft";

/**
 * Optional, operator-initiated live-provider contract check.
 *
 * This script is intentionally NOT run by default CI or a PR event.
 * Run only after independent review from a protected, non-production
 * environment with a dedicated short-lived AI-provider key.
 * It never connects to the database or saves/executes workflow rules.
 */
const syntheticPrompts = [
  {
    request: "When a new employee is hired, create an onboarding checklist and send them a welcome email.",
    trigger: "employee.hired",
    requiredTypes: ["create_onboarding_checklist", "send_email"],
    recipient: "employee",
  },
  {
    request: "When an employee is promoted, create a people ops verification task and notify their manager.",
    trigger: "employee.promoted",
    requiredTypes: ["create_task", "send_email"],
    recipient: "manager",
  },
] as const;

function assertProtectedOptIn() {
  assert.equal(
    process.env.AUTOMATION_LANGUAGE_PROVIDER_ACCEPTANCE,
    "synthetic-only",
    "Explicit synthetic-only acceptance opt-in is required.",
  );
  assert.equal(
    process.env.OPENAI_AUTOMATION_DRAFT_ENABLED,
    "true",
    "Provider drafting must be explicitly enabled for this check.",
  );
  assert.ok(
    process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY.length >= 20,
    "A dedicated, non-production AI-provider key must be available via protected environment secrets.",
  );
  assert.ok(
    !process.env.GITHUB_ACTIONS || (
      process.env.GITHUB_EVENT_NAME === "workflow_dispatch"
      && process.env.GITHUB_REF?.startsWith("refs/heads/")
      && process.env.AUTOMATION_LANGUAGE_APPROVED_COMMIT === process.env.GITHUB_SHA
    ),
    "GitHub invocation requires a manually approved exact commit; never run from pull_request.",
  );
}

async function main() {
  assertProtectedOptIn();
  const results: Array<{ scenario: number; result: "PASS"; source: string; steps: number }> = [];
  for (let i = 0; i < syntheticPrompts.length; i++) {
    const expected = syntheticPrompts[i];
    const output = await draftAutomationFromLanguage(expected.request);
    assert.equal(output.source, "model", "Approved-template fallback cannot satisfy live-provider acceptance.");
    assert.equal(output.validation.valid, true, "Model output must pass all server validation.");
    assert.equal(output.draft.trigger, expected.trigger, "Model must preserve the requested authoritative trigger.");
    for (const kind of expected.requiredTypes) {
      assert.ok(output.draft.actions.some((action) => action.type === kind), "Model omitted a required action.");
    }
    assert.ok(output.draft.actions.some((action) =>
      action.type === "send_email" && action.recipient === expected.recipient
    ), "The requested notification recipient must match.");
    results.push({ scenario: i + 1, result: "PASS", source: output.source, steps: output.draft.actions.length });
  }

  // Only non-sensitive status data leaves this process; never log model
  // responses, outgoing headers, protected credentials, or raw free text.
  console.log(JSON.stringify({
    result: "PASS",
    test: "synthetic-live-provider-contract",
    scenarios: results,
    savedDrafts: 0,
    executionsCreated: 0,
    productionCertified: false,
  }));
}

main().catch((error: unknown) => {
  // Sanitized failure class only: errors from a live provider may include
  // request text and must never be emitted in CI logs.
  const category = error instanceof Error && error.name === "AssertionError"
    ? "semantic-contract"
    : "provider-or-guard";
  console.error("Synthetic live-provider acceptance FAILED:", category);
  process.exitCode = 1;
});
