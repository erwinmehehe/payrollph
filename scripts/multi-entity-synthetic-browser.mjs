import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

/**
 * Actual authenticated UI + HTTP acceptance, but ONLY against disposable
 * localhost PostgreSQL and fictional data. No production or live agency data.
 */
const on = "http://127.0.0.1:3000";
const off = "http://127.0.0.1:3001";
const password = "Synthetic-Entity-QA-2026-Only!";
assert.equal(process.env.CI, "true");
assert.equal(process.env.MULTI_ENTITY_QA_MODE, "synthetic-postgres-only");
assert.equal(process.env.OPENAI_API_KEY ?? "", "");
assert.equal(process.env.PAYMONGO_DISBURSEMENTS_ENABLED, "false");
assert.equal(process.env.XENDIT_PAYOUTS_ENABLED, "false");
const db = new URL(process.env.DATABASE_URL ?? "");
assert.ok(["127.0.0.1", "localhost"].includes(db.hostname) && db.pathname === "/app_db");
await mkdir("qa-artifacts/multi-entity", { recursive: true });

const browser = await chromium.launch({ headless: true });
const checks = [];
const screenshots = [];
function filename(name, width) {
  return "qa-artifacts/multi-entity/" + name.replace(/[^a-z0-9-]/gi, "-") + "-" + width + ".png";
}
async function capture(page, name) {
  const width = page.viewportSize()?.width ?? 0;
  const path = filename(name, width);
  await page.screenshot({ path, fullPage: true });
  screenshots.push(path);
}
async function login(context, base, email) {
  const r = await context.request.post(base + "/api/auth/login", {
    headers: { "content-type": "application/json", origin: base, "sec-fetch-site": "same-origin" },
    data: { email, password }, failOnStatusCode: false,
  });
  assert.equal(r.status(), 200, "Disposable login must work for " + email);
}
async function request(context, base, path, method = "GET", data = undefined) {
  const response = await context.request.fetch(base + path, {
    method,
    headers: method === "GET" ? undefined : {
      "Content-Type": "application/json", Origin: base, "sec-fetch-site": "same-origin",
    },
    data, failOnStatusCode: false,
  });
  return { status: response.status(), data: await response.json().catch(() => null) };
}
async function app(page, base) {
  const r = await page.goto(base + "/app?organizationId=1", {
    waitUntil: "domcontentloaded", timeout: 60000,
  });
  assert.equal(r?.status(), 200);
  await page.locator('[data-workspace-page="Overview"]').waitFor({ timeout: 60000 });
}
async function gotoScreen(page, target) {
  if (page.viewportSize()?.width < 550) {
    await page.getByRole("button", { name: "Open navigation" }).click();
  }
  let nav = page.locator('.sidebar [data-nav-name="' + target + '"]').first();
  if (!(await nav.count())) {
    await page.locator(".sidebar .nav-more-toggle").click();
    nav = page.locator('.sidebar [data-nav-name="' + target + '"]').first();
  }
  await nav.click();
  await page.locator('[data-workspace-page="' + target + '"]').waitFor({ timeout: 30000 });
}
async function fitPhone(page) {
  const result = await page.evaluate(() => ({
    width: window.innerWidth,
    contentWidth: document.documentElement.scrollWidth,
  }));
  assert.ok(result.contentWidth <= result.width + 1,
    "Phone-wide page overflow at " + result.width + "px: " + result.contentWidth);
}
async function checkpoint(label, action, page) {
  try { await action(); checks.push(label); }
  catch (e) {
    if (page) await page.screenshot({
      path: filename("failure-" + label, page.viewportSize()?.width ?? 0),
      fullPage: true,
    }).catch(() => {});
    throw new Error(label + ": " + (e instanceof Error ? e.message : String(e)));
  }
}

try {
  const group = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await login(group, on, "entity-group@example.test");
  const g = await request(group, on, "/api/multi-entity/context?organizationId=1");
  assert.equal(g.status, 200);
  assert.equal(g.data?.group, true);
  assert.equal(g.data?.legalEntityId, null);
  assert.equal(g.data?.entities?.length, 2);
  assert.equal(g.data?.entities?.some(e => e.code === "PRIMARY"), true);
  const groupReport = await request(group, on, "/api/multi-entity/reports?organizationId=1");
  assert.equal(groupReport.status, 200);
  assert.equal(groupReport.data.totals.headcount, 2);
  assert.equal(groupReport.data.totals.gross, "0.00");
  const groupSettings = await request(group, on, "/api/multi-entity/settings?organizationId=1");
  assert.equal(groupSettings.status, 200);
  assert.equal(groupSettings.data.canEdit, false);
  for (const entity of groupSettings.data.entities) {
    assert.equal(entity.birTin, "");
    assert.equal(entity.sssEmployerNo, "");
    assert.equal(entity.disbursementBankCode, "");
    assert.equal(entity.disbursementAccount, null);
  }
  checks.push("Group HR read-only tenant totals, redaction and exact two-employer scope");

  const restricted = await browser.newContext();
  await login(restricted, on, "entity-group-unit@example.test");
  for (const path of [
    "/api/multi-entity/context?organizationId=1",
    "/api/multi-entity/reports?organizationId=1",
    "/api/multi-entity/settings?organizationId=1",
  ]) {
    const denied = await request(restricted, on, path);
    assert.equal(denied.status, 403, "Org-unit-scoped group_hr must not see all employers");
    assert.ok(!JSON.stringify(denied.data).includes("Beta Legal"), "Deny response must not leak employer names");
  }
  checks.push("Restricted group_hr denies All across actual authenticated HTTP");

  const ungranted = await browser.newContext();
  await login(ungranted, on, "entity-nogrant@example.test");
  assert.equal((await request(ungranted, on, "/api/multi-entity/context?organizationId=1")).status, 403);
  assert.equal((await request(ungranted, on, "/api/multi-entity/reports?organizationId=1")).status, 403);
  const foreign = await browser.newContext();
  await login(foreign, on, "entity-foreign@example.test");
  assert.equal((await request(foreign, on, "/api/multi-entity/context?organizationId=1")).status, 403);
  checks.push("Ungrantable roles and foreign tenants fail closed");

  const owner = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await login(owner, on, "entity-owner@example.test");
  const op = await owner.newPage();
  const ownerContext = await request(owner, on, "/api/multi-entity/context?organizationId=1");
  assert.equal(ownerContext.status, 200);
  assert.equal(ownerContext.data.group, false);
  assert.equal(ownerContext.data.canSwitch, true);
  assert.equal(ownerContext.data.entities.length, 2);
  assert.equal((await request(owner, on, "/api/multi-entity/reports?organizationId=1")).status, 403);
  await checkpoint("Owner one-granted-entity context and header", async () => {
    await app(op, on);
    const sw = op.getByRole("combobox", { name: "Legal entity switcher" }).first();
    await sw.waitFor({ timeout: 30000 });
    assert.equal(await sw.locator('option[value="all"]').count(), 0);
    await capture(op, "after-owner-header");
  }, op);

  await checkpoint("Entities settings with loading and disabled transfer inbox", async () => {
    await gotoScreen(op, "Entities");
    await op.getByRole("heading", { name: "Entities settings" }).waitFor();
    await op.getByText("Transfer changes are on hold pending legal and payroll signoff.").waitFor();
    await capture(op, "after-entities-settings");
  }, op);
  await checkpoint("Entity settings error and retry state", async () => {
    await op.route("**/api/multi-entity/settings?*", route => route.fulfill({
      status: 503, contentType: "application/json", body: '{"error":"Synthetic service failure."}',
    }));
    await gotoScreen(op, "Overview");
    await gotoScreen(op, "Entities");
    await op.getByRole("alert").getByText("Synthetic service failure.").waitFor();
    await capture(op, "after-entities-error");
    await op.unroute("**/api/multi-entity/settings?*");
    await op.getByRole("button", { name: "Retry" }).first().click();
    await op.getByRole("heading", { name: "Entities settings" }).waitFor();
  }, op);

  const employerA = ownerContext.data.entities.find(e => e.code === "PRIMARY");
  const employerB = ownerContext.data.entities.find(e => e.code === "SECOND");
  assert.ok(employerA && employerB);
  await checkpoint("Persisted employer selection and no implicit All", async () => {
    await op.getByRole("combobox", { name: "Legal entity switcher" }).first()
      .selectOption(String(employerB.id));
    await op.locator('[data-workspace-page="Overview"]').waitFor({ timeout: 60000 });
    const selected = await request(owner, on, "/api/multi-entity/context?organizationId=1");
    assert.equal(selected.status, 200);
    assert.equal(selected.data.legalEntityId, employerB.id);
    assert.equal((await request(owner, on, "/api/multi-entity/reports?organizationId=1")).status, 403);
    await capture(op, "after-owner-switched");
  }, op);

  for (const screen of ["People", "Payroll", "Time & attendance", "Analytics", "Exports"]) {
    await checkpoint("After entity scope " + screen, async () => {
      await gotoScreen(op, screen);
      await capture(op, "after-owner-" + screen);
    }, op);
  }
  await checkpoint("Entity-scoped run reads and wrong-entity creation are denied", async () => {
    const scopedPayroll = await browser.newContext();
    await login(scopedPayroll, on, "entity-payroll@example.test");
    const alphaRuns = await request(scopedPayroll, on, "/api/payroll-runs?organizationId=1");
    assert.equal(alphaRuns.status, 200);
    assert.equal(alphaRuns.data?.runs?.length, 1);
    assert.equal(alphaRuns.data.runs[0].legalEntityId, employerA.id);
    const foreignRunId = alphaRuns.data.runs[0].id;
    const groupRunRead = await request(group, on, "/api/payroll-runs?organizationId=1");
    assert.equal(groupRunRead.status, 403, "Read-only group_hr cannot use payroll operator API");
    // Resource-by-ID is checked against the immutable run's employer before
    // returning job status or bytes. A second grant is not an implicit switch.
    const wrongStatus = await request(owner, on, "/api/payroll-runs?runId=" + foreignRunId);
    assert.equal(wrongStatus.status, 403);
    const wrongExport = await request(owner, on, "/api/payroll-runs/" + foreignRunId + "/exports?kind=journal");
    assert.equal(wrongExport.status, 403);
    const foreignTenantExport = await request(foreign, on, "/api/payroll-runs/" + foreignRunId + "/exports?kind=journal");
    assert.equal(foreignTenantExport.status, 403);
    await scopedPayroll.close();
    const runs = await request(owner, on, "/api/payroll-runs?organizationId=1");
    assert.equal(runs.status, 200);
    assert.equal(runs.data?.runs?.length, 1);
    assert.equal(runs.data.runs[0].legalEntityId, employerB.id);
    const payload = {
      organizationId: 1, periodStart: "2026-11-16",
      periodEnd: "2026-11-30", payDate: "2026-11-30",
      processNow: false,
    };
    const crossEmployer = await request(owner, on, "/api/payroll-runs", "POST", {
      ...payload, legalEntityId: employerA.id, confirmLegalEntityName: employerA.legalName,
    });
    assert.equal(crossEmployer.status, 403, "Other granted employer is NOT selected");
    const wrongName = await request(owner, on, "/api/payroll-runs", "POST", {
      ...payload, legalEntityId: employerB.id, confirmLegalEntityName: "wrong",
    });
    assert.equal(wrongName.status, 422);
    assert.equal(wrongName.data?.code, "ENTITY_CONFIRMATION_REQUIRED");
    const unchanged = await request(owner, on, "/api/payroll-runs?organizationId=1");
    assert.equal(unchanged.data?.runs?.length, 1, "Denied payroll start must create no run");
  }, op);
  await checkpoint("Payroll start UI blocks wrong legal name", async () => {
    await gotoScreen(op, "Payroll");
    await op.getByRole("button", { name: /New payroll/i }).first().click();
    const modal = op.getByRole("dialog", { name: "Create payroll draft" });
    await modal.waitFor();
    await modal.getByLabel("Type legal employer name").waitFor();
    await capture(op, "after-payroll-start-locked");
    const create = modal.getByRole("button", { name: /Create & process/ });
    assert.equal(await create.isDisabled(), true);
    await modal.getByLabel("Type legal employer name").fill(employerB.legalName);
    assert.equal(await create.isDisabled(), false,
      "Exact employer name unlocks UI, but never bypasses server or maker-checker");
    await capture(op, "after-payroll-start-exact-match");
    await modal.getByRole("button", { name: "Cancel" }).click();
  }, op);
  await checkpoint("Transfers are read-only without independent legal approval", async () => {
    const transfers = await request(owner, on, "/api/multi-entity/transfers?organizationId=1");
    assert.equal(transfers.status, 200);
    const attempted = await request(owner, on, "/api/multi-entity/transfers", "POST", {
      organizationId: 1, employeeId: 1, toLegalEntityId: employerA.id,
      effectiveDate: "2026-11-01", reason: "Synthetic only",
    });
    assert.equal(attempted.status, 404);
    const registrationAttempt = await request(owner, on, "/api/multi-entity/registration-changes", "POST", {
      organizationId: 1, legalEntityId: employerB.id, changedFields: { legalName: "never" },
    });
    assert.equal(registrationAttempt.status, 404);
  }, op);

  const hr = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await login(hr, on, "entity-hr@example.test");
  const hp = await hr.newPage();
  await checkpoint("Scoped HR gets fixed employer label, never a switcher", async () => {
    await app(hp, on);
    assert.equal(await hp.getByRole("combobox", { name: "Legal entity switcher" }).count(), 0);
    await hp.getByLabel("Assigned legal employer").waitFor();
    await gotoScreen(hp, "People");
    assert.ok(!(await hp.locator('[data-workspace-page="People"]').innerText()).includes("Beta Synthetic"));
    await fitPhone(hp);
    await capture(hp, "after-scoped-hr-people");
  }, hp);
  const hrc = await request(hr, on, "/api/multi-entity/context?organizationId=1");
  assert.equal(hrc.status, 200);
  assert.equal(hrc.data.legalEntityId, employerA.id);
  assert.equal(hrc.data.canSwitch, false);
  assert.equal((await request(hr, on, "/api/multi-entity/reports?organizationId=1")).status, 403);

  for (const width of [320, 375, 430]) {
    const ctx = await browser.newContext({ viewport: { width, height: 844 } });
    await login(ctx, on, "entity-hr@example.test");
    const p = await ctx.newPage();
    await checkpoint("Scoped HR phone " + width, async () => {
      await app(p, on);
      await fitPhone(p);
      await capture(p, "after-scoped-hr-header");
    }, p);
    await ctx.close();
  }

  const groupPage = await group.newPage();
  await checkpoint("Group HR All entities UI and grouped report", async () => {
    await app(groupPage, on);
    assert.equal(await groupPage.getByRole("combobox", { name: "Legal entity switcher" }).count(), 1);
    assert.equal(await groupPage.getByRole("option", { name: "All entities" }).count(), 1);
    await gotoScreen(groupPage, "Analytics");
    await groupPage.getByRole("heading", { name: "Group headcount & released payroll cost" }).waitFor();
    await capture(groupPage, "after-group-analytics");
  }, groupPage);

  const disabled = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await login(disabled, off, "entity-owner@example.test");
  assert.equal((await request(disabled, off, "/api/multi-entity/context?organizationId=1")).status, 404);
  const oldPage = await disabled.newPage();
  await checkpoint("Flag OFF has no entity switcher or badge", async () => {
    await app(oldPage, off);
    assert.equal(await oldPage.getByRole("combobox", { name: "Legal entity switcher" }).count(), 0);
    assert.equal(await oldPage.getByLabel("Assigned legal employer").count(), 0);
    assert.equal(await oldPage.locator('[data-nav-name="Entities"]').count(), 0);
    await capture(oldPage, "before-owner-header");
    for (const screen of ["People", "Payroll", "Time & attendance", "Analytics", "Exports"]) {
      await gotoScreen(oldPage, screen);
      await capture(oldPage, "before-owner-" + screen);
    }
    await gotoScreen(oldPage, "Payroll");
    await oldPage.getByRole("button", { name: /New payroll/i }).first().click();
    const legacy = oldPage.getByRole("dialog", { name: "Create payroll draft" });
    await legacy.waitFor();
    assert.equal(await legacy.getByLabel("Type legal employer name").count(), 0);
    await capture(oldPage, "before-payroll-start");
    await legacy.getByRole("button", { name: "Cancel" }).click();
  }, oldPage);

  const mobileOff = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await login(mobileOff, off, "entity-hr@example.test");
  const beforeMobile = await mobileOff.newPage();
  await checkpoint("Phone flag OFF remains legacy", async () => {
    await app(beforeMobile, off);
    await gotoScreen(beforeMobile, "People");
    await fitPhone(beforeMobile);
    assert.equal(await beforeMobile.getByLabel("Assigned legal employer").count(), 0);
    await capture(beforeMobile, "before-scoped-hr-people");
  }, beforeMobile);

  console.log(JSON.stringify({
    result: "PASS", mode: "synthetic-postgres-only",
    checks, screenshotCount: screenshots.length,
    widths: [320, 375, 390, 430, 1440],
    realPayrollOrFilingsCertified: false, productionApproved: false,
  }));
} catch (e) {
  console.error("Multi-entity synthetic UI or HTTP acceptance failed: " +
    (e instanceof Error ? e.message : "unknown"));
  process.exitCode = 1;
} finally {
  await browser.close();
}
