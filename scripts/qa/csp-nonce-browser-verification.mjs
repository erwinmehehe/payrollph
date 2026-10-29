#!/usr/bin/env node
/**
 * Served Next 16 CSP acceptance. ONLY fictional local PG16 in GitHub Actions.
 * Two independent builds, flag OFF then ON, are run by the workflow.
 * Screenshot, HTTP and console evidence is written to qa-artifacts, not claimed
 * by source-level tests or production configuration.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { chromium } from "playwright";

const mode = process.argv[2];
const enabled = mode === "on";
const base = "http://127.0.0.1:3000";
const root = "qa-artifacts/csp-verification";
const dest = root + "/" + mode;
assert.ok(mode === "off" || mode === "on", "Expected 'off' or 'on'");
assert.equal(process.env.CI, "true");
assert.equal(process.env.GITHUB_ACTIONS, "true");
assert.equal(process.env.HCM_PEOPLE_HOME_ACCEPTANCE_MODE, "synthetic-postgres-only");
assert.equal(process.env.DATABASE_URL, "postgresql://postgres:postgres@127.0.0.1:5432/app_db");
assert.equal(process.env.NEXT_CSP_ENABLED, enabled ? "true" : "false");
assert.equal(process.env.APP_BASE_URL, base);
assert.equal(process.env.OPENAI_API_KEY || "", "");
await mkdir(dest, { recursive: true });
const report = {
  mode, sourceSha: process.env.CSP_EVIDENCE_SOURCE_SHA || process.env.GITHUB_SHA, base, localSyntheticOnly: true,
  browser: [], http: [], latency: [], failures: [], sampleCount: 7,
  productionTrafficTested: false, productionCspEnabled: false,
};
const sha = text => createHash("sha256").update(text).digest("hex");

function scriptTags(html) {
  return [...html.matchAll(/<script\b[^>]*>/gi)].map(m => {
    const tag = m[0];
    const nonce = /\bnonce=["']([^"']+)["']/i.exec(tag)?.[1] ?? null;
    const type = /\btype=["']([^"']+)["']/i.exec(tag)?.[1] ?? null;
    const src = /\bsrc=["']([^"']+)["']/i.exec(tag)?.[1] ?? null;
    return { nonce, type, hasSrc: Boolean(src) };
  });
}
function inspectHtml(path, status, headers, html) {
  const csp = headers["content-security-policy"] ?? null;
  const match = /(?:^|;\s*)script-src\s+([^;]+)/.exec(csp ?? "");
  const scriptSource = match?.[1] ?? "";
  const headerNonce = /'nonce-([^']+)'/.exec(scriptSource)?.[1] ?? null;
  const scripts = scriptTags(html);
  const executable = scripts.filter(tag =>
    !tag.type || /(?:javascript|module|ecmascript)/i.test(tag.type));
  const missing = executable.filter(tag => !tag.nonce).length;
  const mismatch = executable.filter(tag => tag.nonce && tag.nonce !== headerNonce).length;
  const description = /<meta[^>]+name=["']description["'][^>]*content=["']([^"']*)/i.exec(html)?.[1] ?? "";
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? "";
  const canonical = /<link[^>]+rel=["']canonical["'][^>]*href=["']([^"']*)/i.exec(html)?.[1] ?? "";
  const h1 = /<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(html)?.[1]?.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim() ?? "";
  const evidence = {
    path, status, csp, scriptSource, headerNonce, totalScripts: scripts.length,
    executableScripts: executable.length, matchingScripts: executable.length - missing - mismatch,
    missingExecutableNonce: missing, mismatchedExecutableNonce: mismatch,
    nonExecutableScripts: scripts.filter(tag => !executable.includes(tag)),
    contentType: headers["content-type"] ?? null,
    cacheControl: headers["cache-control"] ?? null,
    xNextjsCache: headers["x-nextjs-cache"] ?? null,
    htmlBytes: Buffer.byteLength(html), htmlSha256: sha(html),
    title, description, canonical, h1,
  };
  evidence.pass = enabled
    ? Boolean(csp && headerNonce && executable.length > 0 && missing === 0 && mismatch === 0 &&
        !/unsafe-inline|unsafe-eval/.test(scriptSource))
    : Boolean(csp && scriptSource.includes("'unsafe-inline'"));
  return evidence;
}
async function httpProbe(path, sequence, store = true) {
  const start = performance.now();
  const response = await fetch(base + path, {
    redirect: "manual", cache: "no-store", headers: { Accept: "text/html" },
    signal: AbortSignal.timeout(45000),
  });
  const ttfbMs = performance.now() - start; // fetch resolves when response headers arrive
  const html = await response.text();
  const totalMs = performance.now() - start;
  const headers = Object.fromEntries(response.headers.entries());
  const evidence = inspectHtml(path, response.status, headers, html);
  if (store) report.http.push({ sequence, ...evidence });
  return { evidence, ttfbMs: +ttfbMs.toFixed(2), totalMs: +totalMs.toFixed(2) };
}
async function evidence(name, action) {
  try { const detail = await action(); return { name, pass: true, ...detail }; }
  catch (error) {
    const failure = { name, pass: false, error: error instanceof Error ? error.message : String(error) };
    report.failures.push(failure); return failure;
  }
}

// Two isolated, real sessions: HR can reach People Home; payroll can open Payroll.
// Never log session cookies, login response bodies or credentials.
async function syntheticLogin(context, email, label) {
  try {
    const response = await context.request.post(base + "/api/auth/login", {
      headers: { origin: base, "sec-fetch-site": "same-origin" },
      data: { email, password: "Synthetic-HCM-QA-Password-Only-2026!" },
      failOnStatusCode: false,
    });
    const auth = { status: response.status(), hasSessionCookie: (await context.cookies())
      .some(cookie => cookie.name === "__Host-linaw_session" || cookie.name === "linaw_session") };
    assert.equal(auth.status, 200, label + ": expected real synthetic session");
    assert.equal(auth.hasSessionCookie, true, label + ": expected session cookie");
    return auth;
  } catch (error) {
    report.failures.push({ name: label, pass: false,
      error: error instanceof Error ? error.message : String(error) });
    return null;
  }
}

async function main() {
  // Raw standalone HTTP evidence: distinct requests, nonce/HTML contract,
  // error responses, and reproducible response timing.
  for (const path of ["/", "/login", "/hcm", "/__csp_qa_not_found", "/csp-qa-expected-500"]) {
    const samples = [];
    await httpProbe(path, "warmup", false);
    for (let i = 0; i < report.sampleCount; i++) {
      const sample = await httpProbe(path, "sample-" + i, i < 2);
      samples.push({
        ttfbMs: sample.ttfbMs, totalMs: sample.totalMs,
        status: sample.evidence.status, htmlBytes: sample.evidence.htmlBytes,
        htmlSha256: sample.evidence.htmlSha256, cacheControl: sample.evidence.cacheControl,
      });
    }
    const sorted = field => [...samples].sort((a,b) => a[field] - b[field])
      [Math.floor(samples.length / 2)][field];
    report.latency.push({
      path, medianTtfbMs: sorted("ttfbMs"), medianTotalMs: sorted("totalMs"),
      allSamples: samples,
    });
  }
  const htmlCheck = await evidence("served HTML CSP and nonce matching across public/error paths", async () => {
    const pages = report.http.filter(row => row.sequence !== "warmup");
    assert.ok(pages.length >= 10);
    assert.ok(pages.every(page => page.pass),
      "One or more response headers or executable script nonces failed; see http[]");
    for (const path of ["/login", "/hcm", "/__csp_qa_not_found", "/csp-qa-expected-500"]) {
      const samples = pages.filter(row => row.path === path);
      assert.equal(samples.length, 2);
      if (enabled) {
        assert.notEqual(samples[0].headerNonce, samples[1].headerNonce,
          path + " must use distinct per-response nonces");
      }
    }
    assert.ok(pages.some(page => page.path === "/__csp_qa_not_found" && page.status === 404),
      "404 probe must actually return HTTP 404");
    assert.ok(pages.some(page => page.path === "/csp-qa-expected-500" && page.status === 500),
      "Synthetic throw route must actually return HTTP 500");
    return { pages: pages.map(p => ({ path:p.path, status:p.status, pass:p.pass })) };
  });
  report.htmlCheck = htmlCheck;

  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const pages = [
      { path: "/", name: "marketing" },
      { path: "/login", name: "login" },
      { path: "/hcm", name: "hcm-marketing" },
    ];
    for (const { path, name } of pages) {
      report.browser.push(await browserPage(context, path, name, false));
    }
    // Authenticate HR and Payroll separately. An HR grant does not imply
    // payroll navigation, so the payroll click must use a real payroll role.
    const auth = await syntheticLogin(context, "hcm-hr@example.test", "synthetic HR login");
    report.authentication = auth;
    const payrollContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    try {
      const payrollAuth = await syntheticLogin(payrollContext,
        "hcm-payroll@example.test", "synthetic payroll login");
      report.payrollAuthentication = payrollAuth;
      if (payrollAuth?.status === 200 && payrollAuth.hasSessionCookie) {
        report.browser.push(await browserPage(payrollContext,
          "/app?organizationId=1", "payroll-workspace", true));
      } else report.failures.push({ name: "authenticated payroll page skipped", pass: false,
        error: "No valid real payroll-role synthetic session" });
    } finally { await payrollContext.close(); }
    if (auth?.status === 200 && auth.hasSessionCookie) {
      for (const { path, name } of [
        { path: "/hcm/command-center?organizationId=1", name: "hcm-command-center" },
        { path: "/hcm/action-center?organizationId=1", name: "hcm-action-center" },
      ]) report.browser.push(await browserPage(context, path, name, true));
    } else report.failures.push({ name: "authenticated HCM pages skipped", pass: false,
      error: "No valid real HR-role synthetic session" });
    await context.close();
  } finally { await browser.close(); }
  report.browserPass = report.browser.length === 6 && report.browser.every(row => row.pass);
  if (!report.browserPass) report.failures.push({
    name: "browser and hydration acceptance", pass: false,
    error: "At least one key page failed rendering, CSP, authentication, or React interaction",
  });
}

async function browserPage(context, path, name, authenticated) {
  const page = await context.newPage();
  const consoleErrors = [], cspViolations = [], pageErrors = [];
  const record = { name, path, authenticated, consoleErrors, cspViolations,
    pageErrors, screenshot: dest + "/" + name + ".png", pass: false };
  page.on("console", m => {
    if (m.type() === "error") consoleErrors.push(m.text().slice(0, 350));
  });
  page.on("pageerror", err => pageErrors.push(err.message.slice(0, 350)));
  await page.addInitScript(() => {
    window.__cspTestViolations = [];
    document.addEventListener("securitypolicyviolation", event => {
      window.__cspTestViolations.push({
        directive: event.violatedDirective, blockedUri: event.blockedURI,
        sourceFile: event.sourceFile, lineNumber: event.lineNumber,
      });
    });
  });
  try {
    const response = await page.goto(base + path, {
      waitUntil: "domcontentloaded", timeout: 65000,
    });
    assert.ok(response, name + ": missing main document HTTP response");
    record.status = response.status();
    record.urlPath = new URL(page.url()).pathname;
    record.html = inspectHtml(path, record.status, response.headers(),
      await response.text());
    assert.equal(record.status, 200, name + ": expected 200, not redirect/404/error");
    assert.equal(record.urlPath, path.split("?")[0], name + ": unexpected redirect");
    assert.equal(record.html.pass, true, name + ": server document CSP/nonce mismatch");
    await page.waitForTimeout(1700);
    if (name === "login") {
      // A real React onClick event must update input type. DOM typing alone
      // would not demonstrate hydration.
      const password = page.locator('input[autocomplete="current-password"]');
      await password.waitFor({ timeout: 20000 });
      assert.equal(await password.getAttribute("type"), "password");
      // Keyboard activation is a real native button click and React onClick.
      // Avoid pointer label forwarding to the neighboring "Forgot password?"
      // button nested in the same label, which changed the form mid-probe.
      const visibility = page.getByTestId("password-visibility");
      await visibility.press("Enter");
      assert.equal(await password.getAttribute("type"), "text",
        "React password-visibility handler did not hydrate");
      await visibility.press("Enter");
      assert.equal(await password.getAttribute("type"), "password");
      record.hydrationInteraction = "real keyboard-activated React password visibility toggled twice";
    }
    if (name === "payroll-workspace") {
      const session = await page.evaluate(async () => {
        const response = await fetch("/api/auth/me", { credentials: "same-origin" });
        const body = await response.json().catch(() => null);
        return { status: response.status, role: body?.user?.role };
      });
      assert.equal(session.status, 200);
      assert.equal(session.role, "payroll", "A real payroll officer role is required");
      record.role = session.role;
      const payrollTab = page.locator('[data-nav-name="Payroll"]').first();
      if (!await payrollTab.isVisible()) {
        // Some workspace configurations put Payroll behind the real More menu.
        await page.locator(".nav-more-toggle").click({ timeout: 20000 });
      }
      await payrollTab.waitFor({ timeout: 40000 });
      await payrollTab.click();
      await page.locator('[data-workspace-page="Payroll"]').waitFor({ timeout: 40000 });
      record.hydrationInteraction = "real payroll-role React Payroll tab navigation";
    }
    if (name === "hcm-action-center") {
      await page.getByRole("heading", { name: "HCM Action Center" }).waitFor({
        timeout: 45000,
      });
      await page.getByRole("link", { name: "Return to People Home" }).click();
      await page.waitForURL(/\/hcm\/command-center\?organizationId=1/, {
        timeout: 45000,
      });
      record.hydrationInteraction = "Next.js HCM client link navigation";
    }
    if (name === "hcm-command-center") {
      await page.getByRole("heading", { name: "People Home", exact: true })
        .waitFor({ timeout: 45000 });
      record.hydrationInteraction = "authenticated HCM People Home rendered";
    }
    cspViolations.push(...await page.evaluate(() => window.__cspTestViolations || []));
    const relevantErrors = [...consoleErrors, ...pageErrors].filter(msg =>
      /Content Security Policy|Refused to (load|execute|apply)|hydration|React error #|Minified React error/i.test(msg));
    record.relevantErrors = relevantErrors;
    assert.deepEqual(cspViolations, [], name + ": actual browser CSP violation event");
    assert.deepEqual(relevantErrors, [], name + ": actual browser CSP/hydration error");
    record.pass = true;
  } catch (error) {
    record.error = error instanceof Error ? error.message : String(error);
    cspViolations.push(...await page.evaluate(() => window.__cspTestViolations || []).catch(() => []));
  } finally {
    await page.screenshot({ path: record.screenshot, fullPage: true }).catch(err => {
      record.screenshotError = String(err);
    });
    await page.close();
  }
  return record;
}

try { await main(); } catch (error) {
  report.failures.push({ name: "harness", pass: false,
    error: error instanceof Error ? error.stack : String(error) });
} finally {
  await writeFile(dest + "/raw-evidence.json", JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ mode, browser: report.browser.map(p => ({
    name:p.name, status:p.status, pass:p.pass, cspViolations:p.cspViolations.length,
    consoleErrors:p.consoleErrors.length, pageErrors:p.pageErrors.length,
  })), htmlCheck: report.htmlCheck?.pass, latency: report.latency.map(p => ({
    path:p.path, medianTtfbMs:p.medianTtfbMs, medianTotalMs:p.medianTotalMs,
  })), failures: report.failures }, null, 2));
  if (report.failures.length || !report.htmlCheck?.pass || !report.browserPass)
    process.exitCode = 1;
}
