import assert from "node:assert/strict";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { test } from "node:test";
import { chromium } from "playwright";
import { generateTotp } from "../../src/lib/totp.ts";
import { isExpectedDenied } from "./nav-sweep.expected-denied.mjs";

const BASE = "http://127.0.0.1:3000";
const dir = "qa-artifacts/nav-sweep";
const manifest = JSON.parse(readFileSync(dir + "/manifest.json", "utf8"));
const fixture = JSON.parse(readFileSync("/tmp/build-block-fixture.json", "utf8"));
assert.equal(process.env.CI, "true");
assert.equal(process.env.BUILD_BLOCK_ACCEPTANCE_MODE, "synthetic-postgres-only");
assert.equal(process.env.DEMO_MODE, "false");
assert.equal(process.env.OPENAI_API_KEY ?? "", "");
assert.equal(new URL(process.env.DATABASE_URL).hostname, "127.0.0.1");
assert.equal(new URL(process.env.DATABASE_URL).pathname, "/app_db");

mkdirSync(dir, { recursive: true });
const results = [];
const broken = process.env.NAV_SWEEP_INJECT_BROKEN === "true";
const proofOnly = process.env.NAV_SWEEP_ONLY_OWNER === "true";
// Read-only navigation + view controls. Mutation methods are intercepted, even
// if a seemingly harmless button hides a write action.
const SAFE_CONTROL = /^(?:more|close|dismiss|cancel|back|next|previous|open|view|show|hide|expand|collapse|details|preview|search|filter|clear filter|help|info|overview|summary|refresh view|history|about)/i;
const DANGEROUS = /(?:submit|payroll|process|release|approve|reject|decline|delete|remove|archive|publish|send|file|remit|transfer|withdraw|disburse|payout|payment|save|create|add|edit|update|record|apply|import|upload|download|export|sync|generate|run|calculate|clock|punch|sign out|logout|upgrade|enable|disable|retry|confirm|reconcile|recalculate|execute|start|stop)/i;
const ERROR_SELECTOR = ".toast.err, .empty-state.error, [role='alert'], .notice-red, .notice-danger, .notice.error, .error-banner, [data-sonner-toast][data-type='error']";
const safeText = (s) => (s ?? "").replace(/\s+/g, " ").slice(0, 380);

async function login(browser, role) {
  const context = await browser.newContext();
  try {
    let response;
    for (let i = 0; i < 2; i++) {
      response = await context.request.post(BASE + "/api/auth/login", {
        headers: { origin: BASE, "sec-fetch-site": "same-origin" },
        data: { email: role + "@build-block.example.test",
          password: "Synthetic-Build-Block-Only-2026!",
          totpCode: generateTotp("JBSWY3DPEHPK3PXP") },
      });
      if (response.status() !== 429 || i) break;
      const retry = Number((await response.json().catch(() => ({}))).retryAfterMs);
      if (!Number.isFinite(retry) || retry < 0 || retry > 60000) break;
      await new Promise(resolve => setTimeout(resolve, retry + 300));
    }
    assert.equal(response.status(), 200, "Fictional MFA login: " + role);
    return context.storageState();
  } finally { await context.close(); }
}

async function checkRole(browser, role, width, authState, pages) {
  const context = await browser.newContext({ viewport: { width, height: 844 }, storageState: authState, acceptDownloads: false });
  const page = await context.newPage();
  const errors = [];
  let current = "initial load";
  let blocked = 0;
  // Guard both fetch/XHR and form submissions. Any accidental POST/PATCH/PUT/
  // DELETE is aborted, not merely ignored after it reaches the server.
  await context.route("**/*", async route => {
    const req = route.request();
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method())) {
      blocked++;
      await route.abort("blockedbyclient");
    } else await route.continue();
  });
  if (broken && role === "owner" && width === 1280) {
    await page.route("**/app?organizationId=*", async route => {
      if (current === "Overview") {
        await route.fulfill({ status: 500, contentType: "text/html",
          body: "<h1>Deliberately broken Overview route - synthetic proof</h1>" });
      } else await route.continue();
    });
  }
  page.on("console", msg => { if (msg.type() === "error") errors.push({ page: current, kind: "console", detail: safeText(msg.text()) }); });
  page.on("pageerror", err => errors.push({ page: current, kind: "exception", detail: safeText(err.stack ?? err.message) }));
  page.on("requestfailed", req => {
    if (req.url().startsWith(BASE + "/api/") && req.failure()?.errorText !== "net::ERR_BLOCKED_BY_CLIENT")
      errors.push({ page: current, kind: "network", detail: req.method() + " " + req.url() + ": " + req.failure()?.errorText });
  });
  page.on("response", response => {
    const url = new URL(response.url());
    if (url.origin !== BASE || !url.pathname.startsWith("/api/")) return;
    const status = response.status();
    if (status < 200 || status >= 300) {
      if (!isExpectedDenied({ role, page: current, method: response.request().method(), apiPath: url.pathname, status }))
        errors.push({ page: current, kind: "HTTP " + status, detail: response.request().method() + " " + url.pathname + url.search });
    }
  });
  try {
    for (const name of pages) {
      current = name;
      blocked = 0;
      const started = Date.now();
      const before = errors.length;
      const findings = [];
      const skipped = [];
      try {
        const opened = await page.goto(BASE + "/app" + (role === "employee" ? "" : "?organizationId=" + fixture.organizationId), { waitUntil: "load", timeout: 30000 });
        if (!opened || opened.status() < 200 || opened.status() >= 300) {
          throw new Error("HTTP " + (opened?.status() ?? "no response") + " GET /app");
        }
        await page.locator("[data-workspace-role='" + role + "']").first().waitFor({ timeout: 30000 });
        await page.waitForTimeout(700);
        if (role === "employee") {
          const tab = name.slice("employee-".length);
          const nav = page.locator(".employee-side-nav").getByRole("button", { name: new RegExp("^" +
            ({ home: "Home", pay: "Pay", time: "Time", leave: "Leave", documents: "Documents",
              performance: "Performance", profile: "Profile", expenses: "Expenses" })[tab] + "$", "i") });
          // Desktop sidebar exists but is translated off-screen at phone width:
          // use the actual mobile navigation at 390px.
          if (width <= 390) {
            if (["home", "pay", "time", "leave"].includes(tab)) {
              const mobile = page.locator(".employee-mobile-nav").getByRole("button", { name: new RegExp("^(Home|Pay|Payslips|Time|Attendance|Leave)$", "i") });
              const index = ["home", "pay", "time", "leave"].indexOf(tab);
              await mobile.nth(index).click({ timeout: 12000 });
            } else {
              await page.getByRole("button", { name: "More employee pages" }).click();
              await page.locator(".employee-more-links").getByRole("button", {
                name: new RegExp(tab === "profile" ? "Profile|My info" : tab, "i"),
              }).click();
            }
          } else await nav.click({ timeout: 12000 });
        } else {
          if (width <= 390) {
            await page.getByRole("button", { name: "Open navigation" }).click({ timeout: 12000 });
            await page.locator(".app-shell.drawer-open").waitFor({ timeout: 12000 });
          }
          let item = page.locator(".sidebar [data-nav-name]").filter({ hasNot: page.locator("nonexistent") });
          if (name === "Settings") {
            const settings = page.locator(".sidebar .sidebar-settings-link");
            if (await settings.count()) await settings.click({ timeout: 12000 });
            else { item = page.locator('.sidebar [data-nav-name="Settings"]'); await item.click({ timeout: 12000 }); }
          } else {
            item = page.locator(".sidebar [data-nav-name]").filter({ hasNot: page.locator("nonexistent") }).locator("xpath=.");
            let target = page.locator('.sidebar [data-nav-name="' + name.replaceAll('"', '\\"') + '"]');
            if (await target.count() === 0) {
              const more = page.locator(".sidebar .nav-more-toggle");
              if (await more.count()) await more.click();
            } else if (!(await target.isVisible()) || !(await target.isEnabled())) {
              const more = page.locator(".sidebar .nav-more-toggle");
              if (await more.count()) await more.click();
            }
            target = page.locator('.sidebar [data-nav-name="' + name.replaceAll('"', '\\"') + '"]');
            if (!(await target.count())) { await page.locator(".sidebar .nav-more-toggle").click(); }
            await target.click({ timeout: 12000 });
          }
        }
        await page.locator("[data-workspace-page='" + name + "']").waitFor({ timeout: 14000 });
        await page.waitForTimeout(550);
        // Observe all actual error-toast families rather than keyword-matching
        // the benign body copy of a payroll screen.
        const alerts = await page.locator(ERROR_SELECTOR).allTextContents();
        for (const message of alerts.map(safeText).filter(Boolean)) findings.push({ kind: "visible error", detail: message });

        // Click only unambiguously non-destructive controls. A label not on the
        // safe vocabulary is explicitly SKIPPED, not silently marked tested.
        const controls = page.locator(".app-main button:visible, .app-main a:visible, .employee-workspace-body button:visible, .employee-workspace-body a:visible");
        const count = Math.min(await controls.count(), 220);
        for (let index = 0; index < count; index++) {
          const el = controls.nth(index);
          if (!(await el.count()) || !(await el.isVisible().catch(() => false)) || !(await el.isEnabled().catch(() => false))) continue;
          const label = safeText((await el.getAttribute("aria-label")) || (await el.textContent()) || (await el.getAttribute("title")));
          const href = await el.getAttribute("href");
          if (!label || DANGEROUS.test(label) || !SAFE_CONTROL.test(label) ||
              (href && (!href.startsWith("#") && !href.startsWith("/app")))) {
            skipped.push(label || "(unlabeled)"); continue;
          }
          try {
            await el.click({ timeout: 1600, noWaitAfter: true });
            await page.keyboard.press("Escape").catch(() => {});
          } catch (e) {
            findings.push({ kind: "dead control", detail: label + ": " + safeText(e.message) });
          }
        }
        if (blocked) findings.push({ kind: "unsafe action blocked", detail: blocked + " write requests prevented" });
      } catch (e) {
        findings.push({ kind: "navigation", detail: safeText(e.stack ?? e.message ?? String(e)) });
      }
      findings.push(...errors.slice(before).map(({ kind, detail }) => ({ kind, detail })));
      const result = { role, page: name, viewport: width, result: findings.length ? "FAIL" : "PASS",
        elapsedMs: Date.now() - started, findings, skippedControls: skipped.length,
        skippedExamples: [...new Set(skipped)].slice(0, 10) };
      results.push(result);
      console.log("NAV_SWEEP " + result.result + " " + role + " " + width + "px " + name +
        (findings.length ? " :: " + findings.map(f => f.kind + ": " + f.detail).join(" | ") : ""));
      // The next destination gets a fresh load in its own reporting window.
    }
  } finally { await context.close(); }
}

test("read-only navigation and runtime error sweep (real roles, both viewports)", { timeout: 3600000 }, async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const { role, pages: allPages } of manifest.roles) {
      if (proofOnly && role !== "owner") continue;
      const pages = proofOnly ? ["Overview"] : allPages;
      const state = await login(browser, role);
      for (const width of (proofOnly ? [1280] : [1280, 390])) await checkRole(browser, role, width, state, pages);
    }
  } finally {
    await browser.close();
    const failed = results.filter(r => r.result === "FAIL");
    const report = {
      generatedAt: new Date().toISOString(), syntheticOnly: true, productionDataUsed: false,
      injectedFailure: broken, total: results.length, passed: results.length - failed.length,
      failed: failed.length, results,
    };
    writeFileSync(dir + "/report.json", JSON.stringify(report, null, 2));
    writeFileSync(dir + "/report.md", [
      "# PayrollPH navigation and runtime sweep", "",
      "Disposable PostgreSQL and fictional accounts only. No payroll submission or filing.", "",
      "Total: " + report.total + " | Pass: " + report.passed + " | Fail: " + report.failed, "",
      "| Role | Viewport | Page | Result | Failure details | Skipped controls |",
      "| --- | --- | --- | --- | --- | --- |",
      ...results.map(r => "| " + r.role + " | " + r.viewport + "px | " +
        r.page.replaceAll("|", "/") + " | " + r.result + " | " +
        r.findings.map(f => f.kind + ": " + f.detail).join("; ").replaceAll("|", "/").replaceAll("\n", " ").slice(0, 400) +
        " | " + r.skippedControls + " |"),
    ].join("\n"));
    console.log("NAV_SWEEP_REPORT " + dir + "/report.md :: " + report.passed + " passed / " + report.failed + " failed");
  }
  assert.ok(results.length > 0, "Empty sweep is never green");
  assert.equal(results.filter(r => r.result === "FAIL").length, 0, "Runtime failures detected. Read report.md");
});
