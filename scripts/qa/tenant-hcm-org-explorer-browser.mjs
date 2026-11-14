/**
 * Hydrated client tenant switching against the existing fictional PG16 fixture.
 * This helper is called only AFTER the page runner's hard environment/source
 * guards and actor seeding; it never accesses a deployed or remote app.
 */
import assert from "node:assert/strict";
import { ORIGIN, PAGE } from "./tenant-hcm-org-explorer-page-contract.mjs";

const COOKIE_PREFIX = "__Host-linaw_session=";

export async function proveOrgExplorerHydratedBrowser({
  cookie, operatorUserId, a, b, victim, unchanged
}) {
  assert.equal(process.env.TENANT_ORG_EXPLORER_BROWSER_PROOF,
    "fictional-chromium-only", "ORG_EXPLORER_BROWSER_REFUSED: missing fictional browser gate");
  assert.equal(process.env.APP_BASE_URL, ORIGIN,
    "ORG_EXPLORER_BROWSER_REFUSED: non-local app origin");
  assert.equal(process.env.DATABASE_URL,
    "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
    "ORG_EXPLORER_BROWSER_REFUSED: non-disposable database");
  assert.ok(cookie?.startsWith(COOKIE_PREFIX) &&
    /^[a-f0-9]{64}$/.test(cookie.slice(COOKIE_PREFIX.length)),
  "ORG_EXPLORER_BROWSER_REFUSED: invalid fictional session");
  assert.ok(a.org.id !== b.org.id && victim.org.id > a.org.id &&
    victim.org.id > b.org.id, "Distinct higher-ID employer victim required");

  // Browser dependency intentionally loaded after caller's source and sandbox checks.
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1365, height: 900 } });
    await context.addCookies([{
      name: "__Host-linaw_session", value: cookie.slice(COOKIE_PREFIX.length),
      url: ORIGIN, secure: true, httpOnly: true, sameSite: "Lax"
    }]);
    // No external IdP, provider, analytics, or other outbound browser traffic.
    await context.route("**/*", route => {
      const address = new URL(route.request().url());
      return address.origin === ORIGIN ? route.continue() : route.abort();
    });

    const session = await context.request.get(ORIGIN + "/api/account",
      { timeout: 30000, failOnStatusCode: false });
    assert.equal(session.status(), 200, "Browser must hold a real authenticated session");
    const sessionBody = await session.json();
    assert.equal(sessionBody.profile?.id, operatorUserId,
      "Browser must authenticate the intended dual-employer HR user");

    const page = await context.newPage();
    let ownHydratedPages = 0;
    let selectedHistories = 0;
    const routeFor = actor => ORIGIN + PAGE + "?organizationId=" + actor.org.id;

    for (const actor of [a, b, a]) {
      const response = await page.goto(routeFor(actor),
        { waitUntil: "domcontentloaded", timeout: 60000 });
      assert.equal(response?.status(), 200, actor.label + " must render owned SSR");
      await page.getByRole("heading", { name: "Organizations & Positions" })
        .waitFor({ timeout: 60000 });

      // A real hydrated fetch must return populated persisted org-unit data;
      // a successful empty SSR shell alone is never a passing browser proof.
      const unit = page.locator('ul[aria-label="Organizational units"] button')
        .filter({ hasText: actor.marker }).first();
      await unit.waitFor({ timeout: 60000 });
      await unit.click();

      const position = page.getByRole("button",
        { name: actor.position.code }).first();
      await position.waitFor({ timeout: 30000 });
      await position.click();

      // The browser must fetch the real selected employer + position history.
      await page.getByText("Recorded worker reference #" + actor.worker.id)
        .waitFor({ timeout: 30000 });
      const html = await page.content();
      assert.ok(html.includes(actor.marker) && html.includes(actor.position.code),
        actor.label + ": persisted own employer and position not in hydrated view");
      for (const other of [a, b, victim]) {
        if (other !== actor) {
          assert.ok(!html.includes(other.marker),
            actor.label + ": another employer leaked into hydrated HTML");
        }
        for (const privateValue of other.secrets) {
          assert.ok(!html.includes(privateValue),
            actor.label + ": private tax/bank field leaked into HTML/RSC");
        }
      }
      await unchanged("Chromium authorized " + actor.label + " graph/history");
      ownHydratedPages++;
      selectedHistories++;
    }

    const denied = await page.goto(routeFor(victim),
      { waitUntil: "domcontentloaded", timeout: 60000 });
    assert.equal(denied?.status(), 404,
      "A/B authorized HR must still be denied the real third employer");
    const deniedHtml = await page.content();
    for (const actor of [a, b, victim]) {
      assert.ok(!deniedHtml.includes(actor.marker),
        "Denied SSR must not disclose any employer data");
      for (const secret of actor.secrets)
        assert.ok(!deniedHtml.includes(secret), "Denied SSR leaked private source data");
    }
    await unchanged("Chromium foreign victim SSR refusal");
    assert.equal(ownHydratedPages, 3);
    assert.equal(selectedHistories, 3);

    // No session cookies, employer private fields or fixture IDs in artifacts.
    return {
      family: "org-explorer-hydrated-a-b-a",
      fictionalPg16: true, realChromium: true,
      dualEmployerAuthorizedUser: true, independentForeignVictimDenied: true,
      ownHydratedPages, selectedHistories, browserForeignDenials: 1,
      protectedSqlImmutable: true, pageActionCredits: 0, apiMethodCredits: 0,
      independentlyAccepted: false, productionCertified: false
    };
  } finally {
    await browser.close();
  }
}
