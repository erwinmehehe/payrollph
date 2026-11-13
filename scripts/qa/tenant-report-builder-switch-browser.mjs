/**
 * Genuine Chromium Report Builder A -> B -> A browser isolation.
 * Fictional PG16, same multi-employer session, zero new credits.
 * Never imports application, DB or Playwright before disposable guards.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { REPORT_PAGE_ORIGIN, requireDisposableReportPageEnv } from "./tenant-report-builder-page-contract.mjs";
import { verifyExportSourcePins } from "./tenant-report-builder-export-contract.mjs";

const ORIGIN = REPORT_PAGE_ORIGIN;
const PAGE = "/workspace/report-builder?organizationId=";
const readBody = async download => {
  const stream = await download.createReadStream();
  assert.ok(stream, "Real browser download stream required");
  const parts = [];
  for await (const chunk of stream) parts.push(Buffer.from(chunk));
  return Buffer.concat(parts).toString("utf8");
};

export async function proveReportBuilderSwitchBrowser() {
  requireDisposableReportPageEnv();
  verifyExportSourcePins();
  const [{ db, pool }, s, { and, asc, eq }, fixture, browserLib] = await Promise.all([
    import("../../src/db/index.ts"), import("../../src/db/schema.ts"),
    import("drizzle-orm"), import("./tenant-table-http.mjs"), import("playwright"),
  ]);
  let browser;
  try {
    const version = Number((await pool.query("SHOW server_version_num")).rows[0].server_version_num);
    assert.ok(version >= 160000 && version < 170000, "PostgreSQL 16 required");
    const nonce = randomUUID().replaceAll("-", "").slice(0, 10);
    for (let i = 0; i < 7; i++) {
      await fixture.seedEmployer("BROWSER-FILL" + i, nonce, fixture.standaloneMakeSession);
    }
    const a = await fixture.seedEmployer("BR-A", nonce, fixture.standaloneMakeSession);
    const b = await fixture.seedEmployer("BR-B", nonce, fixture.standaloneMakeSession);
    const victim = await fixture.seedEmployer("BR-VICTIM", nonce, fixture.standaloneMakeSession);
    assert.ok(victim.org.id > Math.max(a.org.id, b.org.id, 6));
    assert.ok(victim.worker.id > Math.max(a.worker.id, b.worker.id, 6));
    const [switcher] = await db.insert(s.users).values({
      email: "report-switch-" + nonce + "@example.invalid", name: "Fictional A B operator",
      passwordHash: "fictional-session-only", role: "owner", totpEnabled: true,
    }).returning({ id: s.users.id });
    await db.insert(s.userOrganizations).values([
      { userId: switcher.id, organizationId: a.org.id, role: "owner", active: true },
      { userId: switcher.id, organizationId: b.org.id, role: "owner", active: true },
    ]);
    const session = await fixture.standaloneMakeSession(switcher.id);
    await db.update(s.sessions).set({ mfaVerifiedAt: new Date() })
      .where(eq(s.sessions.id, session.id));

    const tables = ["organizations", "legalEntities", "orgUnits", "employees",
      "employeePayProfiles", "payrollRuns", "userOrganizations", "auditEvents"];
    async function snapshot(orgId) {
      const entries = {};
      for (const tableName of tables) {
        const table = s[tableName];
        const condition = tableName === "organizations" ? eq(table.id, orgId)
          : eq(table.organizationId, orgId);
        entries[tableName] = JSON.parse(JSON.stringify(await db.select().from(table)
          .where(condition).orderBy(asc(table.id))));
      }
      return entries;
    }
    const baseline = new Map(await Promise.all([a, b, victim]
      .map(async org => [org.org.id, await snapshot(org.org.id)])));

    browser = await browserLib.chromium.launch({ headless: true });
    const context = await browser.newContext({
      acceptDownloads: true, viewport: { width: 1100, height: 820 },
    });
    await context.route("**/*", route => {
      const requested = new URL(route.request().url());
      return requested.origin === ORIGIN ? route.continue() : route.abort();
    });
    const cookie = session.cookie.split("=");
    assert.equal(cookie[0], "__Host-linaw_session");
    await context.addCookies([{
      name: cookie[0], value: cookie.slice(1).join("="), url: ORIGIN,
      secure: true, httpOnly: true, sameSite: "Lax",
    }]);
    const account = await context.request.get(ORIGIN + "/api/account");
    assert.equal(account.status(), 200, "Real authenticated browser session required");
    assert.equal((await account.json()).profile?.id, switcher.id);

    const page = await context.newPage();
    const goto = async org => {
      const response = await page.goto(ORIGIN + PAGE + org.org.id, {
        waitUntil: "domcontentloaded", timeout: 60000,
      });
      assert.equal(response?.status(), 200, "Authorized employer page must render");
      await page.getByRole("heading", { name: "Custom reports" }).waitFor();
      await page.getByRole("button", { name: "Preview" }).waitFor({ state: "visible" });
      await page.waitForFunction(() => {
        const button = [...document.querySelectorAll("button")].find(el => el.textContent === "Preview");
        return Boolean(button && !button.disabled);
      }, undefined, { timeout: 60000 });
      assert.ok((await page.locator("body").innerText()).includes(org.org.name));
    };
    const preview = async (org, others) => {
      await page.getByRole("button", { name: "Preview" }).click();
      const table = page.locator("table tbody");
      await table.waitFor({ timeout: 60000 });
      const text = await table.innerText();
      assert.ok(text.includes(org.unit.code), "Hydrated preview must contain own persisted unit");
      for (const other of others) {
        assert.ok(!text.includes(other.unit.code), "Foreign/stale unit leaked into preview");
      }
      assert.equal(await page.getByRole("button", { name: "Export CSV" }).isEnabled(), true);
    };
    await goto(a);
    await preview(a, [b, victim]);

    // The same legitimate operator can belong to A and B. That is the hard
    // stale-response case: browser authorization alone cannot distinguish
    // which employer owns an old in-flight response.
    let deferA = false;
    let acknowledgeHeld;
    let releaseHeld;
    const responseHeld = new Promise(resolve => { acknowledgeHeld = resolve; });
    const waitForRelease = new Promise(resolve => { releaseHeld = resolve; });
    await page.route("**/api/reports/builder", async route => {
      let data = null;
      try { data = route.request().postDataJSON(); } catch { /* GET has no body */ }
      if (deferA && route.request().method() === "POST"
          && data?.format === "json" && data?.organizationId === a.org.id) {
        deferA = false;
        const realResponse = await route.fetch();
        assert.equal(realResponse.status(), 200, "Delayed A response must be genuinely authorized");
        acknowledgeHeld();
        await waitForRelease;
        try { await route.fulfill({ response: realResponse }); } catch (cause) {
          // Full navigation is expected to cancel the old A request.
          if (!/closed|cancell?ed|abort|navigation|intercept/i.test(String(cause))) throw cause;
        }
      } else {
        await route.continue();
      }
    });
    deferA = true;
    await page.getByRole("button", { name: "Preview" }).click();
    await Promise.race([
      responseHeld,
      new Promise((_, reject) => setTimeout(() => reject(Error("Real A response was not intercepted")), 30000)),
    ]);
    await goto(b);
    assert.equal(await page.getByRole("button", { name: "Export CSV" }).isDisabled(), true,
      "Previous A preview must not authorize B CSV");
    assert.ok(!(await page.locator("body").innerText()).includes(a.unit.code),
      "Previous A preview must not appear under B");
    releaseHeld();
    await preview(b, [a, victim]);
    const waitForDownload = page.waitForEvent("download", { timeout: 60000 });
    await page.getByRole("button", { name: "Export CSV" }).click();
    const downloaded = await waitForDownload;
    assert.equal(downloaded.suggestedFilename(), "linaw-tenant-report.csv");
    const csv = await readBody(downloaded);
    assert.ok(csv.includes(b.unit.code), "B CSV must contain B's real persisted unit");
    assert.ok(!csv.includes(a.unit.code) && !csv.includes(victim.unit.code),
      "Browser CSV leaked another employer");
    await goto(a);
    assert.equal(await page.getByRole("button", { name: "Export CSV" }).isDisabled(), true,
      "Old A preview must not return when A is revisited");
    await preview(a, [b, victim]);

    const denied = await context.request.get(ORIGIN + PAGE + victim.org.id, {
      failOnStatusCode: false,
    });
    assert.equal(denied.status(), 404, "Same browser may not visit victim employer");
    assert.ok(!(await denied.text()).includes(victim.marker));
    for (const subject of [a, b, victim]) {
      const after = await snapshot(subject.org.id);
      const before = baseline.get(subject.org.id);
      for (const table of tables) {
        if (table === "auditEvents" && subject.org.id === b.org.id) {
          assert.equal(after[table].length, before[table].length + 1,
            "One genuinely downloaded B CSV must create exactly one audit");
          assert.equal(after[table].at(-1).action, "Tenant report builder CSV exported");
          assert.equal(after[table].at(-1).organizationId, b.org.id);
        } else {
          assert.deepEqual(after[table], before[table],
            "Browser A-B-A must not mutate protected employer data: " + table);
        }
      }
    }
    console.log("REPORT_BUILDER_ABA_BROWSER_COMPLETE " + JSON.stringify({
      fictionalEmployers: 10, sameSessionTwoAuthorizedEmployers: true,
      authorizedNonemptyPreviews: 3, realBrowserCsvDownload: true,
      delayedRealResponseHeldAcrossEmployerSwitch: true, staleAResponseNotRenderedUnderB: true,
      revisitedAExportInitiallyDisabled: true, higherIdVictimBrowserDenied: true,
      protectedForeignSnapshotsUnchanged: true, providerCalls: 0,
      addedPageCredits: 0, addedApiCredits: 0, productionCertified: false,
    }));
  } finally {
    if (browser) await browser.close();
    await pool.end();
  }
}
if (process.argv[1]?.replaceAll("\\", "/").endsWith("tenant-report-builder-switch-browser.mjs")) {
  proveReportBuilderSwitchBrowser().catch(error => {
    console.error("REPORT_BUILDER_ABA_BROWSER_FAILED " +
      (error instanceof Error ? error.stack : String(error)));
    process.exitCode = 1;
  });
}
