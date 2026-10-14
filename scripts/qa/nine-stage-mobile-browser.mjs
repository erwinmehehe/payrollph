import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";

const base = "http://127.0.0.1:3000";
const auth = JSON.parse(readFileSync("qa-artifacts/.nine-stage-browser-auth.json", "utf8"));
const report = {
  sourceSha: process.env.PR_HEAD_SHA ?? "local",
  result: "FAIL", mode: "synthetic Chromium, no physical device",
  widths: [1440,375,390], checks: [], independentHumanUat: false,
};
assert.equal(process.env.CI, "true");
assert.equal(process.env.GITHUB_ACTIONS, "true");
assert.equal(process.env.QA_URL, base);
assert.equal(new URL(process.env.DATABASE_URL).hostname, "127.0.0.1");
assert.equal(process.env.NINE_STAGE_SYNTHETIC_CLOCK, "2026-09-30");
assert.equal(process.env.DEMO_MODE, "false");
const realAnchor = Number(process.env.NINE_STAGE_SYNTHETIC_REAL_ANCHOR);
const anchorAge = Date.now() - realAnchor;
assert.ok(Number.isSafeInteger(realAnchor) && anchorAge >= 0 && anchorAge < 30 * 60_000,
  "Synthetic mobile acceptance requires a fresh localhost-only shared clock anchor");
// The CI server preloads the isolated virtual September cutoff. Chromium must
// render the same fictional calendar, or its first hydration sees October
// while server markup was generated in September (React hydration error #418).
const syntheticEpoch = Date.parse("2026-09-30T08:00:00.000Z");
const browser = await chromium.launch({headless:true});
// Keep one real authenticated session per role for all three viewports.
// The connected nine-stage acceptance already signs in seven synthetic users;
// repeating six more login attempts can correctly trip the 10/minute shared-IP limit.
let ownerSessionState = null;
let employeeSessionState = null;
try {
  for(const width of [1440,375,390]) {
    const context = await browser.newContext({
      viewport:{ width,height:844 }, timezoneId:"Asia/Manila",
      ...(ownerSessionState ? {storageState:ownerSessionState} : {}),
    });
    await context.addInitScript(({epoch, anchor}) => {
      // Test page only: match the guarded localhost server's *shared* synthetic
      // September timeline, not a fresh clock starting at browser navigation.
      // Preserve Date.parse/UTC, constructor overloads and instanceof behavior.
      const RealDate = Date;
      const now = () => epoch + (RealDate.now() - anchor);
      globalThis.Date = new Proxy(RealDate, {
        apply() { return new RealDate(now()).toString(); },
        construct(target, args, newTarget) {
          return Reflect.construct(target, args.length ? args : [now()], newTarget);
        },
        get(target, key, receiver) {
          return key === "now" ? now : Reflect.get(target, key, receiver);
        },
      });
    }, {epoch: syntheticEpoch, anchor: realAnchor});
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", err => errors.push(String(err.message).slice(0,100)));
    if (!ownerSessionState) {
      const signed = await context.request.post(base + "/api/auth/login", {
        data:{email:auth.owner,password:auth.password},
        headers:{origin:base,"sec-fetch-site":"same-origin"}
      });
      assert.equal(signed.status(),200, "Initial fictional owner sign-in failed");
      ownerSessionState = await context.storageState();
    } else {
      const ownerSession = await context.request.get(base + "/api/auth/me");
      assert.equal(ownerSession.status(),200,"Reused owner session must remain authenticated");
      const currentOwner = await ownerSession.json();
      assert.equal(currentOwner.user?.email,auth.owner,"Owner session must retain its identity");
    }
    await page.goto(base + "/app?organizationId=" + auth.organizationId,
      {waitUntil:"domcontentloaded"});
    await page.locator(".company-switcher").waitFor({timeout:60000});
    const a = await page.evaluate(async id => {
      const response = await fetch("/api/employees?organizationId=" + id);
      return {status:response.status,body:await response.json()};
    }, auth.organizationId);
    assert.equal(a.status,200);
    assert.equal(a.body.length,1);
    // Simulate one failed browser request without changing employee data or permissions.
    // Retry must read the correct authorized employer, never retain a stale tenant.
    const pattern = "**/api/employees?organizationId=" + auth.organizationId;
    await page.route(pattern, route => route.abort("failed"));
    const failedFetch = await page.evaluate(async id => {
      try { await fetch("/api/employees?organizationId=" + id); return false; }
      catch { return true; }
    }, auth.organizationId);
    assert.equal(failedFetch,true,"Injected browser network failure was not detected");
    await page.unroute(pattern);
    const retry = await page.evaluate(async id => {
      const response = await fetch("/api/employees?organizationId=" + id,
        { cache: "no-store" });
      return { status:response.status,body:await response.json() };
    }, auth.organizationId);
    assert.equal(retry.status,200,"Authorized retry after a failed request must recover");
    assert.equal(retry.body[0]?.id,a.body[0].id);
    await page.locator(".company-switcher").click();
    const all = await page.getByRole("menuitemradio").allTextContents();
    assert.ok(all.some(x => x.includes("Fictional Connected Employer B")));
    await page.getByRole("menuitemradio", {name:/Fictional Connected Employer B/}).click();
    await page.waitForURL("**/app?organizationId=" + auth.otherOrganizationId,
      {timeout:60000});
    const b = await page.evaluate(async id => {
      const response = await fetch("/api/employees?organizationId=" + id);
      return {status:response.status,body:await response.json()};
    }, auth.otherOrganizationId);
    assert.equal(b.status,200);
    assert.equal(b.body.length,1);
    assert.notEqual(a.body[0].id,b.body[0].id);
    // A -> B is not enough: returning to A must restore the original tenant,
    // including the original scoped employee record after a failed fetch.
    await page.locator(".company-switcher").click();
    await page.getByRole("menuitemradio", {name:/Fictional Connected Employer A/}).click();
    await page.waitForURL("**/app?organizationId=" + auth.organizationId,
      {timeout:60000});
    const backToA = await page.evaluate(async id => {
      const response = await fetch("/api/employees?organizationId=" + id,
        {cache:"no-store"});
      return {status:response.status,body:await response.json()};
    }, auth.organizationId);
    assert.equal(backToA.status,200);
    assert.equal(backToA.body.length,1);
    assert.equal(backToA.body[0].id,a.body[0].id,
      "Returning to employer A must restore the original worker");
    const widthAudit = await page.evaluate(() => {
      const width = window.innerWidth;
      const offenders = [...document.querySelectorAll("body *")].flatMap(el => {
        const rect = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        if (rect.right <= width + 1 || rect.width <= 0) return [];
        return [{tag:el.tagName.toLowerCase(),
          class:typeof el.className === "string" ? el.className.slice(0,90) : "",
          left:Math.round(rect.left),right:Math.round(rect.right),
          width:Math.round(rect.width),overflowX:style.overflowX}];
      }).sort((a,b) => b.right - a.right).slice(0,12);
      return {viewport:width,document:document.documentElement.scrollWidth,
        body:document.body.scrollWidth,offenders};
    });
    assert.ok(widthAudit.document <= widthAudit.viewport + 1,
      "Round-trip employer switch mobile screen overflows: " + JSON.stringify(widthAudit));
    assert.deepEqual(errors,[]);
    assert.equal(await page.locator('.app-shell').getAttribute('data-compact-mobile-header'), 'true');
    await page.screenshot({path:'qa-artifacts/nine-stage-layout-on-' + width + '.png',fullPage:false});
    report.checks.push(width + "px failure/retry and owner switch A -> B -> A; disjoint tenant employee records");
    await page.goto('http://127.0.0.1:3001/app?organizationId=' + auth.organizationId,
      {waitUntil:'domcontentloaded'});
    const offShell = page.locator('.app-shell');
    await offShell.waitFor({timeout:60000});
    assert.equal(await offShell.getAttribute('data-compact-mobile-header'),null);
    assert.equal(await page.locator('.topbar').evaluate(el => getComputedStyle(el).display),'flex',
      'Disabled header retains legacy flex layout');
    await page.screenshot({path:'qa-artifacts/nine-stage-layout-off-' + width + '.png',fullPage:false});
    report.checks.push(width + 'px default-off marker absent and legacy flex layout unchanged');
    await context.close();

    // Verify an actual authenticated *browser* employee session before
    // asserting the cross-tenant 403. APIRequestContext's cookie jar is not
    // a substitute for an authenticated browser when server session dates
    // are deliberately virtualized for a synthetic September payroll.
    const restricted = await browser.newContext({
      viewport:{width,height:844}, timezoneId:"Asia/Manila",
      ...(employeeSessionState ? {storageState:employeeSessionState} : {}),
    });
    await restricted.addInitScript(({epoch, anchor}) => {
      const RealDate = Date;
      const now = () => epoch + (RealDate.now() - anchor);
      globalThis.Date = new Proxy(RealDate, {
        apply() { return new RealDate(now()).toString(); },
        construct(target, args, newTarget) {
          return Reflect.construct(target, args.length ? args : [now()], newTarget);
        },
        get(target, key, receiver) {
          return key === "now" ? now : Reflect.get(target, key, receiver);
        },
      });
    }, {epoch:syntheticEpoch,anchor:realAnchor});
    const employeePage = await restricted.newPage();
    const employeeErrors = [];
    employeePage.on("pageerror", err =>
      employeeErrors.push(String(err.message).slice(0,100)));
    await employeePage.goto(base + "/login", {waitUntil:"domcontentloaded"});
    if (!employeeSessionState) {
      const employeeLogin = await employeePage.evaluate(async credentials => {
        const response = await fetch("/api/auth/login", {
          method:"POST",
          headers:{"content-type":"application/json"},
          credentials:"same-origin",
          body:JSON.stringify(credentials),
        });
        return {status:response.status,body:await response.json()};
      }, {email:auth.employee,password:auth.password});
      assert.equal(employeeLogin.status,200, "Initial employee browser sign-in failed");
      assert.equal(employeeLogin.body?.user?.email,auth.employee,
        "Employee login must return the actual fictional worker account");
      employeeSessionState = await restricted.storageState();
    }
    const session = await employeePage.evaluate(async () => {
      const response = await fetch("/api/auth/me",{credentials:"same-origin"});
      return {status:response.status,body:await response.json()};
    });
    assert.equal(session.status,200);
    assert.equal(session.body?.user?.email,auth.employee,
      "Do not accept 401 as cross-tenant protection: the employee must have a live session");
    const denied = await employeePage.evaluate(async organizationId => {
      const response = await fetch("/api/employees?organizationId=" + organizationId,
        {credentials:"same-origin",cache:"no-store"});
      return {status:response.status};
    }, auth.otherOrganizationId);
    assert.equal(denied.status,403,
      "An authenticated employee must receive 403 for another employer's directory");
    assert.deepEqual(employeeErrors,[],
      "Employee browser must not generate hydration or page errors");
    report.checks.push(width + "px verified employee session and cross-tenant 403");
    await restricted.close();
  }
  report.result = "PASS";
} finally {
  writeFileSync("qa-artifacts/nine-stage-mobile-report.json",JSON.stringify(report,null,2)+"\n");
  await browser.close();
}
