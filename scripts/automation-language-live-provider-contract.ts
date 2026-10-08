import assert from "node:assert/strict";

/**
 * Opt-in provider contract check with SYNTHETIC language only.
 * Does not import a running app, connect to a database, persist drafts,
 * grant approval, publish, enable, or execute an automation.
 *
 * A human operator must supply a separately budgeted staging-only provider
 * credential via an OS/protected-environment secret. Never log the credential.
 */
const approvedMode = "synthetic-only-no-database";

function requireOperatorOptIn() {
  if (process.env.AUTOMATION_PROVIDER_CONTRACT_MODE !== approvedMode) {
    throw new Error("Explicit synthetic provider-contract opt-in is required.");
  }
  if (process.env.OPENAI_AUTOMATION_DRAFT_ENABLED !== "true"
    || !process.env.OPENAI_API_KEY?.trim()) {
    throw new Error("A staging-only model key and enabled drafting flag are required.");
  }
  if (process.env.DATABASE_URL) {
    throw new Error("Unset DATABASE_URL to prevent any live database access.");
  }
  // The repo's automation DSL imports the DB client, which requires a URL at
  // module initialization. Use a deliberately unresolvable local endpoint:
  // this script never invokes any function that queries the database.
  process.env.DATABASE_URL = "postgresql://disabled:disabled@127.0.0.1:65432/no_database_available";
}

type Scenario = {
  id: string;
  request: string;
  trigger: string;
  actions: string[];
  recipient: "employee" | "manager";
};

const SCENARIOS: readonly Scenario[] = [
  {
    id: "new-hire-checklist-and-welcome",
    request: "When a new employee is hired, create an onboarding checklist and send them a welcome email.",
    trigger: "employee.hired",
    actions: ["create_onboarding_checklist", "send_email"],
    recipient: "employee",
  },
  {
    id: "promotion-task-and-manager-notification",
    request: "When an employee is promoted, create a people ops verification task and notify their manager.",
    trigger: "employee.promoted",
    actions: ["create_task", "send_email"],
    recipient: "manager",
  },
];

async function main() {
  requireOperatorOptIn();

  const { draftAutomationFromLanguage, LanguageDraftError } =
    await import("../src/lib/automation-language-draft");

  // Privileged intent must fail BEFORE any outbound provider request.
  const originalFetch = globalThis.fetch;
  let unsafeOutboundRequests = 0;
  try {
    globalThis.fetch = async () => {
      unsafeOutboundRequests += 1;
      throw new Error("Unsupported effect reached network transport.");
    };
    await assert.rejects(
      draftAutomationFromLanguage("When payroll is prepared, adjust employee pay."),
      (error: unknown) => error instanceof LanguageDraftError && error.status === 422,
    );
    assert.equal(unsafeOutboundRequests, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }

  let failures = 0;
  for (const scenario of SCENARIOS) {
    try {
      const result = await draftAutomationFromLanguage(scenario.request);
      assert.equal(result.source, "model", "Must not silently use template fallback");
      assert.equal(result.validation.valid, true);
      assert.equal(result.draft.trigger, scenario.trigger);
      assert.deepEqual(result.draft.actions.map((step) => step.type), scenario.actions,
        "Must not omit or invent any requested action");
      assert.equal(result.draft.conditions.all.length + result.draft.conditions.any.length, 0,
        "Unqualified synthetic request must not invent an IF filter");
      assert.ok(result.draft.actions.some((step) =>
        step.type === "send_email" && step.recipient === scenario.recipient
      ), "Notification recipient must preserve intent");
      // Only report scenario IDs and counts. Do not log draft, prompt, model
      // response, contact names, account details or provider credentials.
      console.log(JSON.stringify({
        scenario: scenario.id,
        result: "PASS",
        triggerMatches: true,
        actionCount: result.draft.actions.length,
        recipientMatches: true,
        state: "in-memory-unpublished",
      }));
    } catch (error) {
      failures += 1;
      const category = error instanceof LanguageDraftError
        ? "drafting-rejected-" + error.status
        : error instanceof assert.AssertionError
          ? "intent-or-schema-mismatch"
          : "unexpected-error";
      console.error(JSON.stringify({ scenario: scenario.id, result: "FAIL", category }));
    }
  }

  if (failures > 0) {
    console.error(JSON.stringify({
      result: "FAIL",
      passed: SCENARIOS.length - failures,
      failed: failures,
      productionCertified: false,
    }));
    process.exitCode = 1;
    return;
  }

  console.log(JSON.stringify({
    result: "PASS",
    mode: approvedMode,
    providerRequests: SCENARIOS.length,
    noDatabase: true,
    noDraftSave: true,
    noWorkflowPublish: true,
    noWorkflowExecute: true,
    productionCertified: false,
  }));
}

main().catch(() => {
  // Do not echo errors that may contain third-party response text or secrets.
  console.error("Provider contract could not start; check opt-in and staging-only environment settings.");
  process.exitCode = 1;
});
