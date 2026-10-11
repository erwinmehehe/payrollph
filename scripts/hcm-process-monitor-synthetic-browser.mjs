import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { chromium } from "playwright";

const require = createRequire(import.meta.url);
const axeSource = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");

/** Automated semantic checks complement, but do not replace, human screen-reader QA.
 * Output rule identifiers/counts only; never serialize payroll/worker DOM contents.
 */
async function assertHcmSemantics(page, label) {
  await page.addScriptTag({ content: axeSource });
  const violations = await page.evaluate(async () => {
    const result = await window.axe.run(document, {
      runOnly: { type: "rule", values: [
        "aria-valid-attr", "aria-valid-attr-value", "button-name", "link-name",
        "label", "duplicate-id", "document-title", "html-has-lang",
        "landmark-one-main",
      ] },
    });
    return result.violations.map(({ id, impact, nodes }) => ({
      id, impact, count: nodes.length,
    }));
  });
  assert.deepEqual(violations, [], label + " semantic accessibility failures");
}


const app = "http://127.0.0.1:3000";
const off = "http://127.0.0.1:3001";

function requireLocalSynthetic() {
  assert.equal(process.env.CI, "true");
  assert.equal(process.env.HCM_MONITOR_ACCEPTANCE_MODE, "synthetic-postgres-only");
  const url = new URL(process.env.DATABASE_URL ?? "");
  assert.ok(["localhost", "127.0.0.1"].includes(url.hostname) && url.pathname === "/app_db");
  assert.equal(process.env.OPENAI_API_KEY ?? "", "");
}

async function login(context, email) {
  const response = await context.request.post(app + "/api/auth/login", {
    headers: {
      origin: app, "sec-fetch-site": "same-origin",
      "content-type": "application/json",
    },
    data: { email, password: "Synthetic-HCM-Monitor-Only-2026!" },
    failOnStatusCode: false,
  });
  assert.equal(response.status(), 200, "Fixture login failed for " + email);
}

async function visit(page, tenant = 1, query = "") {
  const url = app + "/hcm/process-monitor?organizationId=" + tenant + query;
  const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  assert.ok(response);
  return response.status();
}

/** Make authenticated GETs from the real browser origin, not Playwright's
 * separate API request cookie policy for Secure localhost sessions. */
async function browserGet(page, path) {
  return page.evaluate(async (path) => {
    const response = await fetch(path, { credentials: "same-origin", cache: "no-store" });
    return {
      status: response.status,
      cacheControl: response.headers.get("cache-control"),
      data: await response.json(),
    };
  }, path);
}

async function main() {
  requireLocalSynthetic();
  const browser = await chromium.launch({ headless: true });
  try {
    const guest = await browser.newContext();
    const guestPage = await guest.newPage();
    await visit(guestPage);
    assert.equal(new URL(guestPage.url()).pathname, "/login");
    const guestApi = await guest.request.get(app + "/api/hcm/process-monitor?organizationId=1");
    assert.equal(guestApi.status(), 401);
    await guest.close();

    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await login(context, "monitor-hr@example.test");
    const page = await context.newPage();
    assert.equal(await visit(page), 200, "Signed-in HR monitor page must load");
    await page.getByRole("heading", { level: 1, name: "Business Process Monitor" }).waitFor();
    const navigation = page.getByRole("navigation", { name: "HCM workspace navigation" });
    assert.equal(await navigation.getByRole("link", { name: "People Home" })
      .getAttribute("href"), "/hcm/command-center?organizationId=1");
    assert.equal(await navigation.getByRole("link", { name: "Process monitor" })
      .getAttribute("aria-current"), "page");
    assert.equal(await navigation.getByRole("link", { name: "HCM Inbox" })
      .getAttribute("href"), "/app?organizationId=1&workspacePage=People&hcmPanel=bp");
    await assertHcmSemantics(page, "Process Monitor");
    // Keyboard activation, not programmatic click-only navigation.
    await navigation.getByRole("link", { name: "People Home" }).focus();
    await page.keyboard.press("Enter");
    await page.getByRole("heading", { level: 1, name: "People Home" }).waitFor();
    const homeNav = page.getByRole("navigation", { name: "HCM workspace navigation" });
    assert.equal(await homeNav.getByRole("link", { name: "People Home" })
      .getAttribute("aria-current"), "page");
    assert.equal(await homeNav.getByRole("link", { name: "Process monitor" }).count(), 0,
      "Everyday People Home navigation must hide advanced destinations");
    const advanced = page.locator("details").filter({
      has: page.locator("summary", { hasText: "Advanced HCM tools" }),
    }).first();
    await advanced.waitFor();
    assert.equal(await advanced.evaluate((element) => element.open), false,
      "Enterprise HCM tools must be collapsed on entry");
    await advanced.locator("summary").focus();
    await page.keyboard.press("Enter");
    assert.equal(await advanced.evaluate((element) => element.open), true,
      "Keyboard must expand Workday-depth navigation");
    assert.equal(await advanced.getByRole("link", { name: "Process monitor" })
      .getAttribute("href"), "/hcm/process-monitor?organizationId=1");
    await assertHcmSemantics(page, "People Home");
    assert.equal(await advanced.getByRole("link", { name: "Action Center" })
      .getAttribute("href"), "/hcm/action-center?organizationId=1");
    await advanced.getByRole("link", { name: "Action Center" }).focus();
    await page.keyboard.press("Enter");
    await page.getByRole("heading", { level: 1, name: "HCM Action Center" }).waitFor();
    const actionNav = page.getByRole("navigation", { name: "HCM workspace navigation" });
    assert.equal(await actionNav.getByRole("link", { name: "Action Center" })
      .getAttribute("aria-current"), "page");
    await page.getByRole("heading", { level: 2, name: "Governed HCM decisions" }).waitFor();
    const inboxData = await browserGet(page,
      "/api/hcm/business-processes/inbox?organizationId=1");
    assert.equal(inboxData.status, 200, "Authorized HR can read employer-scoped HCM decisions");
    assert.ok(inboxData.cacheControl?.includes("no-store"));
    assert.equal(inboxData.data.meta.companyHistoryAvailable, true);
    assert.ok(inboxData.data.myWork.every((item) =>
      !Object.hasOwn(item, "sourceKey") && !Object.hasOwn(item, "definitionSnapshot")));
    const inboxJson = JSON.stringify(inboxData.data);
    for (const sourceSecret of ["AlphaPrivate test data", "BetaPrivate test data",
      "AlphaPrivate salary detail", "sourceEvidence", "decisionNote"]) {
      assert.ok(!inboxJson.includes(sourceSecret),
        "Private source material must not cross HCM Inbox projection: " + sourceSecret);
    }
    const wrongCompanyInbox = await browserGet(page,
      "/api/hcm/business-processes/inbox?organizationId=999");
    assert.equal(wrongCompanyInbox.status, 403);
    await assertHcmSemantics(page, "HCM Action Center");
    await actionNav.getByRole("link", { name: "Process monitor" }).focus();
    await page.keyboard.press("Enter");
    await page.getByRole("heading", { level: 1, name: "Business Process Monitor" }).waitFor();
    await page.getByRole("navigation", { name: "HCM workspace navigation" })
      .getByRole("link", { name: "HCM Inbox" }).click();
    await page.getByRole("heading", { level: 1, name: "Employees" }).waitFor();
    const inboxUrl = new URL(page.url());
    assert.equal(inboxUrl.searchParams.get("organizationId"), "1");
    assert.equal(inboxUrl.searchParams.get("workspacePage"), "People");
    assert.equal(inboxUrl.searchParams.get("hcmPanel"), "bp");
    const administration = page.locator("details.panel-disclosure")
      .filter({ has: page.locator("summary", { hasText: "Employee administration" }) })
      .first();
    await administration.waitFor();
    assert.equal(await administration.evaluate((element) => element.open), true,
      "HCM Inbox deep link must open its authoritative People administration panel");
    assert.equal(await visit(page), 200);
    await page.getByRole("heading", { level: 1, name: "Business Process Monitor" }).waitFor();
    const main = await page.locator("main").innerText();
    assert.ok(main.includes("Recorded workflows") && main.includes("Step timeline"));
    assert.equal(await page.locator("a[href*='processId=']").count(), 20);
    for (const privateText of ["AlphaPrivate", "BetaPrivate", "privateNotes", "salary detail"]) {
      assert.ok(!main.includes(privateText), "Sensitive workflow source leaked: " + privateText);
    }

    const firstLink = page.locator("a[href*='processId=']").first();
    await firstLink.focus();
    assert.equal(await firstLink.evaluate((node) => node === document.activeElement), true);
    await firstLink.click();
    await page.getByRole("heading", { level: 2, name: "Step timeline" }).waitFor();
    await page.getByRole("list", { name: "Recorded process steps" }).waitFor();
    assert.ok((await page.locator("main").innerText()).includes("Past recorded deadline"));

    const more = page.getByRole("link", { name: "Older workflows" });
    await more.click();
    await page.waitForURL("**/hcm/process-monitor?organizationId=1&cursor=*");
    assert.equal(await page.locator("a[href*='processId=']").count(), 3);

    const filtered = await browserGet(page, "/api/hcm/process-monitor?organizationId=1&status=approved");
    assert.equal(filtered.status, 200, "Authenticated status-filter API must load");
    assert.ok(filtered.cacheControl?.split(",").map((part) => part.trim()).includes("no-store"), "Protected workflow API must be non-cacheable");
    assert.equal(filtered.data.items.length, 1);
    assert.equal(filtered.data.items[0].typeLabel, "Hire");
    const beta = await browserGet(page, "/api/hcm/process-monitor?organizationId=2");
    assert.equal(beta.status, 200, "HR must be able to switch to the second authorized employer");
    assert.equal(beta.data.items.length, 1);
    const foreign = await browserGet(page,
      "/api/hcm/process-monitor?organizationId=1&processId=" + beta.data.items[0].id);
    assert.equal(foreign.status, 200, "Foreign process lookup must produce safe not_found detail");
    assert.equal(foreign.data.detail.state, "not_found");
    // Switching between two permitted employers must never retain links
    // to the previously selected employer.
    assert.equal(await visit(page, 2), 200);
    const betaNav = page.getByRole("navigation", { name: "HCM workspace navigation" });
    assert.equal(await betaNav.getByRole("link", { name: "People Home" })
      .getAttribute("href"), "/hcm/command-center?organizationId=2");
    assert.equal(await betaNav.getByRole("link", { name: "Process monitor" })
      .getAttribute("href"), "/hcm/process-monitor?organizationId=2");
    assert.ok((await betaNav.locator("a").all()).length >= 3);
    assert.equal(await visit(page, 0), 404);
    assert.equal(await visit(page, "abc"), 404);
    const workerPage = await context.newPage();
    const workerResponse = await workerPage.goto(
      app + "/hcm/worker-360?organizationId=1&employeeId=1",
      { waitUntil: "domcontentloaded", timeout: 60000 },
    );
    assert.equal(workerResponse?.status(), 200);
    await workerPage.getByRole("heading", { level: 1, name: "Worker 360" }).waitFor();
    await workerPage.getByRole("heading", { level: 2, name: "Fictional Employee" }).waitFor();
    await workerPage.getByLabel("History as of (Philippine date)").waitFor();
    await workerPage.getByRole("button", { name: "Refresh" }).waitFor();
    await assertHcmSemantics(workerPage, "Worker 360");
    // The source must be tenant-qualified, private and independent of the UI shell.
    const workerApi = await browserGet(workerPage,
      "/api/hcm/worker-360?organizationId=1&employeeId=1&asOfDate=2026-10-11");
    assert.equal(workerApi.status, 200);
    assert.equal(workerApi.data.tenantId, 1);
    assert.equal(workerApi.data.employeeId, 1);
    assert.ok(workerApi.cacheControl?.includes("no-store"));
    assert.ok(!JSON.stringify(workerApi.data).includes("30000.00"),
      "Worker 360 projection must not disclose the synthetic payroll rate");
    const crossEmployer = await browserGet(workerPage,
      "/api/hcm/worker-360?organizationId=2&employeeId=1&asOfDate=2026-10-11");
    assert.equal(crossEmployer.status, 404,
      "Worker ID from employer 1 must not resolve under employer 2");
    const workerNav = workerPage.getByRole("navigation", { name: "HCM workspace navigation" });
    assert.equal(await workerNav.getByRole("link", { name: "Worker 360" })
      .getAttribute("aria-current"), "page");
    assert.equal(await workerNav.getByRole("link", { name: "People Home" })
      .getAttribute("href"), "/hcm/command-center?organizationId=1");
    assert.equal(await workerPage.getByRole("link", { name: "Return to People workspace" })
      .getAttribute("href"), "/app?organizationId=1&workspacePage=People");
    await workerNav.getByRole("link", { name: "Process monitor" }).click();
    await workerPage.getByRole("heading", { level: 1, name: "Business Process Monitor" }).waitFor();
    await context.close();

    const mobile = await browser.newContext({ viewport: { width: 375, height: 790 } });
    await login(mobile, "monitor-hr@example.test");
    const phone = await mobile.newPage();
    assert.equal(await visit(phone), 200, "Authenticated mobile HR page must load");
    const widths = await phone.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      content: document.documentElement.scrollWidth,
    }));
    assert.ok(widths.content <= widths.viewport + 1, "375px monitor overflow: " + JSON.stringify(widths));
    const select = phone.getByLabel("Workflow status");
    await select.selectOption("approved");
    await phone.getByRole("button", { name: "Apply" }).click();
    await phone.waitForURL("**/hcm/process-monitor?organizationId=1&status=approved");
    assert.equal(await phone.locator("a[href*='processId=']").count(), 1);
    const mobileWorker = await phone.goto(
      app + "/hcm/worker-360?organizationId=1&employeeId=1");
    assert.equal(mobileWorker?.status(), 200);
    await phone.getByRole("heading", { level: 2, name: "Fictional Employee" }).waitFor();
    const workerWidths = await phone.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      content: document.documentElement.scrollWidth,
    }));
    assert.ok(workerWidths.content <= workerWidths.viewport + 1,
      "375px Worker 360 overflow: " + JSON.stringify(workerWidths));
    // 320 CSS px reflow is an automated narrow-layout proxy, not a manual 200% zoom test.
    await phone.setViewportSize({ width: 320, height: 800 });
    const reflow = await phone.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      content: document.documentElement.scrollWidth,
    }));
    assert.ok(reflow.content <= reflow.viewport + 1,
      "320px Worker 360 reflow failure: " + JSON.stringify(reflow));
    await mobile.close();

    // Company-wide bookkeeper can view People Home but cannot discover
    // HR-only monitor or Worker 360 from its navigation.
    const finance = await browser.newContext();
    await login(finance, "monitor-bookkeeper@example.test");
    const financePage = await finance.newPage();
    const financeHome = await financePage.goto(
      app + "/hcm/command-center?organizationId=1",
    );
    assert.equal(financeHome?.status(), 200);
    await financePage.getByRole("heading", { level: 1, name: "People Home" }).waitFor();
    const financeNav = financePage.getByRole("navigation", {
      name: "HCM workspace navigation",
    });
    assert.equal(await financeNav.getByRole("link", { name: "Process monitor" }).count(), 0);
    assert.equal(await financeNav.getByRole("link", { name: "Worker 360" }).count(), 0);
    assert.equal(await financeNav.getByRole("link", { name: "HCM Inbox" }).count(), 0);
    assert.equal(await financeNav.getByRole("link", { name: "Action Center" }).count(), 0);
    // Use the authenticated browser, not Playwright's separate API request
    // cookie policy for Secure localhost sessions.
    const financeDeniedPage = await finance.newPage();
    const bookkeeperActionCenter = await financeDeniedPage.goto(
      app + "/hcm/action-center?organizationId=1",
      { waitUntil: "domcontentloaded", timeout: 60000 },
    );
    assert.equal(bookkeeperActionCenter?.status(), 404,
      "Bookkeeper must not open the company-wide HCM Action Center");
    await financeDeniedPage.close();
    assert.equal(await financeNav.getByRole("link", { name: "People directory" }).count(), 0);
    assert.equal(await financePage.getByRole("link", { name: "Open HCM Inbox" }).count(), 0);
    const financeInbox = await browserGet(financePage,
      "/api/hcm/business-processes/inbox?organizationId=1");
    assert.equal(financeInbox.status, 200);
    assert.equal(financeInbox.data.meta.companyHistoryAvailable, false,
      "Bookkeeper cannot read unrelated company-wide HCM history");
    assert.deepEqual(financeInbox.data.recent, financeInbox.data.submitted);
    const financeWorker = await browserGet(financePage,
      "/api/hcm/worker-360?organizationId=1&employeeId=1");
    assert.equal(financeWorker.status, 403, "Bookkeeper cannot access Worker 360 API");
    const financeWorkspace = await financePage.goto(
      app + "/app?organizationId=1&workspacePage=People&hcmPanel=bp",
      { waitUntil: "domcontentloaded", timeout: 60000 },
    );
    assert.equal(financeWorkspace?.status(), 200);
    const landing = financePage.getByRole("heading", { level: 1 }).first();
    await landing.waitFor();
    assert.notEqual(await landing.innerText(), "Employees",
      "Bookkeeper deep link must not bypass hidden People workspace role pages");
    const financeMonitor = await financePage.goto(
      app + "/hcm/process-monitor?organizationId=1",
    );
    assert.equal(financeMonitor?.status(), 404);
    await finance.close();

    for (const email of [
      "monitor-manager@example.test", "monitor-payroll@example.test",
      "monitor-checker@example.test", "monitor-employee@example.test",
      "monitor-unit-hr@example.test", "monitor-denied-hr@example.test",
    ]) {
      const role = await browser.newContext();
      await login(role, email);
      const protectedPage = await role.newPage();
      assert.equal(await visit(protectedPage, 1), 404, email + " must be denied");
      const response = await browserGet(protectedPage, "/api/hcm/process-monitor?organizationId=1");
      assert.equal(response.status, 403, email + " must not read source");
      await role.close();
    }

    const session = await browser.newContext();
    await login(session, "monitor-hr@example.test");
    const disabled = await session.request.get(off + "/api/hcm/process-monitor?organizationId=1");
    assert.equal(disabled.status(), 404);
    const disabledPage = await session.newPage();
    const disabledResponse = await disabledPage.goto(off + "/hcm/process-monitor?organizationId=1");
    assert.equal(disabledResponse?.status(), 404);
    const disabledWorker = await session.request.get(
      off + "/api/hcm/worker-360?organizationId=1&employeeId=1");
    assert.equal(disabledWorker.status(), 404);
    const disabledWorkerPage = await disabledPage.goto(
      off + "/hcm/worker-360?organizationId=1&employeeId=1");
    assert.equal(disabledWorkerPage?.status(), 404);
    await session.close();

    console.log(JSON.stringify({
      status: "PASS", syntheticOnly: true, realEmployerProof: false,
      tenantIsolation: true, roleDenials: true, responsive375: true,
      keyboard: true, keysetPagination: true, statusFilter: true,
      serverKillSwitch: true, semanticA11y: true, reflow320: true,
      humanScreenReaderAccepted: false, stagingIsolationAttested: false,
      productionCertified: false,
    }));
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error("HCM monitor synthetic browser QA failed:",
    error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
