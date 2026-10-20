import assert from "node:assert/strict";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { test } from "node:test";
import { chromium } from "playwright";
import { generateTotp } from "../../src/lib/totp.ts";
import { isExpectedDenied } from "./nav-sweep.expected-denied.mjs";
import { mobileNavOpenerSelector, mobileNavVisualFindings } from "./nav-sweep-visual-contract.mjs";
import { compareNavSweepCaseCoverage, startNavSweepRoleBrowser, startNavSweepViewportBrowser } from "./nav-sweep-startup.mjs";

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
const startupRetries = [];
const broken = process.env.NAV_SWEEP_INJECT_BROKEN === "true";
const proofOnly = process.env.NAV_SWEEP_ONLY_OWNER === "true";
const focusRole = process.env.NAV_SWEEP_FOCUS_ROLE || null;
const focusPage = process.env.NAV_SWEEP_FOCUS_PAGE || null;
const mobileEdge = process.env.NAV_SWEEP_MOBILE_EDGE === "true";
const injectedVisualOverflow = process.env.NAV_SWEEP_INJECT_VISUAL_OVERFLOW === "true";
const sweepViewports = mobileEdge ? [375] : [1280, 390];
if (mobileEdge) {
  assert.ok(focusRole && focusPage && !broken && !proofOnly,
    "The 375px visual contract requires one focused fictional role and page");
}
assert.ok(!injectedVisualOverflow || mobileEdge,
  "Visual overflow injection is restricted to synthetic 375px proof mode");
// Read-only navigation + view controls. Mutation methods are intercepted, even
// if a seemingly harmless button hides a write action.
const SAFE_CONTROL = /^(?:more|close|dismiss|cancel|back|next|previous|open|view|show|hide|expand|collapse|details|preview|search|filter|clear filter|help|info|overview|summary|refresh view|history|about)/i;
const DANGEROUS = /\b(?:submit|payroll|process|release|approve|reject|decline|delete|remove|archive|publish|send|file|remit|transfer|withdraw|disburse|payout|payment|save|create|add|edit|update|record|apply|import|upload|download|export|sync|generate|run|calculate|clock|punch|sign out|logout|upgrade|enable|disable|retry|confirm|reconcile|recalculate|execute|start|stop)\b|^open\s+(?:SSS|PhilHealth|Pag-IBIG)\b/i;
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
  let readiness503 = false;
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
  page.on("console", msg => {
    if (msg.type() !== "error" || msg.text().includes("net::ERR_BLOCKED_BY_CLIENT")) return;
    // Chromium emits a generic resource error for the expected fail-closed
    // readiness 503. The exact response and UI fallback are asserted below.
    if (current === "Readiness" && readiness503 &&
        msg.text().includes("the server responded with a status of 503 (Service Unavailable)")) return;
    errors.push({ page: current, kind: "console", detail: safeText(msg.text()) });
  });
  page.on("pageerror", err => errors.push({ page: current, kind: "exception", detail: safeText(err.stack ?? err.message) }));
  page.on("requestfailed", req => {
    if (req.url().startsWith(BASE + "/api/") && req.failure()?.errorText !== "net::ERR_ABORTED" && !req.failure()?.errorText?.startsWith("net::ERR_BLOCKED_BY_CLIENT"))
      errors.push({ page: current, kind: "network", detail: req.method() + " " + req.url() + ": " + req.failure()?.errorText });
  });
  page.on("response", response => {
    const url = new URL(response.url());
    if (url.origin !== BASE || !url.pathname.startsWith("/api/")) return;
    const status = response.status();
    if (current === "Readiness" && response.request().method() === "GET" &&
        url.pathname === "/api/readiness/workspace" && status === 503) {
      readiness503 = true;
      return;
    }
    if (status < 200 || status >= 300) {
      if (!isExpectedDenied({ role, page: current, method: response.request().method(), apiPath: url.pathname, status }))
        errors.push({ page: current, kind: "HTTP " + status, detail: response.request().method() + " " + url.pathname + url.search });
    }
  });
  try {
    for (const name of pages) {
      current = name;
      blocked = 0;
      readiness503 = false;
      const started = Date.now();
      const before = errors.length;
      const findings = [];
      const skipped = [];
      let screenshot = null;
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
          if (name === "Settings") {
            const settings = page.locator('.sidebar button[data-nav-name="Settings"]');
            try {
              await settings.waitFor({ state: "visible", timeout: 12000 });
            } catch (cause) {
              // Keep hidden Settings a failure, with actual element and parent
              // geometry so this can be triaged without another manual run.
              const position = await settings.evaluate((element) => {
                const rect = element.getBoundingClientRect();
                const sidebar = element.closest(".sidebar");
                const footer = element.closest(".sidebar-bottom");
                const menu = sidebar?.querySelector(".side-navigation");
                function box(node) {
                  if (!node) return null;
                  const r = node.getBoundingClientRect(), style = getComputedStyle(node);
                  return { top: Math.round(r.top), bottom: Math.round(r.bottom),
                    left: Math.round(r.left), width: Math.round(r.width),
                    height: Math.round(r.height), display: style.display,
                    visibility: style.visibility, overflowY: style.overflowY,
                    position: style.position, contentVisibility: style.contentVisibility,
                    boxSizing: style.boxSizing, flex: style.flex, minHeight: style.minHeight,
                    maxHeight: style.maxHeight, gridRow: style.gridRow,
                    rects: node.getClientRects().length, children: node.children.length,
                    htmlHidden: node.hidden === true, className: node.className };
                }
                return { button: box(element), sidebar: box(sidebar),
                  menu: box(menu), footer: box(footer),
                  ancestors: (() => {
                    let node = element, chain = [];
                    while (node && chain.length < 7) {
                      chain.push(box(node));
                      node = node.parentElement;
                    }
                    return chain;
                  })(), viewportHeight: innerHeight };
              }).catch(() => null);
              console.log("NAV_SWEEP_LAYOUT_DIAGNOSTIC " + JSON.stringify(position));
              throw new Error("Settings nav control hidden: " + JSON.stringify(position) +
                "; " + String(cause));
            }
            await settings.click({ timeout: 12000 });
          } else {
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
        if (mobileEdge) {
          if (injectedVisualOverflow) {
            // Deliberate failure is DOM-only in a synthetic localhost browser:
            // proves real horizontal overflow cannot silently pass this sweep.
            await page.evaluate(() => {
              const overflow = document.createElement("div");
              overflow.id = "synthetic-mobile-overflow-negative-proof";
              overflow.style.cssText =
                "position:absolute;left:0;top:0;width:1600px;height:1px;pointer-events:none";
              document.body.appendChild(overflow);
            });
          }
          const geometry = await page.evaluate((openerSelector) => {
            const main = document.querySelector(".app-main");
            const nav = document.querySelector(openerSelector);
            const mainBox = main?.getBoundingClientRect();
            const navBox = nav?.getBoundingClientRect();
            return {
              viewportWidth: window.innerWidth,
              documentWidth: document.documentElement.scrollWidth,
              bodyWidth: document.body.scrollWidth,
              mainWidth: mainBox?.width ?? 0,
              mainLeft: mainBox?.left ?? null,
              mainRight: mainBox?.right ?? null,
              navWidth: navBox?.width ?? 0,
              navHeight: navBox?.height ?? 0,
              navVisible: Boolean(nav && navBox?.width && navBox?.height &&
                getComputedStyle(nav).visibility !== "hidden"),
              navExpanded: nav?.getAttribute("aria-expanded") ?? null,
            };
          }, mobileNavOpenerSelector(role));
          for (const detail of mobileNavVisualFindings(geometry)) {
            findings.push({ kind: "mobile visual contract", detail });
          }
          const imageDir = dir + "/mobile-edge";
          mkdirSync(imageDir, { recursive: true });
          const imagePath = imageDir + "/" + role + "-375-" +
            name.replace(/[^a-z0-9-]+/gi, "-") + ".png";
          try {
            await page.screenshot({ path: imagePath, animations: "disabled",
              caret: "hide", fullPage: false, scale: "css" });
            screenshot = imagePath;
          } catch (error) {
            findings.push({ kind: "mobile visual contract",
              detail: "Screenshot capture failed: " + safeText(error.message) });
          }
        }
        // Observe all actual error-toast families rather than keyword-matching
        // the benign body copy of a payroll screen.
        const alerts = await page.locator(ERROR_SELECTOR).allTextContents();
        const readinessFallback = alerts.some(message =>
          message.includes("Workspace readiness unavailable.") &&
          message.includes("Readiness evidence is unavailable for this employer.") &&
          message.includes("No launch or pilot status has been verified."));
        for (const message of alerts.map(safeText).filter(Boolean)) {
          if (name === "Readiness" && readiness503 && readinessFallback &&
              message.includes("Workspace readiness unavailable.")) continue;
          findings.push({ kind: "visible error", detail: message });
        }
        if (name === "Readiness" && (!readiness503 || !readinessFallback))
          findings.push({ kind: "readiness fail-closed contract",
            detail: "Expected employer-scoped HTTP 503 and explicit no-launch-evidence fallback" });

        const loadTimeBlockedWrites = blocked;
        // Click only unambiguously non-destructive controls. A label not on the
        // safe vocabulary is explicitly SKIPPED, not silently marked tested.
        const controls = page.locator(".app-main button:visible, .app-main a:visible, .employee-workspace-body button:visible, .employee-workspace-body a:visible");
        // Element handles preserve the identity of originally visible controls.
        // Live nth() locators can point at a different button after React
        // changes the page or opens a dialog.
        const elements = (await controls.elementHandles()).slice(0, 220);
        const count = elements.length;
        async function closeSafeDialogs() {
          for (let attempt = 0; attempt < 3; attempt++) {
            const dialog = page.locator('[role="dialog"]:visible').last();
            if (!(await dialog.count())) return;
            const closer = dialog.locator('button.modal-close:visible, button[aria-label="Close"]:visible, button[aria-label="Dismiss"]:visible').first();
            if (await closer.count()) await closer.click({ timeout: 4000 });
            else await page.keyboard.press("Escape");
            if (!(await page.locator('[role="dialog"]:visible').count())) return;
          }
          throw new Error("An open dialog could not be dismissed using its visible close control.");
        }
        for (let index = 0; index < count; index++) {
          const el = elements[index];
          if (!(await el.evaluate(node => node.isConnected).catch(() => false))) {
            skipped.push("Detached control after prior interaction (index " + index + ")");
            continue;
          }
          if (!(await el.isVisible().catch(() => false)) || !(await el.isEnabled().catch(() => false))) {
            skipped.push("Control no longer visible or enabled (index " + index + ")");
            continue;
          }
          const label = safeText((await el.getAttribute("aria-label")) || (await el.textContent()) || (await el.getAttribute("title")));
          const href = await el.getAttribute("href");
          if (!label || DANGEROUS.test(label) || !SAFE_CONTROL.test(label) ||
              (href && (!href.startsWith("#") && !href.startsWith("/app")))) {
            skipped.push(label || "(unlabeled)"); continue;
          }
          try {
            await closeSafeDialogs();
            const beforeClickPage = await page.locator("[data-workspace-page]").first().getAttribute("data-workspace-page").catch(() => name);
            if (beforeClickPage !== name) {
              skipped.push((count - index) + " controls remaining after navigation to " + beforeClickPage);
              break;
            }
            if (!(await el.evaluate(node => node.isConnected).catch(() => false))) {
              skipped.push(label + " (detached during UI rerender)");
              continue;
            }
            await el.click({ timeout: 4000, noWaitAfter: true });
            await closeSafeDialogs();
            await page.keyboard.press("Escape").catch(() => {});
            const destination = await page.locator("[data-workspace-page]").first().getAttribute("data-workspace-page").catch(() => name);
            if (destination !== name) {
              skipped.push((count - index - 1) + " controls remaining after navigation to " + destination);
              break;
            }
          } catch (error) {
            if (!(await el.evaluate(node => node.isConnected).catch(() => false))) {
              skipped.push(label + " (detached during React update)");
              continue;
            }
            const geometry = await el.evaluate(node => {
              const rect = node.getBoundingClientRect();
              const x = rect.x + rect.width / 2, y = rect.y + rect.height / 2;
              const top = document.elementFromPoint(x, y);
              return { x: Math.round(x), y: Math.round(y),
                width: Math.round(rect.width), height: Math.round(rect.height),
                elementAtCenter: top?.tagName ?? null,
                centerWithinControl: top === node || node.contains(top) };
            }).catch(() => null);
            findings.push({ kind: "dead control", detail: label + ": " +
              safeText(error.message) + (geometry ? " / " + JSON.stringify(geometry) : "") });
          }
        }
        if (loadTimeBlockedWrites) findings.push({ kind: "unsafe background write", detail: loadTimeBlockedWrites + " write requests attempted during page loading" });
        if (blocked > loadTimeBlockedWrites) skipped.push((blocked - loadTimeBlockedWrites) + " unsafe click write request(s) blocked before reaching server");
      } catch (e) {
        findings.push({ kind: "navigation", detail: safeText(e.stack ?? e.message ?? String(e)) });
      }
      findings.push(...errors.slice(before).map(({ kind, detail }) => ({ kind, detail })));
      if (findings.length && !screenshot) {
        const screenshots = dir + "/screenshots";
        mkdirSync(screenshots, { recursive: true });
        const file = screenshots + "/" + role + "-" + width + "-" +
          name.replace(/[^a-z0-9-]+/gi, "-") + ".png";
        try { await page.screenshot({ path: file, animations: "disabled" }); screenshot = file; }
        catch { /* Keep the log even if the browser cannot capture a screenshot. */ }
      }
      const result = { role, page: name, viewport: width, result: findings.length ? "FAIL" : "PASS",
        elapsedMs: Date.now() - started, findings, screenshot, skippedControls: skipped.length,
        skippedExamples: [...new Set(skipped)].slice(0, 10) };
      results.push(result);
      console.log("NAV_SWEEP " + result.result + " " + role + " " + width + "px " + name +
        (findings.length ? " :: " + findings.map(f => f.kind + ": " + f.detail).join(" | ") : ""));
      // The next destination gets a fresh load in its own reporting window.
    }
  } finally { await context.close(); }
}

test("read-only navigation and runtime error sweep (real roles, both viewports)", { timeout: 3600000 }, async () => {
  let activeRole = "setup";
  let activeViewport = 0;
  try {
    for (const { role, pages: allPages } of manifest.roles) {
      if (proofOnly && role !== "owner") continue;
      if (focusRole && role !== focusRole) continue;
      activeRole = role;
      // A role-login failure is not the previous role's last 390px viewport.
      activeViewport = 0;
      const pages = proofOnly ? ["Overview"] : focusPage
        ? allPages.filter(name => name === focusPage) : allPages;
      assert.ok(pages.length, "Requested focus page is not in role navigation: " + role + "/" + focusPage);
      // Start with a fresh Chromium session for this synthetic role, then
      // rotate the process between desktop and phone scans. Only storageState
      // survives the rotation; browser memory and pages do not.
      // Retry only pre-scan infrastructure shutdown, never an app failure.
      const started = await startNavSweepRoleBrowser({
        role,
        launch: () => chromium.launch({ headless: true }),
        authenticate: login,
        onRetry: (event) => {
          startupRetries.push(event);
          console.warn("NAV_SWEEP_STARTUP_RETRY " + event.role +
            " one clean retry after browser closure: " + event.reason);
        },
      });
      let browser = started.browser;
      try {
        for (const [index, width] of (proofOnly ? [1280] : sweepViewports).entries()) {
          activeViewport = width;
          if (index > 0) {
            await browser.close();
            browser = await startNavSweepViewportBrowser({
              role, viewport: width, storageState: started.state,
              launch: () => chromium.launch({ headless: true }),
              onRetry: (event) => {
                startupRetries.push(event);
                console.warn("NAV_SWEEP_STARTUP_RETRY " + event.role + " " + event.viewport +
                  "px one clean retry before scanning: " + event.reason);
              },
            });
          }
          await checkRole(browser, role, width, started.state, pages);
        }
      } finally {
        try { await browser.close(); } catch { /* Browser already exited; sweep remains a failure. */ }
      }
    }
  } catch (error) {
    // Preserve a FAIL in the artifact even if the browser process dies. Previously
    // the report could show "238 passed / 0 failed" for an incomplete sweep.
    const detail = safeText(error?.stack ?? error?.message ?? String(error));
    results.push({ role: activeRole, page: "SWEEP_INFRASTRUCTURE",
      viewport: activeViewport, result: "FAIL", elapsedMs: 0,
      findings: [{ kind: "infrastructure", detail }], screenshot: null,
      skippedControls: 0, skippedExamples: [] });
    console.error("NAV_SWEEP_INFRASTRUCTURE_FAIL " + activeRole + " " + activeViewport + "px " + detail);
  } finally {
    // Even 230 individually passing checks are a failure if the complete role,
    // viewport and page manifest did not run. Reject omissions and duplicates.
    const expectedCases = manifest.roles
      .filter(({ role }) => (!proofOnly || role === "owner") && (!focusRole || role === focusRole))
      .flatMap(({ role, pages: allPages }) => {
        const pages = proofOnly ? ["Overview"] : focusPage
          ? allPages.filter(name => name === focusPage) : allPages;
        return (proofOnly ? [1280] : sweepViewports)
          .flatMap(width => pages.map(page => JSON.stringify([role, width, page])));
      });
    const observedCases = results
      .filter(row => row.page !== "SWEEP_INFRASTRUCTURE")
      .map(row => JSON.stringify([row.role, row.viewport, row.page]));
    const coverage = compareNavSweepCaseCoverage(expectedCases, observedCases);
    if (!expectedCases.length || coverage.missing.length || coverage.unexpected.length || coverage.duplicates.length) {
      const detail = JSON.stringify({
        expected: expectedCases.length,
        observed: observedCases.length,
        missing: coverage.missing.slice(0, 8),
        unexpected: coverage.unexpected.slice(0, 8),
        duplicates: coverage.duplicates.slice(0, 8),
      });
      results.push({ role: "SWEEP", page: "SWEEP_COVERAGE",
        viewport: 0, result: "FAIL", elapsedMs: 0,
        findings: [{ kind: "incomplete matrix", detail }], screenshot: null,
        skippedControls: 0, skippedExamples: [] });
      console.error("NAV_SWEEP_COVERAGE_FAIL " + detail);
    }
    const failed = results.filter(r => r.result === "FAIL");
    const report = {
      generatedAt: new Date().toISOString(), syntheticOnly: true, productionDataUsed: false,
      injectedFailure: broken, startupRetries,
      total: results.length, passed: results.length - failed.length,
      failed: failed.length, results,
    };
    writeFileSync(dir + "/report.json", JSON.stringify(report, null, 2));
    writeFileSync(dir + "/report.md", [
      "# PayrollPH navigation and runtime sweep", "",
      "Disposable PostgreSQL and fictional accounts only. No payroll submission or filing.", "",
      "Total: " + report.total + " | Pass: " + report.passed + " | Fail: " + report.failed, "",
      "| Role | Viewport | Page | Result | Failure details | Screenshot | Skipped controls |",
      "| --- | --- | --- | --- | --- | --- | --- |",
      ...results.map(r => "| " + r.role + " | " + r.viewport + "px | " +
        r.page.replaceAll("|", "/") + " | " + r.result + " | " +
        r.findings.map(f => f.kind + ": " + f.detail).join("; ").replaceAll("|", "/").replaceAll("\n", " ").slice(0, 400) +
        " | " + (r.screenshot ?? "—") + " | " + r.skippedControls + " |"),
    ].join("\n"));
    console.log("NAV_SWEEP_REPORT " + dir + "/report.md :: " + report.passed + " passed / " + report.failed + " failed");
  }
  assert.ok(results.length > 0, "Empty sweep is never green");
  assert.equal(results.filter(r => r.result === "FAIL").length, 0, "Runtime failures detected. Read report.md");
});
