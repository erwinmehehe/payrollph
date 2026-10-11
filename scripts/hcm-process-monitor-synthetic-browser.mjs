import assert from "node:assert/strict";
import { chromium } from "playwright";

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
    assert.equal(await visit(page, 0), 404);
    assert.equal(await visit(page, "abc"), 404);
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
    await mobile.close();

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
    await session.close();

    console.log(JSON.stringify({
      status: "PASS", syntheticOnly: true, realEmployerProof: false,
      tenantIsolation: true, roleDenials: true, responsive375: true,
      keyboard: true, keysetPagination: true, statusFilter: true,
      serverKillSwitch: true, productionCertified: false,
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
