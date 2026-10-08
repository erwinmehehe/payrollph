import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";

/**
 * Disposable, synthetic HTTP acceptance for Automation Studio's language lane.
 * Runs against an ephemeral PostgreSQL instance and a local production build.
 * Does NOT use a live AI provider, enable an automation, or certify production.
 *
 * Intentionally never prints raw cookies, receipts, personal data or model output.
 */
const base = process.env.AUTOMATION_ACCEPTANCE_URL ?? "http://127.0.0.1:3000";
const dbUrl = process.env.DATABASE_URL ?? "";

function requireDisposableEnvironment() {
  assert.equal(process.env.CI, "true", "This acceptance test is CI-only");
  assert.equal(process.env.AUTOMATION_LANGUAGE_ACCEPTANCE_MODE, "synthetic-postgres-only");
  assert.equal(base, "http://127.0.0.1:3000", "This test must never target a remote application");
  const parsed = new URL(dbUrl);
  assert.ok(
    (parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost")
      && parsed.pathname === "/app_db",
    "This test requires the CI-only local app_db database",
  );
  assert.equal(process.env.OPENAI_AUTOMATION_DRAFT_ENABLED, "false");
  assert.equal(process.env.OPENAI_API_KEY ?? "", "", "Never call an external model in this test");
  assert.equal(process.env.REQUIRE_PRIVILEGED_MFA, "false",
    "This disposable positive-path test must not weaken the separate production MFA smoke test");
  assert.ok(process.env.SETUP_TOKEN, "CI first-run bootstrap token is missing");
}

async function http(path: string, init: RequestInit = {}) {
  return fetch(new URL(path, base), { redirect: "manual", cache: "no-store", ...init });
}

async function json<T extends Record<string, unknown>>(
  response: Response,
  expectedStatus: number,
  description: string,
): Promise<T> {
  assert.equal(response.status, expectedStatus, description + " HTTP status");
  assert.match(response.headers.get("content-type") ?? "", /application\/json/, description + " JSON");
  return await response.json() as T;
}

function items(v: unknown): Record<string, unknown>[] {
  assert.ok(Array.isArray(v), "Expected an API collection");
  return v as Record<string, unknown>[];
}

async function main() {
  requireDisposableEnvironment();

  const bootstrap = await http("/api/setup", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-setup-token": process.env.SETUP_TOKEN!,
    },
    body: JSON.stringify({
      companyName: "Automation Acceptance Fixture",
      legalName: "Automation Acceptance Fixture Inc.",
      name: "Synthetic Automation Administrator",
      email: "automation-acceptance@example.test",
      password: "SyntheticAcceptance2026-Unique!",
    }),
  });
  const setup = await json<{ organizationId: number }>(bootstrap, 201, "isolated workspace setup");
  assert.ok(Number.isSafeInteger(setup.organizationId) && setup.organizationId > 0);
  const orgId = setup.organizationId;
  // Share only the synthetic organization ID with the subsequent default-off
  // test on the same disposable GitHub runner; no cookie or receipt is stored.
  writeFileSync("/tmp/payrollph-automation-acceptance-org-id", String(orgId), { mode: 0o600 });
  const cookie = (bootstrap.headers.get("set-cookie") ?? "").split(";")[0];
  assert.ok(cookie.startsWith("__Host-linaw_session="), "Expected production-mode HttpOnly session");
  const headers = {
    "content-type": "application/json",
    cookie,
    origin: base,
    "sec-fetch-site": "same-origin",
  };

  const post = (action: string, input: Record<string, unknown> = {}) =>
    http("/api/automation-studio", {
      method: "POST",
      headers,
      body: JSON.stringify({ organizationId: orgId, action, ...input }),
    });
  const studio = () => http(
    "/api/automation-studio?organizationId=" + orgId,
    { headers: { cookie } },
  );

  // A proposal may create an audit record, but must not persist workflow state.
  const empty = await json<{ rules: unknown; executions: unknown }>(await studio(), 200, "empty Studio");
  assert.equal(items(empty.rules).length, 0);
  assert.equal(items(empty.executions).length, 0);

  const prompt =
    "When a new employee is hired, create an onboarding checklist and send them a welcome email.";
  const proposed = await json<{
    source: string;
    draft: Record<string, unknown>;
    proposalReceipt: string;
    validation: { valid: boolean };
  }>(await post("draft-from-language", { request: prompt }), 200, "draft generation");
  assert.equal(proposed.source, "approved-template", "External AI must be disabled");
  assert.equal(proposed.validation.valid, true);
  assert.equal(proposed.draft.trigger, "employee.hired");
  assert.ok(Array.isArray(proposed.draft.actions));
  assert.equal(proposed.draft.actions.length, 2);
  assert.ok(typeof proposed.proposalReceipt === "string" && proposed.proposalReceipt.length > 40);

  const beforeSave = await json<{ rules: unknown; executions: unknown }>(
    await studio(), 200, "no workflow mutation on proposal",
  );
  assert.equal(items(beforeSave.rules).length, 0);
  assert.equal(items(beforeSave.executions).length, 0);

  // The UI must be unable to submit arbitrary edits or forged provenance.
  await json(
    await post("save-language-draft", {
      draft: { ...proposed.draft, name: "Tampered language workflow" },
      proposalReceipt: proposed.proposalReceipt,
    }), 409, "reject modified proposal",
  );
  await json(
    await post("save-language-draft", {
      draft: proposed.draft,
      proposalReceipt: proposed.proposalReceipt + "tampered",
    }), 409, "reject tampered proposal receipt",
  );
  await json(
    await post("save-language-draft", {
      draft: proposed.draft,
    }), 409, "reject missing proposal receipt",
  );
  await json(
    await http("/api/automation-studio", {
      method: "POST",
      headers,
      body: JSON.stringify({
        organizationId: orgId + 99,
        action: "save-language-draft",
        draft: proposed.draft,
        proposalReceipt: proposed.proposalReceipt,
      }),
    }), 403, "cross-tenant request denied",
  );

  // Even a malicious client-level "active" flag must never activate a generated draft.
  const saved = await json<{
    rule: Record<string, unknown>;
    draft: Record<string, unknown>;
  }>(await post("save-language-draft", {
    draft: proposed.draft,
    proposalReceipt: proposed.proposalReceipt,
    active: true,
  }), 201, "signed inactive draft save");
  assert.equal(saved.rule.active, false);
  assert.equal(saved.draft.active, false);
  assert.equal(saved.draft.status, "draft");
  assert.equal(saved.draft.version, 1);
  assert.ok(Number.isSafeInteger(saved.rule.id) && Number(saved.rule.id) > 0);
  const ruleId = Number(saved.rule.id);

  const savedState = await json<{
    rules: unknown; versions: unknown; executions: unknown;
  }>(await studio(), 200, "saved Studio state");
  const savedRule = items(savedState.rules).find((row) => row.id === ruleId);
  assert.ok(savedRule);
  assert.equal(savedRule.active, false);
  assert.equal(savedRule.publishedVersion, 0);
  assert.equal(savedRule.draftVersion, 1);
  assert.equal(items(savedState.executions).length, 0, "Saving must not execute any actions");

  await json(await post("publish-rule", { ruleId, humanApproved: true }),
    409, "publish without Impact Preview denied");
  const preview = await json<{
    previewReceipt: string;
    draft: { ruleId: number; version: number };
    preview: { authoritativeEvents: number; eventsEvaluated: number; authoritativePolicyBlocks: number };
  }>(
    await http(
      "/api/automation-studio?organizationId=" + orgId + "&previewRuleId=" + ruleId,
      { headers: { cookie } },
    ), 200, "zero-write Impact Preview",
  );
  assert.equal(preview.draft.ruleId, ruleId);
  assert.equal(preview.draft.version, 1);
  assert.equal(preview.preview.authoritativeEvents, 0);
  assert.equal(preview.preview.eventsEvaluated, 0);
  assert.equal(preview.preview.authoritativePolicyBlocks, 0);
  assert.ok(typeof preview.previewReceipt === "string" && preview.previewReceipt.length > 40);

  await json(await post("publish-rule", {
    ruleId,
    humanApproved: false,
    previewReceipt: preview.previewReceipt,
    limitedEvidenceAcknowledged: true,
  }), 409, "publish without human approval denied");
  await json(await post("publish-rule", {
    ruleId,
    humanApproved: true,
    previewReceipt: preview.previewReceipt + "forged",
    limitedEvidenceAcknowledged: true,
  }), 409, "publish with altered preview proof denied");
  await json(await post("publish-rule", {
    ruleId,
    humanApproved: true,
    previewReceipt: preview.previewReceipt,
    limitedEvidenceAcknowledged: false,
  }), 409, "zero-event preview requires explicit limited-evidence acknowledgment");

  const published = await json<{
    rule: Record<string, unknown>; published: Record<string, unknown>;
  }>(await post("publish-rule", {
    ruleId,
    humanApproved: true,
    previewReceipt: preview.previewReceipt,
    limitedEvidenceAcknowledged: true,
  }), 200, "explicit, still-inactive publication");
  assert.equal(published.rule.active, false, "Publication must not enable generated rules");
  assert.equal(published.rule.publishedVersion, 1);
  assert.equal(published.rule.draftVersion, null);
  assert.equal(published.published.status, "published");
  assert.equal(published.published.active, false);

  const final = await json<{
    rules: unknown; versions: unknown; executions: unknown;
  }>(await studio(), 200, "final Studio state");
  const finalRule = items(final.rules).find((row) => row.id === ruleId);
  assert.ok(finalRule);
  assert.equal(finalRule.active, false, "No separate enable action was requested");
  assert.equal(finalRule.publishedVersion, 1);
  assert.equal(finalRule.draftVersion, null);
  assert.equal(items(final.executions).length, 0, "Publication must not run any actions");
  assert.equal(items(final.versions).filter((row) => row.ruleId === ruleId && row.status === "published").length, 1);

  console.log(JSON.stringify({
    result: "PASS",
    mode: "isolated-synthetic-local-http",
    model: "disabled-approved-template",
    generated: true,
    generatedWithoutPersisting: true,
    signedSave: true,
    tamperAndCrossTenantDenied: true,
    impactPreview: "zero-write",
    missingHumanApprovalDenied: true,
    missingLimitedEvidenceAckDenied: true,
    publishedInactive: true,
    executionsCreated: 0,
    productionCertified: false,
  }));
}

main().catch((error) => {
  // Do not print response bodies, auth cookies, signed receipts or model output.
  console.error("Isolated language acceptance failed:", error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
