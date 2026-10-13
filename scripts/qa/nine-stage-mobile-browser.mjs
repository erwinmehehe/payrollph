import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";

const base = "http://127.0.0.1:3000";
const auth = JSON.parse(readFileSync("qa-artifacts/.nine-stage-browser-auth.json", "utf8"));
const report = {
  sourceSha: process.env.PR_HEAD_SHA ?? "local",
  result: "FAIL", mode: "synthetic Chromium, no physical device",
  widths: [375,390], checks: [], independentHumanUat: false,
};
assert.equal(process.env.CI, "true");
assert.equal(process.env.GITHUB_ACTIONS, "true");
assert.equal(process.env.QA_URL, base);
assert.equal(new URL(process.env.DATABASE_URL).hostname, "127.0.0.1");
assert.equal(process.env.NINE_STAGE_SYNTHETIC_CLOCK, "2026-09-30");
assert.equal(process.env.DEMO_MODE, "false");
// The CI server preloads the isolated virtual September cutoff. Chromium must
// render the same fictional calendar, or its first hydration sees October
// while server markup was generated in September (React hydration error #418).
const syntheticEpoch = Date.parse("2026-09-30T08:00:00.000Z");
const browser = await chromium.launch({headless:true});
try {
  for(const width of [375,390]) {
    const context = await browser.newContext({
      viewport:{ width,height:844 }, timezoneId:"Asia/Manila",
    });
    await context.addInitScript(epoch => {
      // Test page only: match the guarded localhost server's monotonic clock.
      // Preserve Date.parse/UTC, constructor overloads and instanceof behavior.
      const RealDate = Date;
      const started = performance.now();
      const now = () => epoch + Math.floor(performance.now() - started);
      globalThis.Date = new Proxy(RealDate, {
        apply() { return new RealDate(now()).toString(); },
        construct(target, args, newTarget) {
          return Reflect.construct(target, args.length ? args : [now()], newTarget);
        },
        get(target, key, receiver) {
          return key === "now" ? now : Reflect.get(target, key, receiver);
        },
      });
    }, syntheticEpoch);
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", err => errors.push(String(err.message).slice(0,100)));
    const signed = await context.request.post(base + "/api/auth/login",{
      data:{email:auth.owner,password:auth.password},
      headers:{origin:base,"sec-fetch-site":"same-origin"}
    });
    assert.equal(signed.status(),200);
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
    report.checks.push(width + "px failure/retry and owner switch A -> B -> A; disjoint tenant employee records");
    await context.close();

    const restricted = await browser.newContext({viewport:{width,height:844}});
    const employeeLogin = await restricted.request.post(base + "/api/auth/login",{
      data:{email:auth.employee,password:auth.password},
      headers:{origin:base,"sec-fetch-site":"same-origin"}
    });
    assert.equal(employeeLogin.status(),200);
    const denied = await restricted.request.get(base + "/api/employees?organizationId="
      + auth.otherOrganizationId);
    assert.equal(denied.status(),403);
    report.checks.push(width + "px distinct employee cannot read tenant B");
    await restricted.close();
  }
  report.result = "PASS";
} finally {
  writeFileSync("qa-artifacts/nine-stage-mobile-report.json",JSON.stringify(report,null,2)+"\n");
  await browser.close();
}
