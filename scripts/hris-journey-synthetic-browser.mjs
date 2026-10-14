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
  // Server-rendered inputs are visible before their React listeners attach.
  // In this isolated app, wait for the initial scripts/data to settle before
  // entering text; otherwise fill() can change the DOM without React state.
  await page.waitForLoadState("networkidle");
}

/** A hydrated controlled input is needed before synthetic browser typing.
 * SSR may show a focusable searchbox while React has not yet attached its
 * change handler. Merely waiting for networkidle does not prove hydration.
 * The actual authorized/no-match search checks remain unchanged.
 */
async function hydratedEmployeeSearch(page) {
  const input = page.getByRole("searchbox", { name: "Find an employee" });
  await input.waitFor();
  await page.waitForFunction(() => {
    const node = document.getElementById("hris-employee-quick-find");
    return node instanceof HTMLInputElement &&
      Object.keys(node).some(key => key.startsWith("__reactProps$"));
  }, null, { timeout: 60000 });
  return input;
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

  await checkpoint(page, "HR Home and one-step scoped employee quick-find", async () => {
    await workspace(page, 1);
    await page.getByRole("heading", { name: "Everyday HR" }).waitFor();
    // The default path shows daily actions, while secondary tools stay collapsed.
    await page.getByRole("button", { name: "Open Hire & onboard" }).waitFor();
    await page.getByRole("button", { name: "Open Leave requests" }).waitFor();
    await page.getByRole("button", { name: "Open Approvals" }).waitFor();
    const additional = page.getByText("More HR tools", { exact: true });
    await additional.waitFor();
    const moreTools = page.locator("details").filter({ has: additional });
    assert.equal(await moreTools.evaluate(node => node.open), false,
      "Secondary HR navigation should not crowd the everyday experience");
    const quickFind = await hydratedEmployeeSearch(page);
    await quickFind.fill("BetaPrivate");
    await page.getByText("No matching employee in your authorized directory.").waitFor();
    await quickFind.fill("AlphaPrivate Worker");
    await page.getByRole("button", { name: /Open employee AlphaPrivate Worker,/ }).click();
    await page.locator('[data-workspace-page="People"]').waitFor({ timeout: 60000 });
    const selected = page.getByRole("dialog", { name: "AlphaPrivate Worker" });
    await selected.waitFor();
    await selected.getByRole("button", { name: "Close" }).click();
  });

  await checkpoint(page, "Employee 360 identifies the selected authorized worker", async () => {
    await page.locator(".people-layout .data-table").getByRole("row")
      .filter({ hasText: "AlphaPrivate Worker" }).click();
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

  // P0: use the actual HR Leave form and independent manager approval.
  // Synthetic Chromium does not constitute independently observed human UAT.
  let syntheticLeaveId = null;
  let syntheticLeaveApprovalId = null;
  await checkpoint(page, "Leave policy and first request through HR UI", async () => {
    await workspace(page, 1);
    await page.getByRole("button", { name: "Open Leave requests" }).click();
    await page.locator('[data-workspace-page="Leave"]').waitFor({ timeout: 60000 });
    await page.getByRole("button", { name: "Configure policy" }).click();
    await page.getByLabel("Leave type", { exact: true }).fill("Annual leave");
    await page.getByLabel("Annual days").fill("15");
    await page.getByLabel("Payroll treatment").selectOption("paid");
    await page.getByRole("button", { name: "Save treatment" }).click();
    await page.getByText("Annual leave payroll treatment saved.").waitFor({ timeout: 60000 });

    await page.getByRole("button", { name: "New leave request" }).click();
    // A nested <label><select><option>...</option></select></label> may
    // expose option text as part of its label; target the visible application
    // form and select the worker by its rendered option instead.
    const application = page.locator("article.card").filter({
      has: page.getByRole("heading", { name: "Submit leave application" }),
    });
    await application.waitFor({ timeout: 60000 });
    await application.locator("select").first()
      .selectOption({ label: "AlphaPrivate Worker" });
    await application.locator('input[type="date"]').nth(0).fill("2026-10-20");
    await application.locator('input[type="date"]').nth(1).fill("2026-10-20");
    await application.locator('input[type="number"]').first().fill("1");
    await application.getByRole("button", { name: "Submit request" }).click();
    await page.getByText("Leave request submitted and queued for approval.")
      .waitFor({ timeout: 60000 });

    const alpha = await browserRequest(page, "/api/leave?organizationId=1");
    assert.equal(alpha.status, 200);
    const request = alpha.body?.requests?.find(row =>
      row.employeeName === "AlphaPrivate Worker" &&
      row.leaveType === "Annual leave" && row.startDate === "2026-10-20");
    assert.ok(request && request.status === "Pending",
      "Leave must persist as pending for the intended fictional worker");
    assert.ok(Number.isSafeInteger(request.approvalTaskId) && request.approvalTaskId > 0,
      "Leave must create a source-linked approval task");
    syntheticLeaveId = request.id;
    syntheticLeaveApprovalId = request.approvalTaskId;

    // The requesting HR actor cannot decide a task assigned to someone else.
    const selfReview = await browserRequest(
      page, "/api/approvals/" + syntheticLeaveApprovalId, "PATCH",
      { status: "Approved" },
    );
    assert.equal(selfReview.status, 403, "Requesting HR cannot approve its own leave task");
    const beta = await browserRequest(page, "/api/leave?organizationId=2");
    assert.equal(beta.status, 200);
    assert.ok(!beta.body?.requests?.some(row => row.id === syntheticLeaveId),
      "The second fictional employer cannot inherit Alpha's leave request");
  });

  await checkpoint(page, "Employer switch prevents onboarding data leakage", async () => {
    await workspace(page, 2);
    await page.getByRole("button", { name: "Open Hire & onboard" }).click();
    await page.getByRole("heading", { name: "Onboarding checklist" }).waitFor();
    assert.equal(await page.getByText("AlphaPrivate note", { exact: true }).count(), 0);
  });

  await checkpoint(page, "ESS HR cases: employer-scoped messages, internal-note privacy and blocked COE issuance", async () => {
    await workspace(page, 1);
    const ess = await browser.newContext({ viewport: { width: 375, height: 812 } });
    await signIn(ess, "hcm-employee@example.test");
    const ep = await ess.newPage();
    try {
      await ep.goto(base + "/login", { waitUntil: "domcontentloaded" });
      const created = await browserRequest(ep, "/api/hr-cases", "POST", {
        caseType: "general", subject: "Synthetic staff support",
        description: "A fictional worker requests an HR update for disposable QA.",
      });
      assert.equal(created.status, 201, "ESS case creation failed");
      const id = created.body?.case?.id;
      assert.ok(Number.isSafeInteger(id) && id > 0);
      const employeeOwn = await browserRequest(ep, "/api/hr-cases?organizationId=1");
      assert.equal(employeeOwn.status, 200);
      assert.ok(employeeOwn.body?.cases?.some(row => row.id === id));

      const staff = await browserRequest(page, "/api/hr-cases?organizationId=1");
      assert.equal(staff.status, 200);
      assert.ok(staff.body?.cases?.some(row => row.id === id));
      const internal = await browserRequest(page, "/api/hr-cases", "PATCH", {
        id, action: "internal_note", message: "HR_PRIVATE_SYNTHETIC_ONLY",
      });
      assert.equal(internal.status, 200);
      const afterInternal = await browserRequest(ep, "/api/hr-cases?organizationId=1");
      assert.equal(afterInternal.status, 200);
      assert.equal(JSON.stringify(afterInternal.body).includes("HR_PRIVATE_SYNTHETIC_ONLY"), false,
        "ESS cannot receive internal HR notes");
      const forbidden = await browserRequest(ep, "/api/hr-cases", "PATCH", {
        id, action: "internal_note", message: "Trying to add an internal note",
      });
      assert.equal(forbidden.status, 403);

      const waiting = await browserRequest(page, "/api/hr-cases", "PATCH", {
        id, action: "status", status: "waiting_employee",
      });
      assert.equal(waiting.status, 200);
      const reply = await browserRequest(ep, "/api/hr-cases", "PATCH", {
        id, action: "reply", message: "Synthetic worker reply",
      });
      assert.equal(reply.status, 200);
      assert.equal(reply.body?.case?.status, "in_progress");

      const other = await browserRequest(page, "/api/hr-cases?organizationId=2");
      assert.equal(other.status, 200);
      assert.equal(other.body?.cases?.some(row => row.id === id), false,
        "An A-employer case must never appear under B");

      const coe = await browserRequest(ep, "/api/hr-cases", "POST", {
        caseType: "coe", subject: "Synthetic COE request",
        description: "Request fictional certificate with private vault disabled.",
      });
      assert.equal(coe.status, 201);
      const reject = await browserRequest(page, "/api/hr-cases", "PATCH", {
        id: coe.body.case.id, action: "approve_coe",
      });
      assert.equal(reject.status, 503,
        "COE may not issue when the private document vault is not active");
      for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: 900 });
        await page.goto(base + "/hcm/hr-cases?organizationId=1");
        const inbox = page.getByRole("region", { name: "Employee HR case inbox" });
        await inbox.getByText("Synthetic staff support", { exact: true }).waitFor();
        const bounds = await inbox.boundingBox();
        assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= width + 1);
        await page.screenshot({ path: "qa-artifacts/hr-cases-staff-" + width + ".png", fullPage: true });
        await ep.setViewportSize({ width, height: 900 });
        await ep.goto(base + "/app");
        if (width < 600) {
          await ep.getByRole("button", { name: "More employee pages", exact: true }).click();
          await ep.getByRole("region", { name: "Additional employee pages" })
            .getByRole("button", { name: "Documents", exact: true }).click();
        } else {
          await ep.locator(".employee-side-nav").getByRole("button", { name: "Documents", exact: true }).click();
        }
        const requests = ep.getByRole("region", { name: "HR requests", exact: true });
        await requests.getByText("Synthetic staff support", { exact: true }).waitFor();
        assert.equal(await requests.getByText("HR_PRIVATE_SYNTHETIC_ONLY").count(), 0);
        await requests.screenshot({ path: "qa-artifacts/hr-cases-employee-" + width + ".png" });
      }
      await page.setViewportSize({ width: 1440, height: 900 });
    } finally {
      await ess.close();
    }
  });

  // Verify the same task-first surface at phone width and after the actual
  // employer-switching control reloads the selected tenant. Test data is local.
  const mobileHr = await browser.newContext({
    viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true,
  });
  await signIn(mobileHr, "hcm-hr@example.test");
  const mobilePage = await mobileHr.newPage();
  mobilePage.on("pageerror", error => browserErrors.push(error.message));
  await checkpoint(mobilePage, "375px Everyday HR and employer switching", async () => {
    await workspace(mobilePage, 1);
    const hub = mobilePage.locator('section[aria-labelledby="hris-home-actions-heading"]');
    await hub.waitFor();
    const fit = await hub.evaluate(element => {
      const bounds = element.getBoundingClientRect();
      return {
        left: bounds.left, right: bounds.right, viewport: window.innerWidth,
        scroll: element.scrollWidth, client: element.clientWidth,
      };
    });
    assert.ok(fit.left >= -1 && fit.right <= fit.viewport + 1,
      "Everyday HR must fit the 375px mobile viewport");
    assert.ok(fit.scroll <= fit.client + 1,
      "Everyday HR shortcuts must not overflow horizontally");
    const teamLink = mobilePage.getByRole("link", { name: /Review team/ });
    assert.equal(await teamLink.getAttribute("href"), "/hcm/my-team?organizationId=1");
    assert.equal(await hub.locator("details").first().evaluate(node => node.open), false);
    const quickFind = await hydratedEmployeeSearch(mobilePage);
    await quickFind.fill("BetaPrivate");
    await mobilePage.getByText("No matching employee in your authorized directory.").waitFor();

    // Select the other employer through the UI rather than only loading an API URL.
    await mobilePage.locator(".company-switcher").click();
    await mobilePage.getByRole("menuitemradio", { name: /Synthetic Beta Employer/ }).click();
    await mobilePage.waitForURL("**/app?organizationId=2");
    await mobilePage.getByRole("heading", { name: "Everyday HR" }).waitFor();
    assert.equal(await mobilePage.getByRole("link", { name: /Review team/ }).getAttribute("href"),
      "/hcm/my-team?organizationId=2",
      "Review team must not retain the previous employer ID");
    const betaFind = await hydratedEmployeeSearch(mobilePage);
    await betaFind.fill("AlphaPrivate");
    await mobilePage.getByText("No matching employee in your authorized directory.").waitFor();
    await betaFind.fill("BetaPrivate");
    await mobilePage.getByRole("button", { name: /Open employee BetaPrivate Worker,/ }).waitFor();
  });
  await mobileHr.close();

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

  await checkpoint(mp, "Independent manager approves fictional HR leave request", async () => {
    assert.ok(Number.isSafeInteger(syntheticLeaveId) && Number.isSafeInteger(syntheticLeaveApprovalId));
    const assigned = mp.locator(".approval-content")
      .filter({ hasText: "Approve leave request" })
      .filter({ hasText: "AlphaPrivate Worker" });
    await assigned.waitFor({ timeout: 60000 });
    await assigned.getByRole("button", { name: "Review & approve" }).click();
    await mp.getByRole("button", { name: "Confirm approval", exact: true }).click();
    await mp.getByText("Approval approved and recorded in the audit trail.")
      .waitFor({ timeout: 60000 });
    const leave = await browserRequest(mp, "/api/leave?organizationId=1");
    assert.equal(leave.status, 200);
    assert.equal(leave.body?.requests?.find(row => row.id === syntheticLeaveId)?.status,
      "Approved", "Approved task must update authoritative employee leave");
    const rereview = await browserRequest(mp,
      "/api/approvals/" + syntheticLeaveApprovalId, "PATCH",
      { status: "Approved" });
    assert.equal(rereview.status, 409, "Already-approved task must refuse repeated decision");
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
    independentHumanUat: false, physicalPhoneTested: false, realEmployerReconciled: false,
  }));
  await hr.close();
  await manager.close();
} finally {
  await browser.close();
}
