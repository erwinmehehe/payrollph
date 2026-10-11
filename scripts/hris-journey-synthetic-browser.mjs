import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

/**
 * Protected localhost browser/API acceptance of the complete HRIS handoff.
 * Test identities and employer records are deliberately fictional.
 * Never point this at an internet-accessible app or a production database.
 */
const base = process.env.HRIS_JOURNEY_ACCEPTANCE_URL ?? "";
const password = "Synthetic-HCM-QA-Password-Only-2026!";
assert.equal(process.env.CI, "true");
assert.equal(process.env.HRIS_JOURNEY_ACCEPTANCE_MODE, "synthetic-postgres-only");
assert.equal(base, "http://127.0.0.1:3000");
assert.equal(process.env.HCM_MY_TEAM_ENABLED, "true");
assert.equal(process.env.OPENAI_API_KEY ?? "", "");
const database = new URL(process.env.DATABASE_URL ?? "");
assert.ok(["127.0.0.1", "localhost"].includes(database.hostname));
assert.equal(database.pathname, "/app_db");

await mkdir("qa-artifacts", { recursive: true });
const browser = await chromium.launch({ headless: true });
const checkpoints = [];

async function signIn(context, email) {
  const response = await context.request.post(base + "/api/auth/login", {
    headers: {
      "content-type": "application/json",
      origin: base,
      "sec-fetch-site": "same-origin",
    },
    data: { email, password },
    failOnStatusCode: false,
  });
  assert.equal(response.status(), 200, "Synthetic sign-in denied: " + email);
}

/** Call actual APIs from the same authenticated browser origin as the HR UI. */
async function browserRequest(page, path, method = "GET", data = null) {
  return page.evaluate(async ({ path, method, data }) => {
    const response = await fetch(path, {
      method,
      credentials: "same-origin",
      cache: "no-store",
      headers: method === "GET" ? undefined : { "Content-Type": "application/json" },
      body: method === "GET" ? undefined : JSON.stringify(data),
    });
    return {
      status: response.status,
      body: await response.json().catch(() => null),
    };
  }, { path, method, data });
}

async function workspace(page, orgId) {
  const response = await page.goto(base + "/app?organizationId=" + orgId, {
    waitUntil: "domcontentloaded", timeout: 60000,
  });
  assert.equal(response?.status(), 200, "Cannot enter synthetic employer workspace");
  await page.locator('[data-workspace-page="Overview"]').waitFor({ timeout: 60000 });
}

async function checkpoint(page, name, fn) {
  try {
    await fn();
    checkpoints.push(name);
  } catch (error) {
    await page.screenshot({ path: "qa-artifacts/hris-journey-failed.png", fullPage: true }).catch(() => {});
    throw new Error(name + ": " + (error instanceof Error ? error.message : String(error)), { cause: error });
  }
}

try {
  const hr = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await signIn(hr, "hcm-hr@example.test");
  const page = await hr.newPage();
  const browserErrors = [];
  page.on("pageerror", error => browserErrors.push(error.message));

  await checkpoint(page, "HR Home and role-filtered navigation", async () => {
    await workspace(page, 1);
    await page.getByRole("heading", { name: "People operations" }).waitFor();
    await page.getByRole("button", { name: "Open Employee directory" }).click();
    await page.locator('[data-workspace-page="People"]').waitFor({ timeout: 60000 });
  });

  await checkpoint(page, "Employee 360 identifies the selected authorized worker", async () => {
    await page.getByRole("row").filter({ hasText: "AlphaPrivate Worker" }).first().click();
    const drawer = page.getByRole("dialog", { name: "AlphaPrivate Worker" });
    await drawer.waitFor();
    await drawer.getByRole("heading", { name: "Employee 360" }).waitFor();
    for (const label of ["Employment", "Onboarding", "Documents", "Leave", "Performance", "Employment history"]) {
      assert.ok((await drawer.getByText(label, { exact: true }).count()) >= 1, "Missing Employee 360 source: " + label);
    }
    assert.ok(!(await drawer.innerText()).includes("BetaPrivate"));
    await drawer.getByRole("button", { name: "Close" }).click();
  });

  await checkpoint(page, "Recruitment onboarding and scoped task update", async () => {
    await workspace(page, 1);
    await page.getByRole("button", { name: "Open Hire & onboard" }).click();
    await page.getByRole("heading", { name: "Onboarding checklist" }).waitFor();
    await page.getByText("AlphaPrivate note", { exact: true }).waitFor();
    const before = await browserRequest(page, "/api/provisioning?organizationId=1");
    assert.equal(before.status, 200,
      "Authenticated browser provision read failed: " + before.status);
    const payload = before.body;
    const owner = payload.employees.find(row => row.name === "AlphaPrivate Worker");
    assert.ok(owner, "Onboarding must stay attached to the selected employee");
    const item = owner.onboarding.find(task => task.title === "AlphaPrivate note");
    assert.ok(item && item.id > 0, "Expected synthetic onboarding task");

    // A request from the wrong employer or worker cannot mutate the task.
    const wrong = await browserRequest(page, "/api/provisioning", "PATCH", {
      id: item.id, organizationId: 2, employeeId: owner.employeeId, done: true,
    });
    assert.equal(wrong.status, 404);
    const malformed = await browserRequest(page, "/api/provisioning", "PATCH", {
      id: item.id, organizationId: 1, employeeId: owner.employeeId, done: "true",
    });
    assert.equal(malformed.status, 400);

    page.once("dialog", async dialog => { await dialog.accept(); });
    await page.getByRole("checkbox", {
      name: "Mark complete: AlphaPrivate note for AlphaPrivate Worker",
    }).click();
    await page.getByText("Checklist item marked complete in the source workflow.").waitFor({ timeout: 60000 });
    const after = await browserRequest(page, "/api/provisioning?organizationId=1");
    assert.equal(after.status, 200);
    const latest = after.body;
    assert.equal(latest.employees.find(row => row.employeeId === owner.employeeId)
      .onboarding.find(task => task.id === item.id).done, true);
  });

  await checkpoint(page, "Employer switch prevents onboarding data leakage", async () => {
    await workspace(page, 2);
    await page.getByRole("button", { name: "Open Hire & onboard" }).click();
    await page.getByRole("heading", { name: "Onboarding checklist" }).waitFor();
    assert.equal(await page.getByText("AlphaPrivate note", { exact: true }).count(), 0);
  });

  const manager = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await signIn(manager, "hcm-manager@example.test");
  const mp = await manager.newPage();
  mp.on("pageerror", error => browserErrors.push(error.message));
  await checkpoint(mp, "Assigned manager sees only My Team employee records", async () => {
    await workspace(mp, 1);
    await mp.getByRole("link", { name: "My Team", exact: true }).click();
    await mp.getByRole("heading", { name: "My Team", exact: true }).waitFor();
    await mp.getByRole("heading", { name: "Team action center" }).waitFor();
    await mp.getByText("AlphaPrivate Worker", { exact: true }).waitFor();
    assert.ok(!(await mp.locator("main").innerText()).includes("BetaPrivate"));
    const data = await browserRequest(mp, "/api/hcm/my-team?organizationId=1");
    assert.equal(data.status, 200);
    const body = data.body;
    assert.equal(body.scope.kind, "unit");
    assert.ok(body.items.some(item => item.name === "AlphaPrivate Worker"));
    assert.ok(!JSON.stringify(body).includes("99000.00"));
    assert.ok(!JSON.stringify(body).includes("BetaPrivate"));
  });

  await checkpoint(mp, "My Team hands off to independently governed Approvals", async () => {
    await mp.getByRole("link", { name: /My assigned approvals/ }).click();
    await mp.locator('[data-workspace-page="Approvals"]').waitFor({ timeout: 60000 });
    await mp.getByRole("heading", { name: "Approvals, without the guesswork." }).waitFor();
    const record = mp.locator(".approval-content").filter({ hasText: "Synthetic manager HR review" });
    await record.waitFor();
    await record.getByRole("button", { name: "Review & approve" }).click();
    await mp.getByRole("button", { name: "Confirm approval", exact: true }).click();
    await mp.getByText("Approval approved and recorded in the audit trail.").waitFor({ timeout: 60000 });
    const dashboard = await browserRequest(mp, "/api/dashboard?organizationId=1");
    assert.equal(dashboard.status, 200);
    const data = dashboard.body;
    assert.equal(data.tasks.find(task => task.title === "Synthetic manager HR review")?.status, "Approved");
    assert.ok(!JSON.stringify(data.tasks).includes("BetaPrivate approval"));
  });

  await checkpoint(mp, "Manager cannot reach another employer's HRIS", async () => {
    const response = await browserRequest(mp, "/api/hcm/my-team?organizationId=2");
    assert.equal(response.status, 403);
  });

  const unitless = await browser.newContext();
  await signIn(unitless, "hris-unitless@example.test");
  const unitlessPage = await unitless.newPage();
  await unitlessPage.goto(base + "/login", { waitUntil: "domcontentloaded" });
  const denied = await browserRequest(unitlessPage, "/api/hcm/my-team?organizationId=1");
  assert.equal(denied.status, 403, "Unitless manager must fail closed");
  checkpoints.push("Unitless manager fail-closed");
  await unitless.close();

  assert.deepEqual(browserErrors, [], "No client-side exceptions permitted");
  console.log(JSON.stringify({
    result: "PASS", mode: "isolated Postgres 16 and local Chromium",
    checkpoints, liveEmployerDataAccessed: false, payrollReleased: false,
    bankTransfersExecuted: false, productionAccepted: false,
  }));
  await hr.close();
  await manager.close();
} finally {
  await browser.close();
}
