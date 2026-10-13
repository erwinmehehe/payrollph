import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";

const base = process.env.HRIS_JOURNEY_ACCEPTANCE_URL;
assert.equal(process.env.CI, "true");
assert.equal(process.env.HRIS_JOURNEY_ACCEPTANCE_MODE, "synthetic-postgres-only");
assert.equal(base, "http://127.0.0.1:3000");
assert.equal(process.env.OPENAI_API_KEY ?? "", "");
const database = new URL(process.env.DATABASE_URL ?? "");
assert.ok(["localhost", "127.0.0.1"].includes(database.hostname));
assert.equal(database.pathname, "/app_db");

await mkdir("qa-artifacts", { recursive: true });
const report = {
  sourceSha: process.env.GITHUB_SHA ?? "local", generatedAt: new Date().toISOString(),
  mode: "synthetic localhost Chromium at 375x812", result: "FAIL", checkpoints: [],
  independentOperatorAccepted: false, physicalDeviceAccepted: false,
  realEmployerReconciled: false, productionAccepted: false,
};
const titles = [
  "Confirm employer setup", "Add people and payout details", "Review attendance and period inputs",
  "Assign maker and independent checker", "Calculate and inspect payroll",
  "Independent approval and release", "Export payslips and filing worksheets",
];
const browser = await chromium.launch({ headless: true });
let page;
async function browserGet(path) {
  return page.evaluate(async path => {
    const response = await fetch(path, { credentials: "same-origin", cache: "no-store" });
    return { status: response.status, body: await response.json() };
  }, path);
}
try {
  for (const [role, email] of [
    ["owner", "first-payroll-owner@example.test"], ["payroll", "hcm-payroll@example.test"],
  ]) {
    const context = await browser.newContext({ viewport: { width: 375, height: 812 } });
    page = await context.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    const login = await context.request.post(base + "/api/auth/login", {
      headers: { origin: base, "sec-fetch-site": "same-origin" },
      data: { email, password: "Synthetic-HCM-QA-Password-Only-2026!" },
    });
    assert.equal(login.status(), 200);
    await page.goto(base + "/app?organizationId=1", { waitUntil: "domcontentloaded" });
    const card = page.getByRole("region", { name: "First payroll setup readiness" });
    await card.waitFor({ timeout: 60000 });
    const journey = card.getByRole("list", { name: "Guided first payroll journey" });
    assert.equal(await journey.getByRole("listitem").count(), 7);
    const steps = journey.getByRole("listitem");
    for (let i = 0; i < titles.length; i++) {
      assert.ok((await steps.nth(i).innerText()).includes(titles[i]));
    }
    assert.equal(await card.locator(".first-payroll-grid").count(), 0);
    assert.ok((await card.innerText()).includes("does not certify payroll or authorize payment"));
    // A blocked tenant may open the step, but must not create a payroll run from a preview.
    assert.equal(await card.getByRole("button", { name: /Create actual draft payroll/ }).count(), 0);
    assert.ok((await steps.nth(4).innerText()).includes("Upcoming"));
    assert.ok((await steps.nth(6).innerText()).includes("Upcoming"));
    const bounds = await card.evaluate(element => {
      const rect = element.getBoundingClientRect();
      return { left: rect.left, right: rect.right, width: window.innerWidth,
        scrollWidth: element.scrollWidth, clientWidth: element.clientWidth };
    });
    assert.ok(bounds.left >= -1 && bounds.right <= bounds.width + 1, role + " card leaves phone viewport");
    assert.ok(bounds.scrollWidth <= bounds.clientWidth + 1, role + " card content overflows");
    await card.getByRole("button", { name: "Open people", exact: true }).click();
    // The new contract is inline; no route change or hidden cross-employer roster.
    assert.equal(await page.locator('[data-workspace-page="Overview"]').count(), 1);
    const peoplePanel = card.locator('[aria-label="people inline setup"]');
    await peoplePanel.waitFor({ timeout: 60000 });
    assert.ok((await peoplePanel.innerText()).includes("Add employee inline"));
    assert.ok(!(await peoplePanel.innerText()).includes("BetaPrivate"));
    if (role === "owner") {
      const inbox = await browserGet("/api/hcm/people-operations-inbox?organizationId=1");
      assert.equal(inbox.status, 200);
      assert.equal(inbox.body.organizationId, 1, "People inbox must identify its authorized employer");
      assert.equal(await page.getByText("The People Operations Inbox returned an unexpected employer scope.", { exact: true }).count(), 0);
    }
    report.checkpoints.push(role + ": seven steps, blocked incomplete setup, phone fit and inline People step");

    if (role === "owner") {
      await page.locator(".company-switcher").click();
      await page.getByRole("menuitemradio", { name: /Synthetic Beta Employer/ }).click();
      await page.waitForURL("**/app?organizationId=2");
      const beta = page.getByRole("region", { name: "First payroll setup readiness" });
      await beta.waitFor({ timeout: 60000 });
      assert.equal(await beta.getByRole("list", { name: "Guided first payroll journey" }).count(), 0);
      assert.ok((await beta.innerText()).includes("2 active employees"));
      assert.ok(!(await beta.innerText()).includes("Alpha"));
      await page.locator(".company-switcher").click();
      await page.getByRole("menuitemradio", { name: /Synthetic Alpha Employer/ }).click();
      await page.waitForURL("**/app?organizationId=1");
      await page.getByRole("list", { name: "Guided first payroll journey" }).waitFor({ timeout: 60000 });
      report.checkpoints.push("owner: UI employer switch resets guide mode and roster counts in both directions");
    } else {
      const denied = await browserGet("/api/dashboard?organizationId=2");
      assert.equal(denied.status, 403, "Payroll role must not read unassigned employer");
      report.checkpoints.push("payroll: second-employer API access denied");
    }
    assert.deepEqual(errors, []);
    await context.close();
  }
  report.result = "PASS";
} catch (error) {
  await page?.screenshot({ path: "qa-artifacts/first-payroll-mobile-failed.png", fullPage: true }).catch(() => {});
  throw error;
} finally {
  await writeFile("qa-artifacts/first-payroll-mobile-synthetic.json", JSON.stringify(report, null, 2) + "\n");
  await browser.close();
}
console.log(JSON.stringify(report));
