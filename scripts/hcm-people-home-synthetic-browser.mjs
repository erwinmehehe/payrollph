import assert from "node:assert/strict";
import { chromium } from "playwright";
import { verifyIndependentPeopleHomeTenantProof } from "./qa/hcm-people-home-page-http.mjs";

const base = process.env.HCM_PEOPLE_HOME_ACCEPTANCE_URL ?? "";
const password = "Synthetic-HCM-QA-Password-Only-2026!";

function localOnly() {
  assert.equal(process.env.CI, "true");
  assert.equal(process.env.HCM_PEOPLE_HOME_ACCEPTANCE_MODE, "synthetic-postgres-only");
  assert.equal(base, "http://127.0.0.1:3000", "No deployed app can be targeted");
  const url = new URL(process.env.DATABASE_URL ?? "");
  assert.ok(["localhost", "127.0.0.1"].includes(url.hostname) && url.pathname === "/app_db");
  assert.equal(process.env.OPENAI_API_KEY ?? "", "");
  assert.equal(process.env.GITHUB_ACTIONS, "true", "Disposable GitHub Actions only");
  assert.equal(process.env.DATABASE_URL, "postgresql://postgres:postgres@127.0.0.1:5432/app_db");
  assert.equal(process.env.HCM_PEOPLE_HOME_ENABLED, "true");
  assert.equal(process.env.NEXT_PUBLIC_HCM_PEOPLE_HOME_ENABLED, "true");
  assert.equal(process.env.HCM_PEOPLE_HOME_ORG_IDS, "1,2,3",
    "The real victim must be enabled; a disabled 404 is not tenant authorization");
}

async function login(context, email) {
  const response = await context.request.post(base + "/api/auth/login", {
    headers: {
      "content-type": "application/json",
      origin: base,
      "sec-fetch-site": "same-origin",
    },
    data: { email, password },
    failOnStatusCode: false,
  });
  assert.equal(response.status(), 200, "Synthetic login failed for " + email);
  const result = await response.json();
  assert.equal(result.user?.email, email);
}

async function visit(page, org) {
  const res = await page.goto(base + "/hcm/command-center?organizationId=" + org, {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  assert.ok(res);
  return res.status();
}

async function countEmployees(page) {
  const card = page.locator("article").filter({
    has: page.getByText("Employee records", { exact: true }),
  }).first();
  return Number((await card.locator("p").nth(1).innerText()).trim());
}



async function main() {
  localOnly();
  const browser = await chromium.launch({ headless: true });
  try {
    await verifyIndependentPeopleHomeTenantProof({ browser, base, login });

    const guest = await browser.newContext();
    const guestPage = await guest.newPage();
    await visit(guestPage, 1);
    assert.equal(new URL(guestPage.url()).pathname, "/login",
      "Unauthenticated requests must redirect to login");
    await guest.close();

    const authorized = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await login(authorized, "hcm-hr@example.test");
    const page = await authorized.newPage();
    assert.equal(await visit(page, 1), 200);
    await page.getByRole("heading", { name: "People Home", exact: true }).waitFor();
    assert.equal(await countEmployees(page), 1);
    const region = page.getByRole("region", { name: "My tasks and source follow-ups" });
    assert.equal(await region.count(), 1, "Worklist must have a named screen-reader region");
    for (const sectionName of ["My HCM decisions", "People Ops follow-ups", "Cases assigned to me"]) {
      assert.equal(await page.getByRole("article", { name: sectionName }).count(), 1,
        "Source sections require distinct accessible article names: " + sectionName);
    }
    assert.equal(await page.getByRole("heading", { level: 1, name: "People Home" }).count(), 1);
    assert.equal(await page.getByRole("heading", { level: 2, name: "My tasks and source follow-ups" }).count(), 1);
    const alpha = await page.locator("main").innerText();
    for (const expected of [
      "Synthetic Alpha Employer", "My HCM decisions",
      "People Ops follow-ups", "Cases assigned to me", "Transfer",
      "Partial, bounded preview",
    ]) assert.ok(alpha.toLowerCase().includes(expected.toLowerCase()), "Missing authorized content: " + expected);
    for (const forbidden of ["AlphaPrivate", "BetaPrivate", "99000.00", "Private step"]) {
      assert.ok(!alpha.toLowerCase().includes(forbidden.toLowerCase()), "Private source text leaked: " + forbidden);
    }
    const workflowLinkName = /^Open source workflow: .+ \((?:HCM step|Lifecycle notification|Operational case) [1-9]\d*\)$/;
    const sourceLinks = page.getByRole("link", { name: workflowLinkName });
    const sourceNames = await sourceLinks.evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute("aria-label")));
    assert.ok(sourceNames.length >= 2, "source actions must be identifiable outside card context");
    assert.equal(new Set(sourceNames).size, sourceNames.length,
      "two distinct workflow records must not share a screen-reader link name");
    assert.equal(await page.getByRole("link", {
      name: /^Open worker in People: Onboarding checklist \(Provisioning task [1-9]\d*\)$/,
    }).count(), 1, "worker links must identify the individual provisioning source");
    const source = sourceLinks.first();
    await source.focus();
    assert.equal(await source.evaluate((el) => el === document.activeElement), true);
    await source.click();
    await page.waitForURL("**/app?organizationId=1&workspacePage=People&hcmPanel=bp", {
      timeout: 60000,
    });
    await page.locator('[data-workspace-page="People"]').waitFor({ timeout: 60000 });

    assert.equal(await visit(page, 2), 200);
    assert.equal(await countEmployees(page), 2);
    const beta = await page.locator("main").innerText();
    assert.ok(beta.toLowerCase().includes("synthetic beta employer") && beta.includes("Hire"));
    assert.ok(!beta.includes("Transfer") && !beta.toLowerCase().includes("alphaprivate"));
    assert.equal(await visit(page, "invalid"), 404);
    assert.equal(await visit(page, ""), 404);
    const sharedHrCookies = await authorized.cookies();
    assert.ok(sharedHrCookies.some(cookie => cookie.name === "__Host-linaw_session"),
      "Synthetic HR session must be genuinely authenticated before reuse");
    await authorized.close();

    const mobile = await browser.newContext({ viewport: { width: 375, height: 780 } });
    await mobile.addCookies(sharedHrCookies);
    const small = await mobile.newPage();
    assert.equal(await visit(small, 1), 200);
    const fit = await small.evaluate(() => ({
      width: window.innerWidth,
      scroll: document.documentElement.scrollWidth,
    }));
    assert.ok(fit.scroll <= fit.width + 1, "375px horizontal overflow: " + fit.scroll);
    const mobileLink = small.getByRole("link", { name: workflowLinkName }).first();
    await mobileLink.focus();
    assert.equal(await mobileLink.evaluate((el) => el === document.activeElement), true);
    await mobile.close();

    for (const email of [
      "hcm-denied@example.test", "hcm-payroll@example.test",
      "hcm-manager@example.test", "hcm-unit@example.test",
      "hcm-checker@example.test", "hcm-employee@example.test",
    ]) {
      const context = await browser.newContext();
      await login(context, email);
      const deniedPage = await context.newPage();
      assert.equal(await visit(deniedPage, 1), 404, email + " must be denied");
      assert.equal(await visit(deniedPage, 2), 404, email + " cannot access other tenant");
      await context.close();
    }

    // The second isolated local process disables the feature server-side.
    const off = await browser.newContext();
    await off.addCookies(sharedHrCookies);
    const offPage = await off.newPage();
    const disabled = await offPage.goto(
      "http://127.0.0.1:3001/hcm/command-center?organizationId=1",
      { waitUntil: "domcontentloaded", timeout: 60000 },
    );
    assert.equal(disabled?.status(), 404, "Feature must fail closed when disabled");
    await off.close();
    console.log(JSON.stringify({
      result: "PASS", target: "synthetic localhost only",
      tenantIsolation: true, roles: true, customDeny: true,
      mobile375: true, keyboard: true, screenReaderLandmarks: true, sourceDeepLink: true,
      serverKillSwitch: true, realEmployerAccepted: false,
      productionCertified: false,
    }));
  } finally {
    await browser.close();
  }
}
main().catch((error) => {
  console.error("HCM synthetic browser QA failed: " +
    (error instanceof Error ? error.message : String(error)));
  process.exitCode = 1;
});
