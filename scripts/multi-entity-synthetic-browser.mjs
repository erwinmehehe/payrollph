import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

/**
 * Actual authenticated UI + HTTP acceptance, but ONLY against disposable
 * localhost PostgreSQL and fictional data. No production or live agency data.
 */
const on = "https://127.0.0.1:3000";
const off = "https://127.0.0.1:3001";
const password = "Synthetic-Entity-QA-2026-Only!";
// Reserved TEST-NET addresses represent distinct fictional remote test users.
// Only the disposable localhost runner trusts this single synthetic proxy hop.
const syntheticLoginIp = email => {
  const personas = [
    "entity-group@example.test", "entity-group-unit@example.test",
    "entity-owner@example.test", "entity-hr@example.test",
    "entity-payroll@example.test", "entity-nogrant@example.test",
    "entity-foreign@example.test", "entity-checker@example.test",
  ];
  const index = personas.indexOf(email);
  assert.notEqual(index, -1, "Unknown synthetic login persona");
  return "198.51.100." + (index + 11);
};

assert.equal(process.env.CI, "true");
assert.equal(process.env.MULTI_ENTITY_QA_MODE, "synthetic-postgres-only");
assert.equal(process.env.OPENAI_API_KEY ?? "", "");
assert.equal(process.env.PAYMONGO_DISBURSEMENTS_ENABLED, "false");
assert.equal(process.env.XENDIT_PAYOUTS_ENABLED, "false");
const db = new URL(process.env.DATABASE_URL ?? "");
assert.ok(["127.0.0.1", "localhost"].includes(db.hostname) && db.pathname === "/app_db");
await mkdir("qa-artifacts/multi-entity", { recursive: true });

const browser = await chromium.launch({ headless: true });
// Real HTTPS transport retains Secure __Host- cookies in the same browser context.
const newSyntheticContext = options => browser.newContext({ ignoreHTTPSErrors: true, ...options });
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
    headers: { "content-type": "application/json", origin: base, "sec-fetch-site": "same-origin", "x-forwarded-for": syntheticLoginIp(email) },
    data: { email, password }, failOnStatusCode: false,
  });
  assert.equal(r.status(), 200, "Disposable login must work for " + email);
  // Browser and API must use a genuine HttpOnly, Secure production session
  // issued over ephemeral HTTPS, not a copied token or relaxed cookie policy.
  const session = (await context.cookies(base)).find(c => c.name === "__Host-linaw_session");
  assert.ok(session?.secure && session?.httpOnly,
    "Synthetic login must retain an HttpOnly Secure __Host- session");
}
async function request(context, base, path, method = "GET", data = undefined) {
  assert.equal(process.env.MULTI_ENTITY_QA_MODE, "synthetic-postgres-only");
  assert.ok([on, off, "https://127.0.0.1:3002"].includes(base));
  // Context-managed browser cookies are the sole auth mechanism. Never copy
  // raw session tokens into request headers or test output.
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
    waitUntil: "load", timeout: 60000,
  });
  assert.equal(r?.status(), 200);
  await page.locator('[data-workspace-page="Overview"]').waitFor({ timeout: 60000 });
}
async function gotoScreen(page, target) {
  if (page.viewportSize()?.width < 550) {
    // On phones the visible People tab lives in the bottom navigation. The
    // desktop sidebar is off-canvas even if its DOM button is still attached.
    if (target === "People") {
      // The button includes an icon and CSS can add whitespace around its
      // text. Match the accessible name rather than anchoring innerText:
      // that stale exact-text matcher incorrectly fell back to the drawer.
      const mobileNav = page.getByRole("navigation", { name: "Mobile workspace navigation" });
      const shortcut = mobileNav.getByRole("button", { name: /^(People|Employees)$/i });
      if (await shortcut.isVisible()) {
        // App Router can paint server HTML before the mobile React click
        // handler is hydrated. Give the actual control a bounded second
        // opportunity, then FAIL if no client-side page transition occurs.
        for (let attempt = 0; attempt < 3; attempt += 1) {
          await shortcut.click();
          try {
            await page.locator('[data-workspace-page="' + target + '"]')
              .waitFor({ timeout: 3500 });
            return;
          } catch (error) {
            if (attempt === 2) throw error;
          }
        }
      }
    }
    await page.getByRole("button", { name: "More navigation options" }).click();
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
  const group = await newSyntheticContext({ viewport: { width: 1440, height: 900 } });
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

  const restricted = await newSyntheticContext();
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

  const ungranted = await newSyntheticContext();
  await login(ungranted, on, "entity-nogrant@example.test");
  assert.equal((await request(ungranted, on, "/api/multi-entity/context?organizationId=1")).status, 403);
  assert.equal((await request(ungranted, on, "/api/multi-entity/reports?organizationId=1")).status, 403);
  const foreign = await newSyntheticContext();
  await login(foreign, on, "entity-foreign@example.test");
  assert.equal((await request(foreign, on, "/api/multi-entity/context?organizationId=1")).status, 403);
  checks.push("Ungrantable roles and foreign tenants fail closed");

  const owner = await newSyntheticContext({ viewport: { width: 1440, height: 900 } });
  await login(owner, on, "entity-owner@example.test");
  const op = await owner.newPage();
  const ownerContext = await request(owner, on, "/api/multi-entity/context?organizationId=1");
  assert.equal(ownerContext.status, 200);
  assert.equal(ownerContext.data.group, false);
  assert.equal(ownerContext.data.canSwitch, true);
  assert.equal(ownerContext.data.entities.length, 2);
  assert.equal((await request(owner, on, "/api/multi-entity/reports?organizationId=1")).status, 403);
  await checkpoint("Legacy BI metadata and cross-employer export fail closed over authenticated HTTP", async () => {
    for (const path of [
      "/api/bi-exports?organizationId=1",
      "/api/bi-exports?organizationId=1&key=payroll_runs&format=csv" +
        "&startDate=2026-09-01&endDate=2026-09-30&legalEntityId=" + ownerContext.data.entities[1].id,
      "/api/bi-exports?organizationId=1&key=payroll_entries&format=json" +
        "&startDate=2026-09-01&endDate=2026-09-30",
    ]) {
      const denied = await request(owner, on, path);
      assert.equal(denied.status, 409, "Uncertified BI read/export must not reach tenant-wide data: " + path);
      assert.equal(denied.data?.code, "ENTITY_BI_EXPORT_NOT_YET_CERTIFIED");
      assert.ok(!JSON.stringify(denied.data).includes("Beta Synthetic"),
        "Rejected BI request must not serialize foreign legal-employer records");
    }
  });
  await checkpoint("HCM API GET/POST fail closed under multi-entity flag", async () => {
    for (const path of [
      "/api/hcm/lifecycle-readiness?organizationId=1",
      "/api/hcm/people-operations-inbox?organizationId=1",
      "/api/hcm/effective-changes?organizationId=1",
      "/api/hcm/worker-profile?organizationId=1",
    ]) {
      const denied = await request(owner, on, path);
      assert.equal(denied.status, 403, "Multi-entity HCM must fail closed: " + path);
      assert.equal(denied.data?.code, "ENTITY_HCM_DEFERRED");
    }
    const protectedPage = await request(owner, on, "/hcm/action-center?organizationId=1");
    assert.equal(protectedPage.status, 403, "Protected HCM page must not SSR cross-employer data");
    assert.equal(protectedPage.data?.code, "ENTITY_HCM_DEFERRED");
    const publicHcmMarketing = await request(owner, on, "/hcm");
    assert.equal(publicHcmMarketing.status, 200, "Public HCM marketing page must remain available");
    const mutation = await request(owner, on, "/api/hcm/effective-changes", "POST", {
      organizationId: 1,
    });
    assert.equal(mutation.status, 403, "Unreviewed HCM mutation must never reach its route");
    assert.equal(mutation.data?.code, "ENTITY_HCM_DEFERRED");
  });
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
  await checkpoint("Scoped analytics hides legacy company-wide BI export controls", async () => {
    await gotoScreen(op, "Analytics");
    assert.equal(await op.locator("[data-enterprise-bi-export]").count(), 0);
  }, op);
  await checkpoint("Entity-scoped run reads and wrong-entity creation are denied", async () => {
    const scopedPayroll = await newSyntheticContext();
    await login(scopedPayroll, on, "entity-payroll@example.test");
    await checkpoint("Government-loan selector and GET/POST enforce explicit employer grants", async () => {
      const selector = await request(scopedPayroll, on, "/api/legal-entities?organizationId=1&mode=selector&selection=granted");
      assert.equal(selector.status, 200);
      assert.deepEqual(selector.data.legalEntities.map(entity => entity.id), [employerA.id]);
      const both = await request(owner, on, "/api/legal-entities?organizationId=1&mode=selector&selection=granted");
      assert.equal(both.status, 200);
      assert.deepEqual(both.data.legalEntities.map(entity => entity.id).sort(), [employerA.id, employerB.id].sort());
      for (const context of [ungranted, foreign]) {
        assert.equal((await request(context, on, "/api/legal-entities?organizationId=1&mode=selector&selection=granted")).status, 403);
      }
      const before = await request(owner, on, "/api/compliance/government-loan-remittances?organizationId=1&legalEntityId=" + employerB.id);
      assert.equal(before.status, 200);
      const own = await request(scopedPayroll, on, "/api/compliance/government-loan-remittances?organizationId=1&legalEntityId=" + employerA.id);
      assert.equal(own.status, 200);
      assert.equal(own.data.legalEntityId, employerA.id);
      const denied = await request(scopedPayroll, on, "/api/compliance/government-loan-remittances?organizationId=1&legalEntityId=" + employerB.id);
      assert.equal(denied.status, 403);
      assert.equal(denied.data.code, "ENTITY_ACCESS_DENIED");
      const deniedPost = await request(scopedPayroll, on, "/api/compliance/government-loan-remittances", "POST", {
        organizationId: 1, legalEntityId: employerB.id, action: "create_batch", agency: "SSS", applicableMonth: "2026-10",
      });
      assert.equal(deniedPost.status, 403);
      assert.equal(deniedPost.data.code, "ENTITY_ACCESS_DENIED");
      const after = await request(owner, on, "/api/compliance/government-loan-remittances?organizationId=1&legalEntityId=" + employerB.id);
      assert.equal(after.status, 200);
      assert.deepEqual(after.data, before.data, "Rejected employer POST cannot change target batches/members");
    });

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
    await op.getByRole("button", { name: /New payroll|Start another payroll|Create payroll/i }).first().click();
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

  const hr = await newSyntheticContext({ viewport: { width: 390, height: 844 } });
  await login(hr, on, "entity-hr@example.test");
  await checkpoint("Scoped HR BI metadata and payroll export cannot enumerate other employers", async () => {
    for (const path of [
      "/api/bi-exports?organizationId=1",
      "/api/bi-exports?organizationId=1&key=payroll_runs&format=csv" +
        "&startDate=2026-09-01&endDate=2026-09-30",
    ]) {
      const denied = await request(hr, on, path);
      assert.equal(denied.status, 409);
      assert.equal(denied.data?.code, "ENTITY_BI_EXPORT_NOT_YET_CERTIFIED");
    }
  });
  const hp = await hr.newPage();
  await checkpoint("Scoped HR gets fixed employer label and HCM APIs fail closed", async () => {
    await app(hp, on);
    assert.equal(await hp.getByRole("combobox", { name: "Legal entity switcher" }).count(), 0);
    await hp.getByLabel("Assigned legal employer").waitFor();
    await gotoScreen(hp, "People");
    assert.ok(!(await hp.locator('[data-workspace-page="People"]').innerText()).includes("Beta Synthetic"));
    // The HCM worklist and lifecycle authorization implementation is now
    // deferred to draft #963. In core, ALL such reads must fail closed under
    // multi-entity mode, even for a normally permitted scoped HR identity.
    for (const path of [
      "/api/hcm/people-operations-inbox?organizationId=1",
      "/api/hcm/lifecycle-readiness?organizationId=1",
    ]) {
      const denied = await request(hr, on, path);
      assert.equal(denied.status, 403, "Deferred HCM read must fail closed: " + path);
      assert.equal(denied.data?.code, "ENTITY_HCM_DEFERRED");
      assert.ok(!JSON.stringify(denied.data).includes("Beta Synthetic"),
        "HCM hold must not reveal another employer's data");
    }
    const forgedInbox = await hr.request.get(on + "/api/hcm/people-operations-inbox?organizationId=1", {
      headers: { "x-legal-entity-id": String(employerB.id) }, failOnStatusCode: false,
    });
    assert.equal(forgedInbox.status(), 403, "An entity-scoped HR user cannot guess another employer's inbox");
    const forgedResponse = await forgedInbox.json().catch(() => null);
    assert.equal(forgedResponse?.code, "ENTITY_HCM_DEFERRED");
    await fitPhone(hp);
    await capture(hp, "after-scoped-hr-people");
  }, hp);
  const hrc = await request(hr, on, "/api/multi-entity/context?organizationId=1");
  assert.equal(hrc.status, 200);
  assert.equal(hrc.data.legalEntityId, employerA.id);
  assert.equal(hrc.data.canSwitch, false);
  assert.equal((await request(hr, on, "/api/multi-entity/reports?organizationId=1")).status, 403);

  for (const width of [320, 375, 430]) {
    const ctx = await newSyntheticContext({ viewport: { width, height: 844 } });
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

  // The legacy /app route and all shared member-only APIs must not grant
  // group_hr access when the entire feature is disabled, even if a group_hr
  // membership has already been pre-provisioned for a future rollout.
  const offGroup = await newSyntheticContext();
  await login(offGroup, off, "entity-group@example.test");
  const offGroupApp = await offGroup.newPage();
  const offGroupResponse = await offGroupApp.goto(off + "/app?organizationId=1", {
    waitUntil: "domcontentloaded", timeout: 60000,
  });
  assert.equal(offGroupResponse?.status(), 404, "Flag-OFF group_hr must not open the old company-wide workspace");
  checks.push("Flag-OFF preprovisioned group HR has no legacy workspace access");
  await offGroup.close();

  const disabled = await newSyntheticContext({ viewport: { width: 1440, height: 900 } });
  await login(disabled, off, "entity-owner@example.test");
  const legacyHcm = await request(disabled, off, "/api/hcm/lifecycle-readiness?organizationId=1");
  assert.notEqual(legacyHcm.data?.code, "ENTITY_HCM_DEFERRED",
    "Feature-OFF HCM must not inherit the multi-entity hold");
  assert.equal((await request(disabled, off, "/api/multi-entity/context?organizationId=1")).status, 404);
  const legacyBi = await request(disabled, off, "/api/bi-exports?organizationId=1");
  assert.equal(legacyBi.status, 200, "Feature-OFF legacy BI metadata must retain normal authorization");
  assert.ok(Array.isArray(legacyBi.data?.datasets), "Legacy BI definitions remain available with the feature OFF");
  checks.push("Flag-OFF BI definition discovery preserved");
  const oldPage = await disabled.newPage();
  await checkpoint("Flag OFF has no entity switcher or badge", async () => {
    await app(oldPage, off);
    assert.equal(await oldPage.getByRole("combobox", { name: "Legal entity switcher" }).count(), 0);
    assert.equal(await oldPage.getByLabel("Assigned legal employer").count(), 0);
    assert.equal(await oldPage.locator('[data-nav-name="Entities"]').count(), 0);
    await capture(oldPage, "before-owner-header");
    for (const screen of ["People", "Payroll", "Time & attendance", "Analytics", "Exports"]) {
      await gotoScreen(oldPage, screen);
      if (screen === "Analytics") {
        assert.equal(await oldPage.locator("[data-enterprise-bi-export]").count(), 1,
          "Feature-OFF legacy analytics must retain its BI export panel");
      }
      await capture(oldPage, "before-owner-" + screen);
    }
    await gotoScreen(oldPage, "Payroll");
    await oldPage.getByRole("button", { name: /New payroll|Start another payroll|Create payroll/i }).first().click();
    const legacy = oldPage.getByRole("dialog", { name: "Create payroll draft" });
    await legacy.waitFor();
    assert.equal(await legacy.getByLabel("Type legal employer name").count(), 0);
    await capture(oldPage, "before-payroll-start");
    await legacy.getByRole("button", { name: "Cancel" }).click();
  }, oldPage);

  const mobileOff = await newSyntheticContext({ viewport: { width: 390, height: 844 } });
  await login(mobileOff, off, "entity-hr@example.test");
  const beforeMobile = await mobileOff.newPage();
  await checkpoint("Phone flag OFF remains legacy", async () => {
    await app(beforeMobile, off);
    await gotoScreen(beforeMobile, "People");
    // The historic flag-OFF People UI already overflows at phone width.
    // Preserve its screenshot and width as an explicit baseline rather than
    // claiming the flag-on CSS cured that unrelated legacy layout.
    const legacy = await beforeMobile.evaluate(() => ({
      viewport: window.innerWidth, documentWidth: document.documentElement.scrollWidth,
    }));
    assert.equal(legacy.viewport, 390);
    if (legacy.documentWidth > legacy.viewport + 1) {
      checks.push("Existing flag-OFF People overflow recorded as legacy layout debt");
    }
    assert.equal(await beforeMobile.getByLabel("Assigned legal employer").count(), 0);
    await capture(beforeMobile, "before-scoped-hr-people");
  }, beforeMobile);


  // #1361: exercise the *actual* close GET/POST with production-mode sessions
  // and two legal employers under one tenant, not just two separate tenants.
  // No accounting close can succeed on these intentionally Draft fixture runs.
  const closeOwner = await newSyntheticContext();
  await login(closeOwner, on, "entity-owner@example.test");
  const alphaList = await request(closeOwner, on,
    "/api/payroll-runs?organizationId=1&legalEntityId=1");
  const betaList = await request(closeOwner, on,
    "/api/payroll-runs?organizationId=1&legalEntityId=2");
  assert.equal(alphaList.status, 200);
  assert.equal(betaList.status, 200);
  const alphaRun = alphaList.data?.runs?.find(r => r.legalEntityId === 1);
  const betaRun = betaList.data?.runs?.find(r => r.legalEntityId === 2);
  assert.ok(alphaRun?.id && betaRun?.id && alphaRun.id !== betaRun.id,
    "Both legal employers must have separately persisted fictional payroll runs");
  const alphaClose = await request(closeOwner, on,
    "/api/payroll-runs/" + alphaRun.id + "/close?legalEntityId=1");
  assert.equal(alphaClose.status, 200, "Selected Alpha employer must read its own close state");
  assert.equal(alphaClose.data?.run?.id, alphaRun.id);
  const selectedBetaClose = await request(closeOwner, on,
    "/api/payroll-runs/" + betaRun.id + "/close?legalEntityId=2");
  assert.equal(selectedBetaClose.status, 200, "Explicitly selected Beta employer must retain its own close read");
  assert.equal(selectedBetaClose.data?.run?.id, betaRun.id);
  const deniedBetaRead = await request(closeOwner, on,
    "/api/payroll-runs/" + betaRun.id + "/close?legalEntityId=1");
  assert.equal(deniedBetaRead.status, 403,
    "A grant to both employers does not allow reading unselected Beta evidence");
  assert.equal(deniedBetaRead.data?.code, "ENTITY_ACCESS_DENIED");
  const deniedBetaWrite = await request(closeOwner, on,
    "/api/payroll-runs/" + betaRun.id + "/close?legalEntityId=1",
    "POST", { confirmed: true, acknowledgeFilingEvidenceGaps: true });
  assert.equal(deniedBetaWrite.status, 403,
    "A selected Alpha owner must not POST a close action for Beta");
  assert.equal(deniedBetaWrite.data?.code, "ENTITY_ACCESS_DENIED");
  const allowedDraftWrite = await request(closeOwner, on,
    "/api/payroll-runs/" + alphaRun.id + "/close?legalEntityId=1",
    "POST", { confirmed: true, acknowledgeFilingEvidenceGaps: true });
  assert.equal(allowedDraftWrite.status, 409,
    "Authorized but not released Draft must remain blocked from close; no manufactured payout");
  const unselectedBetaRead = await request(closeOwner, on,
    "/api/payroll-runs/" + betaRun.id + "/close?legalEntityId=1&organizationId=2");
  assert.equal(unselectedBetaRead.status, 403,
    "Forging a different organization in query must not override the selected employer");
  await closeOwner.close();
  const closeNoGrant = await newSyntheticContext();
  await login(closeNoGrant, on, "entity-nogrant@example.test");
  const deniedWithoutGrant = await request(closeNoGrant, on,
    "/api/payroll-runs/" + alphaRun.id + "/close?legalEntityId=1");
  assert.equal(deniedWithoutGrant.status, 403);
  assert.equal(deniedWithoutGrant.data?.code, "ENTITY_ACCESS_DENIED");
  await closeNoGrant.close();
  const offClose = await request(disabled, off,
    "/api/payroll-runs/" + betaRun.id + "/close");
  assert.equal(offClose.status, 200, "Feature-OFF tenant role must keep its existing payroll-close read");
  checks.push("Payroll-close employer A/B selected grants: owned read, foreign GET/POST denied, Draft blocked, flag-OFF parity");

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
