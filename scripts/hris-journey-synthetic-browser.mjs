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
assert.equal(process.env.EVERYDAY_HR_HIRE_ENABLED, "true");
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
/** Use the actual 375/390px drawer, never direct-set component state. */
async function openMobileApprovals(page) {
  await page.getByRole("button", { name: "Open navigation" }).click();
  await page.locator('.sidebar [data-nav-name="Approvals"]').click();
  await page.locator('[data-workspace-page="Approvals"]').waitFor({ timeout: 60000 });
  await page.getByRole("heading", { name: "Approvals, without the guesswork." }).waitFor();
}

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

  await checkpoint(page, "Everyday HR direct hire creates one real onboarding source", async () => {
    await workspace(page, 1);
    await page.getByRole("button", { name: "Open Hire & onboard" }).click();
    await page.getByRole("heading", { name: "Onboarding checklist" }).waitFor();
    await page.getByRole("button", { name: "Add employee & start onboarding" }).click();
    const hire = page.getByRole("dialog", { name: "Add employee" });
    await hire.waitFor();
    // The server-exposed flag is explicitly enabled only in this disposable lab.
    const before = await browserRequest(page, "/api/dashboard?organizationId=1");
    assert.equal(before.body.everydayHrHireEnabled, true);
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 });
      const bounds = await hire.boundingBox();
      assert.ok(bounds && bounds.x >= -1 && bounds.x + bounds.width <= width + 1,
        "Hire dialog must fit desktop and 390px");
      await page.screenshot({ path: `qa-artifacts/hris-hire-${width}px.png`, fullPage: true });
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await hire.getByLabel("First name").fill("Journey");
    await hire.getByLabel("Last name").fill("Newhire");
    await hire.getByLabel("Job title").fill("Synthetic HR");
    await hire.getByLabel("Monthly rate").fill("24000");
    await hire.getByLabel("Start date").fill("2026-10-15");

    // A transient error must preserve editable input and not claim success.
    await page.route("**/api/employees", route => route.fulfill({
      status: 503, contentType: "application/json",
      body: JSON.stringify({ error: "Synthetic retryable hire failure" }),
    }), { times: 1 });
    await hire.getByRole("button", { name: "Create & onboard" }).click();
    await hire.getByText("Synthetic retryable hire failure", { exact: true }).waitFor();
    assert.equal(await hire.getByLabel("Start date").inputValue(), "2026-10-15");
    assert.equal(await hire.getByLabel("First name").inputValue(), "Journey");

    // This is the real protected UI/API, not a seeded fake completed hire.
    const [create] = await Promise.all([
      page.waitForResponse(response =>
        response.url().endsWith("/api/employees") && response.request().method() === "POST"),
      hire.getByRole("button", { name: "Create & onboard" }).click(),
    ]);
    assert.equal(create.status(), 201, "Source employee creation must succeed from Everyday HR");
    const created = await create.json();
    const id = created?.employee?.id;
    assert.ok(Number.isSafeInteger(id) && id > 0);
    assert.equal(created.employee.organizationId, 1);
    assert.equal(created.employee.firstName, "Journey");
    assert.equal(created.employee.lastName, "Newhire");
    assert.ok(Array.isArray(created.onboarding) && created.onboarding.length > 0,
      "The owning employee-create API must persist real provisioning tasks");

    await hire.waitFor({ state: "hidden" });
    const search = page.getByRole("searchbox", { name: "Search onboarding checklists" });
    await search.fill("Journey Newhire");
    await page.getByRole("heading", { name: "Journey Newhire" }).waitFor({ timeout: 60000 });
    const source = await browserRequest(page, "/api/provisioning?organizationId=1");
    assert.equal(source.status, 200);
    const actual = source.body?.employees?.find(worker => worker.employeeId === id);
    assert.ok(actual && actual.onboarding.length > 0, "Checklist must be linked to exactly the new source employee");
    assert.ok(actual.onboarding.every(task => task.employeeId === id && !task.done));
    assert.ok(!JSON.stringify(source.body).includes("BetaPrivate"),
      "A's checklist must never include the other fictional employer's records");

    const other = await browserRequest(page, "/api/provisioning?organizationId=2");
    assert.equal(other.status, 200);
    assert.ok(!other.body?.employees?.some(worker => worker.employeeId === id),
      "B must not expose newly hired A worker by overlapping identifiers");
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
    const manilaToday = await page.evaluate(() => {
      const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit",
      }).formatToParts(new Date());
      const part = type => parts.find(item => item.type === type)?.value;
      return [part("year"), part("month"), part("day")].join("-");
    });
    assert.equal(await application.locator('input[type="date"]').nth(0).inputValue(),
      manilaToday, "Fresh leave must default to today's Manila date");
    assert.equal(await application.locator('input[type="date"]').nth(1).inputValue(),
      manilaToday, "End date must default to the same Manila day");

    // Explicitly mocked PREVIEW endpoint: this asserts frontend invalidation,
    // not real schedule/payroll calculation or human operator acceptance.
    await page.route("**/api/leave/preview", route => route.fulfill({
      status: 200, contentType: "application/json",
      body: JSON.stringify({
        blocking: false,
        previews: [{
          workDate: manilaToday, timezone: "Asia/Manila",
          unavailableWallMinutes: 240, unavailablePaidMinutes: 240,
          blockers: [], warnings: [],
        }],
      }),
    }));
    const timingChoice = application.locator("select").nth(2);
    await timingChoice.selectOption("first_half");
    assert.equal(await application.locator('input[type="number"]').first().inputValue(), "0.5");
    await application.getByRole("button", { name: "Preview schedule impact" }).click();
    await application.getByText(/240 paid min unavailable/).waitFor({ timeout: 60000 });
    assert.equal(await application.getByRole("button", { name: "Submit request" }).isEnabled(),
      true, "Matching schedule preview should permit a properly configured synthetic request");

    const differentDate = new Date(Date.parse(manilaToday + "T00:00:00Z") + 86400000)
      .toISOString().slice(0, 10);
    await application.locator('input[type="date"]').nth(0).fill(differentDate);
    assert.equal(await application.getByRole("button", { name: "Submit request" }).isDisabled(),
      true, "Changing an input must invalidate an old successful timing preview");
    assert.equal(await application.getByText(/240 paid min unavailable/).count(), 0,
      "Outdated timing evidence must disappear after editing the dates");
    await timingChoice.selectOption("full_day");
    assert.equal(await application.locator('input[type="number"]').first().inputValue(), "1",
      "Switching back to full-day should not leave an invalid 0.5-day request");
    await page.unroute("**/api/leave/preview");

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
    assert.equal(await betaFind.inputValue(), "",
      "Employer switching must discard a prior tenant's employee search");
    await betaFind.fill("Journey Newhire");
    await mobilePage.getByText("No matching employee in your authorized directory.").waitFor();
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

  // Fictional My Team narrow-screen acceptance: real rendered UI in emulated
  // touch/phone Chromium, NOT an independent physical-phone UAT sign-off.
  const mobileManagerState = await manager.storageState();
  const managerRoster = await browserRequest(mp, "/api/hcm/my-team?organizationId=1");
  assert.equal(managerRoster.status, 200);
  const sourceMember = managerRoster.body.items.find(item => item.name === "AlphaPrivate Worker");
  assert.ok(sourceMember && sourceMember.id > 0, "Fictional manager must have a scoped worker");
  const longNumber = "SYNTHETICLONGEMPLOYEEIDENTIFIER".repeat(6);
  const longName = "FictionalUnbrokenEmployeeName".repeat(6);
  const longTitle = "SyntheticUnbrokenPositionTitle".repeat(6);
  const expandedMember = {
    ...sourceMember, name: longName, employeeNo: longNumber, jobTitle: longTitle,
  };
  // UI-only fictional pagination: continuation must contain 25 ordered rows,
  // with a cursor at the last visible ID. These are not database proof rows.
  const firstPageMembers = Array.from({ length: 25 }, (_, index) => index === 0
    ? expandedMember
    : { ...sourceMember, id: sourceMember.id + index,
      employeeNo: "SYNTHETIC-MOBILE-" + index, name: "Synthetic Mobile Worker " + index });
  const firstPageCursor = firstPageMembers.at(-1).id;
  const olderMember = {
    ...sourceMember, id: firstPageCursor + 1, name: "Synthetic Older Worker",
  };
  for (const width of [320, 375, 430]) {
    const phone = await browser.newContext({
      viewport: { width, height: 844 }, isMobile: true, hasTouch: true,
      storageState: mobileManagerState,
    });
    const mobileTeam = await phone.newPage();
    const phoneErrors = [];
    mobileTeam.on("pageerror", error => phoneErrors.push(error.message));
    await mobileTeam.route("**/api/hcm/my-team?*", async route => {
      const url = new URL(route.request().url());
      if (url.searchParams.get("organizationId") !== "1") return route.continue();
      const olderPage = Number(url.searchParams.get("cursor") ?? "0") > 0;
      const items = olderPage ? [olderMember] : firstPageMembers;
      const sum = field => items.reduce((total, item) => total + item[field], 0);
      await route.fulfill({
        status: 200, contentType: "application/json",
        body: JSON.stringify({
          ...managerRoster.body,
          query: url.searchParams.get("q") ?? "",
          statusFilter: url.searchParams.get("status") ?? "all",
          items,
          summary: {
            employeeRecordsThisPage: items.length,
            pendingLeaveRecordsThisPage: sum("pendingLeaveRecords"),
            pendingOvertimeRecordsThisPage: sum("pendingOvertimeRecords"),
            pendingAttendanceCorrectionsThisPage: sum("pendingAttendanceCorrections"),
            incompletePunchRecordsThisPage: sum("incompletePunchRecords"),
          },
          page: {
            size: 25, hasMore: !olderPage,
            nextCursor: olderPage ? null : firstPageCursor,
          },
        }),
      });
    });
    try {
      await checkpoint(mobileTeam, width + "px My Team touch, keyboard, long text and paging", async () => {
        const entry = await mobileTeam.goto(base + "/hcm/my-team?organizationId=1", {
          waitUntil: "domcontentloaded", timeout: 60000,
        });
        assert.equal(entry?.status(), 200, "Fictional manager must reach My Team");
        await mobileTeam.getByRole("heading", { name: "My Team", exact: true }).waitFor();
        await mobileTeam.waitForFunction(value => document.body.innerText.includes(value),
          longNumber, { timeout: 60000 });
        assert.ok((await mobileTeam.getByRole("list", { name: "Authorized employee records" })
          .innerText()).includes(longTitle), "Long fictional position should render");
        const fit = await mobileTeam.evaluate(() => {
          const roster = document.querySelector('ul[aria-label="Authorized employee records"]');
          const rect = roster?.getBoundingClientRect();
          return {
            viewport: document.documentElement.clientWidth,
            pageScroll: document.documentElement.scrollWidth,
            listScroll: roster?.scrollWidth ?? 99999,
            listWidth: roster?.clientWidth ?? 0,
            left: rect?.left ?? -999, right: rect?.right ?? 99999,
          };
        });
        assert.ok(fit.pageScroll <= fit.viewport + 1,
          width + "px long employee text must not horizontally scroll the page");
        assert.ok(fit.listScroll <= fit.listWidth + 1 &&
          fit.left >= -1 && fit.right <= fit.viewport + 1,
          width + "px roster must fit inside the screen");

        const controls = [
          mobileTeam.getByRole("link", { name: "Back to workspace" }),
          mobileTeam.getByRole("button", { name: "Refresh", exact: true }),
          mobileTeam.getByRole("button", { name: "Clear filters" }),
          mobileTeam.locator("#hcm-team-search"),
          mobileTeam.locator("#hcm-team-status"),
          mobileTeam.getByRole("button", { name: "Search", exact: true }),
          mobileTeam.getByRole("button", { name: "Newer", exact: true }),
          mobileTeam.getByRole("button", { name: "Older", exact: true }),
        ];
        for (const control of controls) {
          const rect = await control.boundingBox();
          assert.ok(rect && rect.height >= 43.5,
            width + "px My Team primary control must provide a 44px high touch target");
          assert.ok(rect.x >= -1 && rect.x + rect.width <= width + 1,
            width + "px My Team control must remain visible without horizontal scrolling");
        }
        await mobileTeam.keyboard.press("Tab");
        const back = mobileTeam.getByRole("link", { name: "Back to workspace" });
        const keyboardOutline = await back.evaluate(el =>
          el === document.activeElement && el.matches(":focus-visible") &&
          getComputedStyle(el).outlineStyle !== "none");
        assert.equal(keyboardOutline, true,
          width + "px first keyboard focus must be visible on the back link");
        await mobileTeam.screenshot({
          path: "qa-artifacts/hcm-my-team-mobile-" + width + "px.png", fullPage: true,
        });

        await mobileTeam.getByRole("button", { name: "Older", exact: true }).click();
        await mobileTeam.getByText("Page 2 · 25 records per page maximum").waitFor();
        await mobileTeam.getByText("Synthetic Older Worker", { exact: true }).waitFor();
        assert.equal((await mobileTeam.getByRole("list",
          { name: "Authorized employee records" }).innerText()).includes(longNumber), false);
        await mobileTeam.getByRole("button", { name: "Newer", exact: true }).click();
        await mobileTeam.getByText("Page 1 · 25 records per page maximum").waitFor();
        await mobileTeam.waitForFunction(value => document.body.innerText.includes(value),
          longNumber, { timeout: 60000 });
        assert.deepEqual(phoneErrors, [],
          width + "px My Team must not emit client runtime exceptions");
      });
    } finally {
      await phone.close();
    }
  }

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
    const queued = await browserRequest(mp, "/api/dashboard?organizationId=1");
    assert.equal(queued.status, 200);
    const target = queued.body?.tasks?.find(task => task.id === syntheticLeaveApprovalId);
    assert.equal(target?.title, "Approve leave request",
      "The leave's original task must be present in manager's authorized dashboard");
    assert.equal(target?.status, "Pending");
    const matching = queued.body.tasks.filter(task =>
      task.title === "Approve leave request" && task.detail.includes("AlphaPrivate Worker"));
    assert.equal(matching.length, 1, "Leave approval must have one unambiguous source task");
    assert.equal(matching[0].id, syntheticLeaveApprovalId,
      "Visible leave approval must refer to the exact new leave request");
    const assigned = mp.locator(".approval-content")
      .filter({ hasText: "Approve leave request" })
      .filter({ hasText: "AlphaPrivate Worker" });
    await assigned.waitFor({ timeout: 60000 });
    await assigned.getByRole("button", { name: "Review & approve" }).click();
    // The previous manager approval also emitted this toast. Never treat that
    // stale toast as evidence of a second source decision; wait for the exact
    // authenticated PATCH response tied to the new leave approval ID.
    const [leaveDecision] = await Promise.all([
      mp.waitForResponse(response =>
        response.url().endsWith("/api/approvals/" + syntheticLeaveApprovalId) &&
        response.request().method() === "PATCH", { timeout: 60000 }),
      mp.getByRole("button", { name: "Confirm approval", exact: true }).click(),
    ]);
    assert.equal(leaveDecision.status(), 200,
      "Independent manager's exact leave approval request must succeed");
    await mp.getByText("Approval approved and recorded in the audit trail.")
      .waitFor({ timeout: 60000 });
    const afterDecision = await browserRequest(mp, "/api/dashboard?organizationId=1");
    assert.equal(afterDecision.status, 200);
    assert.equal(afterDecision.body?.tasks?.find(task => task.id === syntheticLeaveApprovalId)?.status,
      "Approved", "The exact source leave approval task must be approved, not a neighboring task");
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

  // #1114: read-only HR provides task IDs for an *independent* A-only manager.
  // Manager never receives a B membership or HR decision privileges to make
  // the test easier. A foreign resource is intentionally concealed as 404.
  const aHrSource = await browserRequest(page, "/api/dashboard?organizationId=1");
  const bHrSource = await browserRequest(page, "/api/dashboard?organizationId=2");
  assert.equal(aHrSource.status, 200);
  assert.equal(bHrSource.status, 200);
  const unassignedA = aHrSource.body.tasks.find(task =>
    task.title === "Synthetic unassigned HR approval");
  const foreignB = bHrSource.body.tasks.find(task =>
    task.title === "BetaPrivate approval");
  assert.equal(unassignedA?.status, "Pending");
  assert.equal(foreignB?.status, "Pending");
  // Reuse the existing A-only Checker from the protected, disposable
  // baseline. Never give this reviewer a B membership just for test setup.
  const checkerIdentity = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await signIn(checkerIdentity, "hcm-checker@example.test");
  const checkerSession = await checkerIdentity.storageState();
  await checkerIdentity.close();
  const hrSession = await hr.storageState();

  for (const width of [375, 390]) {
    const reviewer = await browser.newContext({
      viewport: { width, height: 844 }, isMobile: true, hasTouch: true,
      storageState: checkerSession,
    });
    const reviewerPage = await reviewer.newPage();
    const localErrors = [];
    reviewerPage.on("pageerror", error => localErrors.push(error.message));
    try {
      await checkpoint(reviewerPage, width + "px assigned mobile reviewer / unassigned denials", async () => {
        await workspace(reviewerPage, 1);
        await openMobileApprovals(reviewerPage);
        const title = "Synthetic phone checker approval " + width;
        const row = reviewerPage.locator(".approval-content").filter({ hasText: title });
        await row.waitFor({ timeout: 60000 });
        const before = await browserRequest(reviewerPage, "/api/dashboard?organizationId=1");
        assert.equal(before.status, 200);
        const assigned = before.body.tasks.find(task => task.title === title);
        assert.equal(assigned?.status, "Pending");

        // Company and role assignment are enforced by the API, not the UI.
        assert.equal(await reviewerPage.getByText(
          "Synthetic unassigned HR approval", { exact: true }).count(), 0);
        assert.equal(await reviewerPage.getByText(
          "BetaPrivate approval", { exact: true }).count(), 0);
        const deniedUnassigned = await browserRequest(reviewerPage,
          "/api/approvals/" + unassignedA.id, "PATCH", { status: "Approved" });
        assert.equal(deniedUnassigned.status, 403,
          "An A Checker must not approve an A HR-only unassigned task");
        const concealedForeign = await browserRequest(reviewerPage,
          "/api/approvals/" + foreignB.id, "PATCH", { status: "Approved" });
        assert.equal(concealedForeign.status, 404,
          "Foreign B task IDs are concealed, not exposed as a tenant existence oracle");
        const wrongDashboard = await browserRequest(reviewerPage,
          "/api/dashboard?organizationId=2");
        assert.equal(wrongDashboard.status, 403,
          "An A-only Checker cannot read B dashboard approval records");

        const layout = await reviewerPage.evaluate(() => {
          const card = document.querySelector(".p2-approval-queue");
          const rect = card?.getBoundingClientRect();
          return { viewport: window.innerWidth,
            rootWidth: document.documentElement.clientWidth,
            rootScroll: document.documentElement.scrollWidth,
            cardLeft: rect?.left ?? -999, cardRight: rect?.right ?? 9999 };
        });
        assert.ok(layout.cardLeft >= -1 &&
          layout.cardRight <= layout.viewport + 1 &&
          layout.rootScroll <= layout.rootWidth + 1,
          width + "px approvals must not overflow the phone viewport");

        await row.getByRole("button", { name: "Review & approve" }).click();
        const confirm = reviewerPage.getByRole("dialog");
        await confirm.getByRole("heading", { name: "Confirm approval" }).waitFor();
        const [decision] = await Promise.all([
          reviewerPage.waitForResponse(response =>
            response.url().endsWith("/api/approvals/" + assigned.id) &&
            response.request().method() === "PATCH", { timeout: 60000 }),
          confirm.getByRole("button", { name: "Confirm approval" }).click(),
        ]);
        assert.equal(decision.status(), 200, "Exact assigned mobile source decision must persist");
        await reviewerPage.getByText(
          "Approval approved and recorded in the audit trail.").waitFor({ timeout: 60000 });
        const after = await browserRequest(reviewerPage, "/api/dashboard?organizationId=1");
        assert.equal(after.status, 200);
        assert.equal(after.body.tasks.find(task => task.id === assigned.id)?.status, "Approved");
        assert.equal((await browserRequest(reviewerPage,
          "/api/approvals/" + assigned.id, "PATCH", { status: "Approved" })).status, 409,
          "A decided approval is never silently submitted a second time");
        await reviewerPage.screenshot({
          path: "qa-artifacts/hris-reviewer-" + width + "px.png", fullPage: true });
        assert.deepEqual(localErrors, [], "Signed-in reviewer must have no browser exceptions");
      });
    } finally {
      await reviewer.close();
    }
  }

  // The Checker legitimately belongs only to A. Instead of inventing a B
  // reviewer membership, use the existing dual-member HR session for A->B->A
  // UI scope changes. These full navigations cancel the retired page; they do
  // NOT assert that a synthetic fixture proved within-document React races.
  for (const width of [375, 390]) {
    const switching = await browser.newContext({
      viewport: { width, height: 844 }, isMobile: true, hasTouch: true,
      storageState: hrSession,
    });
    const switchingPage = await switching.newPage();
    const errors = [];
    switchingPage.on("pageerror", error => errors.push(error.message));
    try {
      await checkpoint(switchingPage, width + "px authorized A-B-A approvals and failed read recovery", async () => {
        await workspace(switchingPage, 1);
        await openMobileApprovals(switchingPage);
        await switchingPage.getByText(
          "Synthetic unassigned HR approval", { exact: true }).waitFor();

        const aPattern = "**/api/dashboard?organizationId=1";
        await switchingPage.route(aPattern, route => route.fulfill({
          status: 503, contentType: "application/json",
          body: '{"error":"Synthetic 503 source read only"}',
        }));
        const failedRead = await browserRequest(switchingPage, "/api/dashboard?organizationId=1");
        assert.equal(failedRead.status, 503, "Injected synthetic read outage must be observed");
        await switchingPage.unroute(aPattern);
        const recovered = await browserRequest(switchingPage, "/api/dashboard?organizationId=1");
        assert.equal(recovered.status, 200, "Fresh source retry must recover after 503");
        assert.ok(recovered.body.tasks.some(task =>
          task.title === "Synthetic unassigned HR approval"));
        assert.ok(!recovered.body.tasks.some(task =>
          task.title === "BetaPrivate HR-only approval"));

        // Hold an actual authenticated A read while the real company-switcher
        // replaces the page. The delayed old response must never paint in B.
        let notifyHeld;
        let releaseHeld;
        const heldStarted = new Promise(resolve => { notifyHeld = resolve; });
        const heldFinish = new Promise(resolve => { releaseHeld = resolve; });
        await switchingPage.route(aPattern, async route => {
          notifyHeld();
          await heldFinish;
          await route.fulfill({
            status: 503, contentType: "application/json",
            body: '{"error":"LATE_PRIVATE_A_ERROR"}',
          }).catch(() => { /* old page cancelled the request during navigation */ });
        });
        const obsolete = switchingPage.evaluate(async () => {
          try {
            const response = await fetch("/api/dashboard?organizationId=1", { cache: "no-store" });
            return response.status;
          } catch { return "aborted"; }
        }).catch(() => "navigation-cancelled");
        await heldStarted;
        await switchingPage.locator(".company-switcher").click();
        await switchingPage.getByRole("menuitemradio",
          { name: /Synthetic Beta Employer/ }).click();
        await switchingPage.waitForURL("**/app?organizationId=2");
        releaseHeld();
        await obsolete;
        await switchingPage.unroute(aPattern);
        await openMobileApprovals(switchingPage);
        await switchingPage.getByText("BetaPrivate HR-only approval",
          { exact: true }).waitFor({ timeout: 60000 });
        assert.equal(await switchingPage.getByText(
          "Synthetic unassigned HR approval", { exact: true }).count(), 0);
        assert.equal(await switchingPage.getByText(
          "LATE_PRIVATE_A_ERROR", { exact: false }).count(), 0);
        const inB = await browserRequest(switchingPage, "/api/dashboard?organizationId=2");
        assert.equal(inB.status, 200);
        assert.ok(inB.body.tasks.some(task => task.title === "BetaPrivate HR-only approval"));
        assert.ok(!inB.body.tasks.some(task => task.title === "Synthetic unassigned HR approval"));

        await switchingPage.locator(".company-switcher").click();
        await switchingPage.getByRole("menuitemradio",
          { name: /Synthetic Alpha Employer/ }).click();
        await switchingPage.waitForURL("**/app?organizationId=1");
        await openMobileApprovals(switchingPage);
        await switchingPage.getByText(
          "Synthetic unassigned HR approval", { exact: true }).waitFor({ timeout: 60000 });
        assert.equal(await switchingPage.getByText(
          "BetaPrivate HR-only approval", { exact: true }).count(), 0);
        const inA = await browserRequest(switchingPage, "/api/dashboard?organizationId=1");
        assert.equal(inA.status, 200);
        assert.ok(inA.body.tasks.some(task =>
          task.id === unassignedA.id && task.status === "Pending"));
        assert.deepEqual(errors, [], "Employer switching must not cause React/browser errors");
      });
    } finally {
      await switching.close();
    }
  }

  // None of the denied attempts or network-only injections may mutate source
  // approval tasks. The two authorized mobile manager tasks alone were decided.
  const aFinal = await browserRequest(page, "/api/dashboard?organizationId=1");
  const bFinal = await browserRequest(page, "/api/dashboard?organizationId=2");
  assert.equal(aFinal.body.tasks.find(task => task.id === unassignedA.id)?.status, "Pending");
  assert.equal(bFinal.body.tasks.find(task => task.id === foreignB.id)?.status, "Pending");

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
