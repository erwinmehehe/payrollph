import assert from "node:assert/strict";
import { chromium } from "playwright";

/**
 * Negative-path rollout acceptance in the same disposable CI database:
 * prove the server-side OFF switch blocks both generation and signed saving,
 * even with an otherwise-valid receipt minted by the ON instance, while
 * preserving the normal manually-authored Automation Studio.
 *
 * Only two loopback app origins and one local disposable DB are permitted.
 * No external AI requests, production hosts, credentials, or execution.
 */
const offBase = "http://127.0.0.1:3001";
const onBase = "http://127.0.0.1:3000";
const email = "automation-acceptance@example.test";
const password = "SyntheticAcceptance2026-Unique!";
let currentPhase = "environment-preflight";

function requireSyntheticEnvironment() {
  assert.equal(process.env.CI, "true", "CI-only test");
  assert.equal(process.env.AUTOMATION_LANGUAGE_ACCEPTANCE_MODE, "synthetic-postgres-only");
  assert.equal(process.env.AUTOMATION_ACCEPTANCE_URL, offBase);
  assert.equal(process.env.APP_BASE_URL, offBase);
  assert.equal(process.env.AUTOMATION_LANGUAGE_STUDIO_ENABLED, "false",
    "An explicit false must override the positive CI fixture");
  assert.equal(process.env.OPENAI_AUTOMATION_DRAFT_ENABLED, "false");
  assert.equal(process.env.OPENAI_API_KEY ?? "", "");
  assert.equal(process.env.REQUIRE_PRIVILEGED_MFA, "false",
    "Positive admin fixture only; real privileged MFA enforcement is tested in HTTP smoke");
  const db = new URL(process.env.DATABASE_URL ?? "");
  assert.ok((db.protocol === "postgres:" || db.protocol === "postgresql:")
    && ["127.0.0.1", "localhost"].includes(db.hostname)
    && db.pathname === "/app_db", "Only disposable loopback Postgres is permitted");
}

async function pagePost(page, organizationId, action, data = {}) {
  return page.evaluate(async ({ organizationId, action, data }) => {
    const response = await fetch("/api/automation-studio", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ organizationId, action, ...data }),
    });
    return { status: response.status, body: await response.json() };
  }, { organizationId, action, data });
}

async function pageStudio(page, organizationId) {
  return page.evaluate(async (id) => {
    const response = await fetch("/api/automation-studio?organizationId=" + id, {
      credentials: "same-origin",
      cache: "no-store",
    });
    if (response.status !== 200) throw new Error("Cannot load synthetic Studio state");
    return response.json();
  }, organizationId);
}

async function main() {
  requireSyntheticEnvironment();
  currentPhase = "launch-chromium";
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
    const page = await context.newPage();

    currentPhase = "login-page";
    await page.goto(offBase + "/login", { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.locator('input[type="email"]').fill(email);
    await page.locator('input[type="password"]').fill(password);
    await Promise.all([
      page.waitForURL("**/app", { timeout: 30_000 }),
      page.getByRole("button", { name: "Sign in", exact: true }).click(),
    ]);
    currentPhase = "authenticated-workspace";
    await page.locator('[data-workspace-page="Overview"]').waitFor({ timeout: 30_000 });
    const automationNav = page.locator('button[data-nav-name="Automation"]');
    if (await automationNav.count() === 0) await page.locator(".nav-more-toggle").click();
    await automationNav.waitFor({ state: "visible", timeout: 10_000 });
    await automationNav.click();
    await page.locator('[data-workspace-page="Automation"]').waitFor();

    currentPhase = "hidden-language-ui-and-manual-ui";
    assert.equal(await page.locator("[data-automation-language-studio]").count(), 0,
      "Language drafting must not render when the server flag is disabled");
    await page.getByText("WORKFLOW TEMPLATES", { exact: true }).waitFor();
    await page.getByText("Configured automations", { exact: true }).waitFor();

    currentPhase = "session-cookie-present";
    // URL-filtered cookie lookups can omit Secure cookies on loopback HTTP,
    // even while Chromium correctly sends them to the local test server.
    // Inspect the isolated browser context and constrain to the loopback host.
    const cookies = await context.cookies();
    const session = cookies.find((row) =>
      row.name === "__Host-linaw_session"
      && (row.domain === "127.0.0.1" || row.domain === "localhost"));
    assert.ok(session?.value, "Synthetic administrator must have a session");

    // The prior positive phase asserts the first disposable organization
    // gets ID 1. No untrusted network value is written to disk between jobs.
    currentPhase = "select-disposable-organization";
    const orgId = 1;

    currentPhase = "load-default-off-studio-state";
    const before = await pageStudio(page, orgId);
    assert.equal(before.features?.languageDraftingEnabled, false);
    assert.ok(Array.isArray(before.rules) && before.rules.length >= 2,
      "Positive acceptance fixture must have saved two workflows beforehand");
    assert.ok(Array.isArray(before.executions));
    const originalExecutions = before.executions.length;

    // Obtain a genuine fresh signed proposal using the *same* session on the
    // enabled loopback instance. Nothing is saved by generation.
    currentPhase = "generate-genuine-on-instance-receipt";
    const response = await fetch(onBase + "/api/automation-studio", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: session.name + "=" + session.value,
        origin: onBase,
        "sec-fetch-site": "same-origin",
      },
      body: JSON.stringify({
        organizationId: orgId,
        action: "draft-from-language",
        request: "When a new employee is hired, create an onboarding checklist and send them a welcome email.",
      }),
      redirect: "manual",
    });
    assert.equal(response.status, 200, "ON instance must issue a genuine signed proposal");
    const generated = await response.json();
    assert.equal(generated.source, "approved-template", "External provider must stay disabled");
    assert.ok(generated.proposalReceipt && generated.draft);

    currentPhase = "deny-disabled-generation";
    const deniedGenerate = await pagePost(page, orgId, "draft-from-language", {
      request: "When an employee is promoted, create a people ops verification task and notify their manager.",
    });
    assert.equal(deniedGenerate.status, 403);
    assert.equal(deniedGenerate.body.code, "LANGUAGE_DRAFTING_DISABLED");

    currentPhase = "deny-genuine-signed-save";
    const deniedSignedSave = await pagePost(page, orgId, "save-language-draft", {
      draft: generated.draft,
      proposalReceipt: generated.proposalReceipt,
      active: true,
    });
    assert.equal(deniedSignedSave.status, 403,
      "Even a genuine, unexpired, session-bound proposal must fail while disabled");
    assert.equal(deniedSignedSave.body.code, "LANGUAGE_DRAFTING_DISABLED");

    currentPhase = "deny-forged-save";
    const deniedForgedSave = await pagePost(page, orgId, "save-language-draft", {
      draft: generated.draft,
      proposalReceipt: "forged",
    });
    assert.equal(deniedForgedSave.status, 403);
    assert.equal(deniedForgedSave.body.code, "LANGUAGE_DRAFTING_DISABLED");

    currentPhase = "verify-zero-mutations";
    const afterDenied = await pageStudio(page, orgId);
    assert.equal(afterDenied.rules.length, before.rules.length);
    assert.equal(afterDenied.versions.length, before.versions.length);
    assert.equal(afterDenied.executions.length, originalExecutions);

    // The release switch must NOT shut down existing manual Automation Studio.
    currentPhase = "manual-studio-remains-operational";
    const manual = await pagePost(page, orgId, "save-rule", {
      name: "Synthetic manual workflow while language drafting disabled",
      trigger: "employee.promoted",
      conditions: { version: 1, all: [], any: [] },
      actions: [{ type: "create_task", title: "Review promotion documentation", owner: "People Ops" }],
      active: false,
    });
    assert.equal(manual.status, 201, "Manual drafting must remain available");
    assert.equal(manual.body.rule.active, false);
    assert.equal(manual.body.draft.status, "draft");

    currentPhase = "verify-inactive-manual-draft";
    const final = await pageStudio(page, orgId);
    assert.equal(final.features.languageDraftingEnabled, false);
    assert.equal(final.rules.length, before.rules.length + 1);
    assert.equal(final.executions.length, originalExecutions, "No actions may execute");
    assert.equal(final.rules.find((r) => r.id === manual.body.rule.id)?.active, false);

    currentPhase = "verify-hidden-ui-after-reload";
    await page.reload({ waitUntil: "domcontentloaded" });
    const nav = page.locator('button[data-nav-name="Automation"]');
    if (await nav.count() === 0) await page.locator(".nav-more-toggle").click();
    await nav.waitFor({ state: "visible", timeout: 15_000 });
    await nav.click();
    await page.locator('[data-workspace-page="Automation"]').waitFor();
    assert.equal(await page.locator("[data-automation-language-studio]").count(), 0);

    console.log(JSON.stringify({
      result: "PASS",
      mode: "isolated-local-disabled-rollout",
      disabledUiHidden: true,
      disabledGenerationDenied: true,
      validSignedSaveDenied: true,
      forgedSaveDenied: true,
      manualBuilderAvailable: true,
      persistenceUnaffectedByDeniedRequests: true,
      executionCountUnchanged: true,
      provider: "disabled",
      productionCertified: false,
    }));
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  // Never print cookies, receipts, responses, or credentials in CI logs.
  const kind = error?.name === "AssertionError" ? "assertion"
    : error?.name === "TimeoutError" ? "timeout"
      : error?.name === "Error" ? "runtime" : "unknown";
  console.error("Isolated disabled-rollout acceptance failed in phase:", currentPhase, "type:", kind);
  process.exitCode = 1;
});
