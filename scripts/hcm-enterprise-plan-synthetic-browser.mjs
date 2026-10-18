import assert from "node:assert/strict";
import { chromium } from "playwright";
import pg from "pg";

/** Synthetic-only direct-route enforcement browser QA on a separate localhost instance. */
const url = "http://127.0.0.1:3002";
const env = process.env;
assert.equal(env.CI, "true");
assert.equal(env.HCM_MONITOR_ACCEPTANCE_MODE, "synthetic-postgres-only");
assert.equal(env.HCM_ENTERPRISE_PLAN_GATE_ENABLED, "true");
assert.equal(env.HCM_ENTERPRISE_PLAN_GATE_ORG_IDS, "1,2");
assert.equal(env.OPENAI_API_KEY ?? "", "");
const database = new URL(env.DATABASE_URL ?? "");
assert.ok(["localhost", "127.0.0.1"].includes(database.hostname));
assert.equal(database.pathname, "/app_db");

const browser = await chromium.launch({ headless: true });
const receipts = [];
async function login(context, email, baseUrl = url) {
  const response = await context.request.post(baseUrl + "/api/auth/login", {
    headers: {
      origin: baseUrl, "sec-fetch-site": "same-origin", "content-type": "application/json",
    },
    data: { email, password: "Synthetic-HCM-Monitor-Only-2026!" },
    failOnStatusCode: false,
  });
  assert.equal(response.status(), 200, "Fictional login failed: " + email);
}
async function read(page, path) {
  return page.evaluate(async (path) => {
    const r = await fetch(path, { credentials: "same-origin", cache: "no-store" });
    return {
      status: r.status,
      headers: r.headers.get("cache-control"),
      body: await r.json().catch(() => null),
    };
  }, path);
}
async function write(page, path, payload) {
  // Real same-origin session, not Playwright's detached cookie jar.
  return page.evaluate(async ({ path, payload }) => {
    const response = await fetch(path, {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return {
      status: response.status,
      headers: response.headers.get("cache-control"),
      body: await response.json().catch(() => null),
    };
  }, { path, payload });
}

async function open(page, path) {
  const result = await page.goto(url + path, { waitUntil: "domcontentloaded", timeout: 60000 });
  return result?.status();
}

try {
  const hr = await browser.newContext();
  await login(hr, "monitor-hr@example.test");
  const page = await hr.newPage();

  // No inferred account-type upgrade: company A has a recorded paid Enterprise
  // subscription and company B a recorded paid Core subscription.
  assert.equal(await open(page, "/hcm/process-monitor?organizationId=1"), 200);
  for (const path of [
    "/api/hcm/process-monitor?organizationId=1",
    "/api/hcm/org-explorer?organizationId=1",
  ]) {
    const response = await read(page, path);
    assert.equal(response.status, 200, "Enterprise HR source must remain available: " + path);
    assert.equal(response.body.tenantId, 1);
    assert.ok(response.headers?.includes("no-store"));
  }
  assert.equal(await open(page, "/hcm/org-explorer?organizationId=1"), 200);
  const permittedHistory = await read(page,
    "/api/hcm/position-history?organizationId=1&positionId=9999");
  assert.equal(permittedHistory.status, 404,
    "Authorized Enterprise HR must reach the source's own position-not-found check");
  assert.equal(permittedHistory.body?.error, "Position not found in this employer.");
  assert.equal(await open(page, "/hcm/command-center?organizationId=1"), 200);
  assert.equal(await page.locator("summary").filter({ hasText: "Advanced HCM tools" }).count(), 1,
    "Entitled Enterprise HR must discover the collapsed advanced section");
  assert.equal(await open(page, "/hcm/command-center?organizationId=2"), 200);
  assert.equal(await page.locator("summary").filter({ hasText: "Advanced HCM tools" }).count(), 0,
    "Core HR must not discover advanced paid routes");
  const defsEnterprise = await read(page,
    "/api/hcm/business-processes/definitions?organizationId=1");
  assert.equal(defsEnterprise.status, 200,
    "Active Enterprise HR can inspect versioned workflow definitions");
  assert.ok(Array.isArray(defsEnterprise.body?.definitions));
  const invalidEnterpriseWrite = await write(page,
    "/api/hcm/business-processes/definitions",
    { organizationId: 1, action: "unsupported-synthetic-qa" });
  assert.equal(invalidEnterpriseWrite.status, 400,
    "Enterprise role passes paid gate and reaches action validation, without writes");
  receipts.push("Active Enterprise HR may inspect definitions; invalid write never mutates");

  receipts.push("Active Enterprise HR sees advanced navigation; Core HR does not");

  // #850 real localhost server/browser assertions: two actual paid plans,
  // one HR operator who belongs to both fictional employers, no mutations.
  for (const endpoint of [
    "/api/workforce-planning",
    "/api/workforce-planning/allocations",
    "/api/workforce-planning/baselines",
    "/api/workforce-planning/scenarios",
    "/api/workforce-planning/position-executions",
  ]) {
    const enterprise = await read(page, endpoint + "?organizationId=1");
    assert.equal(enterprise.status, 200, "Enterprise HR must read " + endpoint);
    const core = await read(page, endpoint + "?organizationId=2");
    assert.equal(core.status, 402, "Core HR direct API bypass must be denied " + endpoint);
    assert.equal(core.body?.code, "ENTERPRISE_ADVANCED_PLAN_REQUIRED");
    assert.ok(core.headers?.includes("no-store"), "Private denial required for " + endpoint);
  }
  // Real browser session switches between employers with the SAME employee
  // number. Employee IDs differ, and neither source may leak the other's row.
  const planAlpha = await read(page, "/api/workforce-planning?organizationId=1");
  assert.deepEqual(planAlpha.body?.employees?.map((employee) => employee.firstName),
    ["Fictional"], "Enterprise Planning must return ONLY employer A's worker");
  assert.ok(!JSON.stringify(planAlpha.body).includes("TenantBetaOnly"));
  const compBeta = await read(page, "/api/compensation?organizationId=2");
  assert.deepEqual(compBeta.body?.employees?.map((employee) => employee.firstName),
    ["TenantBetaOnly"], "Core compensation must return ONLY employer B's worker");
  assert.ok(!JSON.stringify(compBeta.body).includes('"firstName":"Fictional"'));
  const compAlpha = await read(page, "/api/compensation?organizationId=1");
  assert.deepEqual(compAlpha.body?.employees?.map((employee) => employee.firstName),
    ["Fictional"], "Enterprise compensation must retain employer A only");
  assert.ok(!JSON.stringify(compAlpha.body).includes("TenantBetaOnly"));
  receipts.push("Same employee number across employers: Planning/Compensation browser switching never crosses tenant");

  const advancedPlanning = await write(page, "/api/workforce-planning",
    { organizationId: 1, entityType: "plan" });
  assert.equal(advancedPlanning.status, 400, "Paid planning must reach ordinary input validation");
  const corePlanning = await write(page, "/api/workforce-planning",
    { organizationId: 2, entityType: "plan" });
  assert.equal(corePlanning.status, 402, "Core planning cannot bypass subscription with a POST");
  const baselineCore = await write(page, "/api/workforce-planning/position-executions",
    { organizationId: 2, planId: 1 });
  assert.equal(baselineCore.status, 402,
    "Published plan execution preview is not an Enterprise-free direct POST");

  const compEnterprise = await read(page, "/api/compensation?organizationId=1");
  assert.equal(compEnterprise.status, 200);
  assert.equal(compEnterprise.body?.advancedConfigurationAllowed, true);
  const compCore = await read(page, "/api/compensation?organizationId=2");
  assert.equal(compCore.status, 200,
    "Core must retain authorized worker pay/proposal evidence");
  assert.equal(compCore.body?.advancedConfigurationAllowed, false);
  const compNewBand = await write(page, "/api/compensation",
    { organizationId: 2, entityType: "band" });
  assert.equal(compNewBand.status, 402, "Core cannot create salary bands from direct API");
  const compPaidCycle = await write(page, "/api/compensation",
    { organizationId: 1, entityType: "cycle" });
  assert.equal(compPaidCycle.status, 400,
    "Enterprise can reach salary cycle validation without creating bad records");
  const coreExistingPay = await write(page, "/api/compensation",
    { organizationId: 2, entityType: "component_assignment" });
  assert.equal(coreExistingPay.status, 400,
    "Subscription cannot block already-governed worker compensation validation");
  receipts.push("Advanced Planning/Compensation direct APIs enforce Enterprise; Core assigned pay intact");


  // These are advanced READ surfaces, not the employee's everyday ESS view.
  assert.equal(await open(page, "/hcm/action-center?organizationId=1"), 200,
    "Company-wide Enterprise HR can open advanced HCM Action Center");
  assert.equal(await open(page, "/hcm/worker-360?organizationId=1&employeeId=1"), 200,
    "Company-wide Enterprise HR can open historical Worker 360");
  const worker = await read(page, "/api/hcm/worker-360?organizationId=1&employeeId=1");
  assert.equal(worker.status, 200, "Enterprise HR can read authorized historical worker");
  assert.equal(worker.body?.tenantId, 1);
  assert.equal(worker.body?.employeeId, 1);
  assert.ok(worker.headers?.includes("no-store"));
  const enterpriseInbox = await read(page,
    "/api/hcm/business-processes/inbox?organizationId=1");
  assert.equal(enterpriseInbox.status, 200);
  assert.equal(enterpriseInbox.body?.meta?.companyHistoryAvailable, true,
    "Enrolled Enterprise HR may view company-wide process history");
  receipts.push("Enterprise HR can open advanced Action Center and Worker 360 views");

  for (const suffix of ["process-monitor", "org-explorer"]) {
    const api = await read(page, "/api/hcm/" + suffix + "?organizationId=2");
    assert.equal(api.status, 402, "Core company must not read " + suffix);
    assert.equal(api.body?.code, "HCM_ENTERPRISE_PLAN_REQUIRED");
    assert.ok(api.headers?.includes("no-store"));
    assert.ok(!JSON.stringify(api.body).includes("BetaPrivate"));
    assert.equal(await open(page, "/hcm/" + suffix + "?organizationId=2"), 404);
  }
  const coreHistory = await read(page,
    "/api/hcm/position-history?organizationId=2&positionId=9999");
  assert.equal(coreHistory.status, 402,
    "Core HR cannot bypass the org explorer paywall through position history");
  assert.equal(coreHistory.body?.code, "HCM_ENTERPRISE_PLAN_REQUIRED");
  assert.ok(coreHistory.headers?.includes("no-store"));
  const coreDefinitions = await read(page,
    "/api/hcm/business-processes/definitions?organizationId=2");
  assert.equal(coreDefinitions.status, 402,
    "Core HR cannot directly read advanced workflow definitions");
  assert.equal(coreDefinitions.body?.code, "HCM_ENTERPRISE_PLAN_REQUIRED");
  assert.ok(coreDefinitions.headers?.includes("no-store"));
  const coreInvalidWrite = await write(page,
    "/api/hcm/business-processes/definitions",
    { organizationId: 2, action: "unsupported-synthetic-qa" });
  assert.equal(coreInvalidWrite.status, 402,
    "Core HR must fail plan gate before any create/enable/disable action");
  assert.equal(coreInvalidWrite.body?.code, "HCM_ENTERPRISE_PLAN_REQUIRED");
  receipts.push("Core HR denied direct workflow definition reads and writes");

  for (const path of [
    "/hcm/action-center?organizationId=2",
    "/hcm/worker-360?organizationId=2&employeeId=1",
  ]) {
    assert.equal(await open(page, path), 404,
      "Core employer cannot open advanced HCM page: " + path);
  }
  const coreWorker = await read(page,
    "/api/hcm/worker-360?organizationId=2&employeeId=1");
  assert.equal(coreWorker.status, 402,
    "Core HR cannot bypass the Worker 360 paywall using the direct JSON API");
  assert.equal(coreWorker.body?.code, "HCM_ENTERPRISE_PLAN_REQUIRED");
  assert.ok(coreWorker.headers?.includes("no-store"));
  // A shared source API is intentionally NOT part of the paid advanced-view
  // gate; assigned inbox actions remain available to ordinary HR roles.
  const coreInbox = await read(page,
    "/api/hcm/business-processes/inbox?organizationId=2");
  assert.equal(coreInbox.status, 200,
    "Core HR must retain source-governed assigned HCM inbox access");
  assert.ok(coreInbox.headers?.includes("no-store"));
  assert.equal(coreInbox.body?.meta?.companyHistoryAvailable, false,
    "Core HR must not receive the Enterprise-only company-wide history projection");
  assert.deepEqual(coreInbox.body?.recent, coreInbox.body?.submitted,
    "Core recent history may include only the actor's own source-governed submissions");
  receipts.push("Core HR denied advanced views but retains assigned HCM inbox access");

  const manager = await browser.newContext();
  await login(manager, "monitor-manager@example.test");
  const managerPage = await manager.newPage();
  await open(managerPage, "/hcm/process-monitor?organizationId=1");
  for (const suffix of ["process-monitor", "org-explorer"]) {
    const api = await read(managerPage, "/api/hcm/" + suffix + "?organizationId=1");
    assert.equal(api.status, 403, "Unauthorized manager must fail before billing: " + suffix);
    assert.ok(!JSON.stringify(api.body).includes("HCM_ENTERPRISE_PLAN_REQUIRED"));
    assert.equal(await open(managerPage, "/hcm/" + suffix + "?organizationId=1"), 404);
  }
  const managerHistory = await read(managerPage,
    "/api/hcm/position-history?organizationId=1&positionId=9999");
  assert.equal(managerHistory.status, 403,
    "Manager position-history access must fail before billing");
  const managerDefinitions = await read(managerPage,
    "/api/hcm/business-processes/definitions?organizationId=1");
  assert.equal(managerDefinitions.status, 403,
    "Manager cannot inspect Enterprise workflow designer definitions");
  const managerWrite = await write(managerPage,
    "/api/hcm/business-processes/definitions",
    { organizationId: 1, action: "unsupported-synthetic-qa" });
  assert.equal(managerWrite.status, 403,
    "Manager cannot buy their way past workflow admin authorization");
  for (const path of [
    "/hcm/action-center?organizationId=1",
    "/hcm/worker-360?organizationId=1&employeeId=1",
  ]) {
    assert.equal(await open(managerPage, path), 404,
      "A manager cannot acquire HR history access through a paid employer");
  }
  const managerWorker = await read(managerPage,
    "/api/hcm/worker-360?organizationId=1&employeeId=1");
  assert.equal(managerWorker.status, 403, "Manager must fail before the plan gate");
  assert.ok(!JSON.stringify(managerWorker.body).includes("HCM_ENTERPRISE_PLAN_REQUIRED"));
  // The same rejected manager must also fail paid #850 APIs BEFORE billing,
  // including when attempting another employer with no membership.
  for (const employer of [1, 2]) {
    const deniedPlanning = await read(managerPage,
      "/api/workforce-planning?organizationId=" + employer);
    assert.equal(deniedPlanning.status, 403);
    assert.notEqual(deniedPlanning.body?.code, "ENTERPRISE_ADVANCED_PLAN_REQUIRED");
  }
  assert.equal((await write(managerPage, "/api/workforce-planning",
    { organizationId: 1, entityType: "plan" })).status, 403);
  assert.equal((await read(managerPage, "/api/compensation?organizationId=1")).status, 403);
  assert.equal((await write(managerPage, "/api/compensation",
    { organizationId: 1, entityType: "band" })).status, 403);
  receipts.push("Unprivileged manager cannot buy their way past existing roles or #850 APIs");
  await manager.close();

  const bookkeeper = await browser.newContext();
  await login(bookkeeper, "monitor-bookkeeper@example.test");
  const bookkeeperPage = await bookkeeper.newPage();
  await bookkeeperPage.goto(url + "/login", { waitUntil: "domcontentloaded" });
  const bookkeeperDefinitions = await read(bookkeeperPage,
    "/api/hcm/business-processes/definitions?organizationId=1");
  assert.equal(bookkeeperDefinitions.status, 403,
    "Enterprise subscription never grants a bookkeeper workflow designer privileges");
  const bookkeeperWrite = await write(bookkeeperPage,
    "/api/hcm/business-processes/definitions",
    { organizationId: 1, action: "unsupported-synthetic-qa" });
  assert.equal(bookkeeperWrite.status, 403,
    "Enrolled bookkeeper cannot revise source approver rules");
  await bookkeeper.close();
  receipts.push("Bookkeeper is denied Enterprise workflow design even in a paid employer");

  const deniedHr = await browser.newContext();
  await login(deniedHr, "monitor-denied-hr@example.test");
  const deniedPage = await deniedHr.newPage();
  await deniedPage.goto(url + "/login", { waitUntil: "domcontentloaded" });
  const deniedPlanning = await read(deniedPage, "/api/workforce-planning?organizationId=1");
  assert.equal(deniedPlanning.status, 403, "Custom-denied HR cannot read paid Planning");
  assert.equal(deniedPlanning.body?.permission, "workforce.manage");
  assert.equal((await write(deniedPage, "/api/workforce-planning",
    { organizationId: 1, entityType: "plan" })).status, 403);
  const deniedComp = await read(deniedPage, "/api/compensation?organizationId=1");
  assert.equal(deniedComp.status, 403, "Custom-denied HR cannot read pay under a premium plan");
  assert.equal(deniedComp.body?.permission, "people.admin");
  const deniedCompWrite = await write(deniedPage, "/api/compensation",
    { organizationId: 1, entityType: "band" });
  assert.equal(deniedCompWrite.status, 403, "Direct compensation POST must honor deny-only roles");
  assert.equal(deniedCompWrite.body?.permission, "people.admin");
  await deniedHr.close();
  receipts.push("Custom-denied HR fails Planning and Compensation GET/POST before billing");

  // A second independently started, flag-OFF runtime must preserve the
  // ordinary Core employer's pre-existing access without Enterprise lookup.
  const offUrl = "http://127.0.0.1:3000";
  const flagOff = await browser.newContext();
  await login(flagOff, "monitor-hr@example.test", offUrl);
  const offPage = await flagOff.newPage();
  await offPage.goto(offUrl + "/login", { waitUntil: "domcontentloaded" });
  const offPlanning = await read(offPage, "/api/workforce-planning?organizationId=2");
  assert.equal(offPlanning.status, 200, "Default-OFF Core Planning must be unchanged");
  assert.deepEqual(offPlanning.body?.employees?.map((employee) => employee.firstName),
    ["TenantBetaOnly"]);
  const offComp = await read(offPage, "/api/compensation?organizationId=2");
  assert.equal(offComp.status, 200, "Default-OFF Core compensation must be unchanged");
  assert.equal(offComp.body?.advancedConfigurationAllowed, true);
  assert.equal((await write(offPage, "/api/workforce-planning",
    { organizationId: 2, entityType: "plan" })).status, 400,
    "Default-OFF source validation must run instead of premium check");
  assert.equal((await write(offPage, "/api/compensation",
    { organizationId: 2, entityType: "band" })).status, 400);
  await flagOff.close();
  receipts.push("Independent flag-OFF browser runtime retains Core Planning and Compensation");

  const unauthenticated = await browser.newContext();
  const anonymousPage = await unauthenticated.newPage();
  await anonymousPage.goto(url + "/login", { waitUntil: "domcontentloaded" });
  for (const suffix of ["process-monitor", "org-explorer"]) {
    const api = await read(anonymousPage, "/api/hcm/" + suffix + "?organizationId=1");
    assert.equal(api.status, 401, "Unauthenticated request must fail first");
  }
  const anonymousHistory = await read(anonymousPage,
    "/api/hcm/position-history?organizationId=1&positionId=9999");
  assert.equal(anonymousHistory.status, 401,
    "Anonymous position-history must fail before billing");
  const anonDefinitions = await read(anonymousPage,
    "/api/hcm/business-processes/definitions?organizationId=1");
  assert.equal(anonDefinitions.status, 401,
    "Anonymous workflow designer GET must reject before billing");
  const anonymousWorker = await read(anonymousPage,
    "/api/hcm/worker-360?organizationId=1&employeeId=1");
  assert.equal(anonymousWorker.status, 401,
    "Anonymous Worker 360 API request must fail before billing");
  await unauthenticated.close();
  receipts.push("Unauthenticated requests denied before billing");

  // Keep the SAME authenticated Chromium session while role and subscription
  // records change underneath it. No mocked handlers or detached HTTP client.
  // Synthetic disposable PostgreSQL only; every mutation is restored.
  const pool = new pg.Pool({ connectionString: env.DATABASE_URL, max: 1 });
  try {
    const membership = await pool.query(
      `SELECT uo.role FROM user_organizations uo
       JOIN users u ON u.id = uo.user_id
       WHERE u.email = $1 AND uo.organization_id = 1`,
      ["monitor-hr@example.test"],
    );
    assert.equal(membership.rows.length, 1);
    assert.equal(membership.rows[0].role, "hr");
    let changedRole = false;
    try {
      const updated = await pool.query(
        `UPDATE user_organizations SET role = 'employee'
         WHERE organization_id = 1 AND role = 'hr'
           AND user_id = (SELECT id FROM users WHERE email = $1)
         RETURNING id`,
        ["monitor-hr@example.test"],
      );
      assert.equal(updated.rowCount, 1);
      changedRole = true;
      const deniedPlan = await read(page, "/api/workforce-planning?organizationId=1");
      assert.equal(deniedPlan.status, 403, "Live HR-to-employee downgrade must revoke Planning");
      assert.equal((await write(page, "/api/workforce-planning",
        { organizationId: 1, entityType: "plan" })).status, 403);
      assert.equal((await read(page, "/api/compensation?organizationId=1")).status, 403);
      assert.equal((await write(page, "/api/compensation",
        { organizationId: 1, entityType: "band" })).status, 403);
      const stillHrBeta = await read(page, "/api/compensation?organizationId=2");
      assert.equal(stillHrBeta.status, 200,
        "Downgrade in employer A cannot revoke independent employer B membership");
      assert.equal(stillHrBeta.body?.advancedConfigurationAllowed, false);
    } finally {
      if (changedRole) {
        const restored = await pool.query(
          `UPDATE user_organizations SET role = 'hr'
           WHERE organization_id = 1 AND role = 'employee'
             AND user_id = (SELECT id FROM users WHERE email = $1)
           RETURNING id`,
          ["monitor-hr@example.test"],
        );
        assert.equal(restored.rowCount, 1, "Restore original fictional HR role");
      }
    }
    assert.equal((await read(page, "/api/workforce-planning?organizationId=1")).status, 200);
    receipts.push("Live same-session role downgrade revokes Planning/Compensation; other employer remains independent");

    let changedSubscription = false;
    try {
      const updated = await pool.query(
        `UPDATE subscriptions SET status = 'past_due'
         WHERE organization_id = 1 AND status = 'active'
         RETURNING id`,
      );
      assert.equal(updated.rowCount, 1);
      changedSubscription = true;
      const deniedPlan = await read(page, "/api/workforce-planning?organizationId=1");
      assert.equal(deniedPlan.status, 402, "Enterprise status must be checked on each request");
      assert.equal(deniedPlan.body?.code, "ENTERPRISE_ADVANCED_PLAN_REQUIRED");
      const unchangedPay = await read(page, "/api/compensation?organizationId=1");
      assert.equal(unchangedPay.status, 200, "Core pay evidence remains available when billing lapses");
      assert.equal(unchangedPay.body?.advancedConfigurationAllowed, false);
      assert.equal((await write(page, "/api/compensation",
        { organizationId: 1, entityType: "band" })).status, 402);
    } finally {
      if (changedSubscription) {
        const restored = await pool.query(
          `UPDATE subscriptions SET status = 'active'
           WHERE organization_id = 1 AND status = 'past_due'
           RETURNING id`,
        );
        assert.equal(restored.rowCount, 1, "Restore fictional Enterprise subscription");
      }
    }
    assert.equal((await read(page, "/api/workforce-planning?organizationId=1")).status, 200);
    receipts.push("Live subscription lapse denies premium API but preserves existing worker pay reads");
  } finally {
    await pool.end();
  }
  console.log(JSON.stringify({
    status: "PASS", syntheticOnly: true, directApiAndPageGate: true,
    configuredEmployers: [1, 2], receipts, liveEmployerDataAccessed: false,
    productionCertified: false, payrollReleased: false,
  }));
  await hr.close();
} finally {
  await browser.close();
}
