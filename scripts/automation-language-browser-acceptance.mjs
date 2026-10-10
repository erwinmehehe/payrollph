import assert from "node:assert/strict";
import { chromium } from "playwright";

/**
 * Browser-level acceptance of the real Automation Studio administrator UI.
 * Run only after automation-language-acceptance.ts has created a synthetic
 * owner in an isolated local database. No live provider, no production calls.
 */
const base = process.env.AUTOMATION_ACCEPTANCE_URL ?? "";
const email = "automation-acceptance@example.test";
const password = "SyntheticAcceptance2026-Unique!";

function assertSyntheticTarget() {
  assert.equal(process.env.CI, "true", "CI-only test");
  assert.equal(process.env.AUTOMATION_LANGUAGE_ACCEPTANCE_MODE, "synthetic-postgres-only");
  assert.equal(base, "http://127.0.0.1:3000", "Never target a deployed app");
  const db = new URL(process.env.DATABASE_URL ?? "");
  assert.ok(["localhost", "127.0.0.1"].includes(db.hostname) && db.pathname === "/app_db");
  assert.equal(process.env.OPENAI_AUTOMATION_DRAFT_ENABLED, "false", "Never use a live AI provider");
  assert.equal(process.env.OPENAI_API_KEY ?? "", "", "No AI credentials in synthetic CI");
  assert.equal(process.env.REQUIRE_PRIVILEGED_MFA, "false",
    "Privileged synthetic positive path; production MFA is separately checked by security smoke");
}

function responseFor(action) {
  return (response) => {
    if (!response.url().endsWith("/api/automation-studio")
        || response.request().method() !== "POST") return false;
    try {
      return JSON.parse(response.request().postData() ?? "{}").action === action;
    } catch {
      return false;
    }
  };
}

async function main() {
  assertSyntheticTarget();
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
    const page = await context.newPage();

    await page.goto(base + "/login", { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.locator('input[type="email"]').fill(email);
    await page.locator('input[type="password"]').fill(password);
    await Promise.all([
      page.waitForURL("**/app", { timeout: 30_000 }),
      page.getByRole("button", { name: "Sign in", exact: true }).click(),
    ]);
    await page.locator('[data-workspace-page="Overview"]').waitFor({ timeout: 30_000 });

    const automationNav = page.locator('button[data-nav-name="Automation"]');
    if (await automationNav.count() === 0) {
      await page.locator(".nav-more-toggle").click();
    }
    await automationNav.waitFor({ state: "visible", timeout: 10_000 });
    await automationNav.click();
    await page.locator('[data-workspace-page="Automation"]').waitFor();

    const language = page.locator("[data-automation-language-studio]");
    await language.waitFor({ state: "visible", timeout: 15_000 });
    const generate = language.getByRole("button", { name: "Generate typed draft" });
    const prompt = "When an employee is promoted, create a people ops verification task and notify their manager.";
    await language.locator("textarea").fill(prompt);
    assert.equal(await generate.isDisabled(), true,
      "Consent checkbox must gate external or template-based drafting");
    await language.getByRole("checkbox", {
      name: /I confirm this request has no employee personal or sensitive payroll information/,
    }).check();
    assert.equal(await generate.isEnabled(), true);

    const proposedResponse = page.waitForResponse(responseFor("draft-from-language"), {
      timeout: 20_000,
    });
    await generate.click();
    const proposedHttp = await proposedResponse;
    assert.equal(proposedHttp.status(), 200, "UI generation must succeed");
    const proposed = await proposedHttp.json();
    assert.equal(proposed.source, "approved-template", "External AI must be disabled");
    assert.equal(proposed.draft.trigger, "employee.promoted");

    const proposal = language.locator("[data-language-typed-draft]");
    await proposal.waitFor({ state: "visible", timeout: 15_000 });
    const definition = await proposal.locator("pre").innerText();
    assert.match(definition, /"trigger": "employee.promoted"/);
    assert.match(definition, /"create_task"/);
    assert.match(definition, /"send_email"/);
    assert.equal(await page.getByText("No Automation Studio workflows yet.").count(), 0,
      "An earlier, separate synthetic workflow should exist, proving proposal does not overwrite it");

    const savedResponse = page.waitForResponse(responseFor("save-language-draft"), {
      timeout: 20_000,
    });
    await proposal.getByRole("button", { name: "Save inactive draft" }).click();
    const savedHttp = await savedResponse;
    assert.equal(savedHttp.status(), 201, "Human-triggered signed save");
    const saved = await savedHttp.json();
    assert.equal(saved.rule.active, false);
    assert.equal(saved.draft.active, false);
    assert.equal(saved.draft.status, "draft");
    const ruleId = Number(saved.rule.id);

    await proposal.waitFor({ state: "hidden", timeout: 15_000 });
    const row = page.locator(".leave-request").filter({
      has: page.locator("strong", { hasText: "Promotion control check" }),
    });
    await row.waitFor({ state: "visible", timeout: 15_000 });
    await row.getByText("Draft v1 waiting to publish").waitFor();
    const publish = row.getByRole("button", { name: "Publish v1" });
    assert.equal(await publish.isDisabled(), true,
      "Publish must be disabled until the exact draft has an Impact Preview");

    const previewResponse = page.waitForResponse((response) =>
      response.request().method() === "GET"
      && response.url().includes("/api/automation-studio?")
      && response.url().includes("previewRuleId=" + ruleId), { timeout: 20_000 });
    await row.getByRole("button", { name: "Impact Preview" }).click();
    const previewHttp = await previewResponse;
    assert.equal(previewHttp.status(), 200);
    const preview = await previewHttp.json();
    assert.equal(preview.draft.ruleId, ruleId);
    assert.equal(preview.draft.version, 1);
    assert.equal(preview.preview.authoritativeEvents, 0);
    assert.ok(preview.previewReceipt);

    const panel = page.locator("[data-automation-impact-preview]");
    await panel.waitFor({ state: "visible", timeout: 15_000 });
    await panel.getByText("Limited evidence", { exact: true }).waitFor();
    assert.equal(await publish.isEnabled(), true);

    let dismissed = false;
    page.once("dialog", async (dialog) => {
      assert.match(dialog.message(), /No authoritative events were available/);
      dismissed = true;
      await dialog.dismiss();
    });
    await publish.click();
    assert.equal(dismissed, true, "Human publication confirmation dialog must appear");
    await row.getByText("No published version").waitFor();
    assert.equal(await publish.isVisible(), true,
      "Dismissing approval must leave the draft unpublished");

    let approved = false;
    page.once("dialog", async (dialog) => {
      assert.match(dialog.message(), /No authoritative events were available/);
      approved = true;
      await dialog.accept();
    });
    const publishedResponse = page.waitForResponse(responseFor("publish-rule"), {
      timeout: 20_000,
    });
    await publish.click();
    const publishedHttp = await publishedResponse;
    assert.equal(approved, true);
    assert.equal(publishedHttp.status(), 200, "Explicitly approved, evidence-limited publish");
    const published = await publishedHttp.json();
    assert.equal(published.rule.active, false,
      "Human-approved publication must NOT activate a language-generated workflow");
    assert.equal(published.published.version, 1);
    await row.getByText("Published v1").waitFor({ timeout: 20_000 });
    assert.equal(await row.getByRole("button", { name: "Enable" }).isVisible(), true,
      "Enabling must remain a separate action");

    const orgId = Number(JSON.parse(proposedHttp.request().postData() ?? "{}").organizationId);
    const final = await page.evaluate(async (id) => {
      const response = await fetch("/api/automation-studio?organizationId=" + id, {
        cache: "no-store",
      });
      if (!response.ok) throw new Error("Cannot verify final automation state");
      return response.json();
    }, orgId);
    const finalRule = final.rules.find((item) => item.id === ruleId);
    assert.equal(finalRule.active, false);
    assert.equal(finalRule.draftVersion, null);
    assert.equal(finalRule.publishedVersion, 1);
    assert.equal(final.executions.length, 0,
      "Never execute any workflow actions during synthetic acceptance");

    console.log(JSON.stringify({
      result: "PASS",
      mode: "isolated-local-browser",
      provider: "disabled-approved-template",
      adminLogin: true,
      consentRequired: true,
      reviewedTypedDefinition: true,
      inactiveDraftSaved: true,
      impactPreviewRequired: true,
      zeroEventWarning: true,
      humanConfirmationDismissed: true,
      humanConfirmationAccepted: true,
      publishedButInactive: true,
      executionsCreated: 0,
      productionCertified: false,
    }));
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  // Only a sanitized diagnostic; no cookies, receipts, prompt or model body.
  console.error("Isolated language browser acceptance failed:",
    error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
