import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { chromium } from "playwright";
import { generateTotp } from "../src/lib/totp.ts";
import { testPriorEvidence } from "./year-end-prior-browser.mjs";
import { test2316Certificate } from "./bir-2316-certificate-browser.mjs";

assert.equal(process.env.CI, "true");
assert.equal(process.env.BIR_SYNTHETIC_BROWSER_QA, "true");
assert.equal(new URL(process.env.DATABASE_URL ?? "").hostname, "127.0.0.1");
const fixture = JSON.parse(await readFile("/tmp/bir-1604c-qa-fixture.json", "utf8"));
const outDir = "qa-artifacts/bir-1604c";
await mkdir(outDir, { recursive: true });
const browser = await chromium.launch({ headless: true });
const results = [];
let page = null;
async function login(role) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, ignoreHTTPSErrors: true });
  const base = "https://127.0.0.1:3443";
  const response = await context.request.post(base + "/api/auth/login", {
    headers: { origin: base, "sec-fetch-site": "same-origin" },
    data: {
      email: role + "@bir-qa.example.test",
      password: "Synthetic-BIR-Only-2025!",
      totpCode: generateTotp("JBSWY3DPEHPK3PXP"),
    },
  });
  assert.equal(response.status(), 200, role + " synthetic MFA authentication must succeed");
  return context;
}
function request(scope, mode, records, sourceDigest) {
  return { ...scope, mode, sourceDigest, records };
}
async function navigateCompliance(page, width, base = "https://127.0.0.1:3443", enabled = true) {
  await page.goto(base + "/app?organizationId=" + fixture.organizationId, {
    waitUntil: "domcontentloaded",
  });
  await page.locator(".app-shell").waitFor({ timeout: 60000 });
  if (width === 390) {
    const navButton = page.getByRole("button", { name: "Open navigation" });
    if (await navButton.isVisible()) await navButton.click();
  }
  const nav = page.locator('[data-nav-name="Compliance"]').first();
  if (!(await nav.isVisible())) {
    const more = page.locator(".nav-more-toggle").first();
    if (await more.isVisible()) await more.click();
  }
  await nav.waitFor({ timeout: 60000 });
  await nav.click();
  await page.getByRole("heading", { name: "December tax adjustment (BIR 2316)" }).waitFor({ timeout: 60000 });
  if (enabled) {
    await page.locator('[data-bir-1604c-candidate]').waitFor({ timeout: 60000 });
    await page.locator('[data-bir-v70-validation-status]').waitFor({ timeout: 60000 });
  }
}

async function captureVisibleViewportElement(locator, page, label) {
  // React reconciles Year-End state after the initial page render. A successful
  // element lookup can become detached between scrolling and the screenshot.
  // Re-resolve the locator on each attempt instead of caching a stale node.
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      await locator.waitFor({ state: "visible", timeout: 12000 });
      await locator.evaluate(element =>
        element.scrollIntoView({ block: "center", inline: "nearest", behavior: "instant" }));
      const rect = await locator.boundingBox();
      if (rect && rect.y >= -2 && rect.y + rect.height <= 902) return rect;
    } catch (error) {
      if (!/not attached|detached|element is not attached/i.test(String(error))) throw error;
    }
    await page.waitForTimeout(200);
  }
  throw new Error("Expected " + label + " to be visible after stable Year-End rendering.");
}

const scope = { organizationId: fixture.organizationId, legalEntityId: fixture.legalEntityId, taxYear: 2025 };
try {
  const owner = await login("owner");
  const get = await owner.request.get("https://127.0.0.1:3443/api/bir/annual-employer?organizationId=" +
    fixture.organizationId + "&legalEntityId=" + fixture.legalEntityId + "&taxYear=2025");
  assert.equal(get.status(), 200, "synthetic employer annual reconciliation GET");
  const report = (await get.json()).reconciliation;
  assert.equal(report.totals.blockers, 0);
  assert.equal(report.totals.employees, 1);
  assert.equal(report.totals.payrollActualWithheld, "42500.00");
  const sourceDigest = report.sourceDigest;

  const headersOn = { origin: "https://127.0.0.1:3443", "sec-fetch-site": "same-origin" };
  const headersOff = { origin: "https://127.0.0.1:3444", "sec-fetch-site": "same-origin" };
  const baseOn = "https://127.0.0.1:3443/api/bir/annual-employer/candidate";
  const baseOff = "https://127.0.0.1:3444/api/bir/annual-employer/candidate";

  const templateResponse = await owner.request.post(baseOn, {
    headers: headersOn, data: request(scope, "template", [], sourceDigest),
  });
  assert.equal(templateResponse.status(), 200, "review worksheet must be available only when flag on");
  const template = await templateResponse.json();
  assert.equal(template.records.length, 1);
  const row = template.records[0];
  assert.equal(row.fields.TIN, "333222111");
  assert.equal(row.fields.REGION_NUM, null);
  assert.equal(row.fields.PRES_NONTAX_13TH_MONTH, null);
  assert.equal(row.fields.ACTUAL_AMT_WTHLD, "42500.00");

  // Explicit fictional amounts for a synthetic browser test. Do NOT reuse
  // these defaults in production; live values must come from verified 2316.
  for (const [field, value] of Object.entries(row.fields)) {
    if (value !== null) continue;
    const overrides = {
      REGION_NUM: "NCR", EMPLOYMENT_FROM: "01/01/2025",
      EMPLOYMENT_TO: "12/31/2025", EMPLOYMENT_STATUS: "R",
      REASON_SEPARATION: "NA", SUBS_FILING: "Y",
      PRES_NONTAX_GROSS_COMP_INCOME: "100000.00",
      PRES_NONTAX_13TH_MONTH: "50000.00",
      PRES_TOTAL_NONTAX_COMP_INCOME: "100000.00",
      TAX_BASIC_SAL: "500000.00",
      PRES_TOTAL_COMP: "600000.00", GROSS_COMP_INCOME: "600000.00",
      PRES_TAX_WTHLD: "42500.00",
    };
    row.fields[field] = overrides[field] ?? "0.00";
  }
  row.reviewedBy = "Synthetic only reviewer";
  row.sourceReference = "private-synthetic-reviewed-ledger";
  row.priorEmployerReview = "none-confirmed";
  delete row.missingManualFields;
  const previewResponse = await owner.request.post(baseOn, {
    headers: headersOn, data: request(scope, "check", [row], sourceDigest),
  });
  assert.equal(previewResponse.status(), 200, "locally reviewed synthetic candidate");
  const preview = await previewResponse.json();
  assert.equal(preview.validatedAgainstModuleV70, "not run");
  const download = await owner.request.post(baseOn, {
    headers: headersOn, data: request(scope, "download", [row], sourceDigest),
  });
  assert.equal(download.status(), 200, "synthetic draft DAT download");
  const body = await download.body();
  const sha = createHash("sha256").update(body).digest("hex");
  assert.equal(sha, preview.fileSha256);
  assert.equal(sha, download.headers()["x-bir-file-sha256"]);
  assert.match(body.toString("ascii"), /^H1604C,/);
  assert.match(body.toString("ascii"), /D1,/);
  assert.match(body.toString("ascii"), /C1,/);
  assert.ok(body.toString("ascii").endsWith("\r\n"));
  await mkdir(outDir + "/official-module-test-input", { recursive: true });
  await writeFile(outDir + "/official-module-test-input/" + preview.fileName, body);
  const savedBytes = await readFile(outDir + "/official-module-test-input/" + preview.fileName);
  assert.equal(createHash("sha256").update(savedBytes).digest("hex"), sha,
    "Exact browser DAT output must match the persisted test input");
  await writeFile(outDir + "/VALIDATION-MANIFEST.json", JSON.stringify({
    status: "SYNTHETIC ONLY â€” NEVER SUBMIT", sampleYear: 2025,
    primaryFile: "official-module-test-input/" + preview.fileName,
    sha256: sha, byteCount: body.length, sourceDigest,
    source: "PR 959 isolated browser acceptance",
    moduleVersion: null, moduleResult: "not run",
    independentReviewer: null, acceptedByBir: false, submittedToBir: false,
  }, null, 2));
  results.push({ checkpoint: "full-synthetic-DAT-check-and-download", result: "pass", sha256: sha });

  const tampered = structuredClone(row);
  tampered.fields.TIN = "999999999";
  const invalid = await owner.request.post(baseOn, {
    headers: headersOn, data: request(scope, "download", [tampered], sourceDigest),
  });
  assert.equal(invalid.status(), 422);
  assert.equal((await invalid.json()).code, "BIR_REVIEW_BLOCKED");
  results.push({ checkpoint: "employee-TIN-drift-blocks-download", result: "pass" });

  const stale = await owner.request.post(baseOn, {
    headers: headersOn, data: request(scope, "download", [row], "f".repeat(64)),
  });
  assert.equal(stale.status(), 422);
  results.push({ checkpoint: "stale-source-blocks-download", result: "pass" });

  const disabled = await owner.request.post(baseOff, {
    headers: headersOff, data: request(scope, "download", [row], sourceDigest),
  });
  assert.equal(disabled.status(), 404, "flag-off server must never return DAT");
  assert.equal((await disabled.json()).code, "BIR_DAT_CANDIDATE_DISABLED");
  results.push({ checkpoint: "default-off-DAT-blocked", result: "pass" });

  const employeeCtx = await login("employee");
  const forbidden = await employeeCtx.request.post(baseOn, {
    headers: headersOn, data: request(scope, "check", [row], sourceDigest),
  });
  assert.equal(forbidden.status(), 403, "employee cannot operate BIR 1604-C review");
  await employeeCtx.close();
  results.push({ checkpoint: "non-payroll-employee-denied", result: "pass" });

  const moduleStatus = await owner.request.get("https://127.0.0.1:3443/api/bir/annual-employer/module-evidence?" +
    "organizationId=" + fixture.organizationId + "&legalEntityId=" + fixture.legalEntityId + "&taxYear=2025");
  assert.equal(moduleStatus.status(), 200);
  assert.equal((await moduleStatus.json()).moduleV70.status, "not run");

  for (const width of [1280, 390]) {
    const context = await browser.newContext({
      viewport: { width, height: 900 }, ignoreHTTPSErrors: true,
      storageState: await owner.storageState(),
    });
    page = await context.newPage();
    await navigateCompliance(page, width);
    const root = page.locator('[data-bir-1604c-candidate]');
    assert.ok(await root.getByText("1604-C reviewed DAT candidate", { exact: false }).isVisible());
    const verifiedStatus = root.locator('[data-bir-v70-validation-status]');
    // Wait for the authenticated, scoped evidence GET: neither the loading
    // nor unavailable state contains these verified-only status elements.
    await verifiedStatus.locator("strong").first().waitFor({ state: "visible", timeout: 30000 });
    const verifiedText = await verifiedStatus.textContent();
    assert.match(verifiedText ?? "", /Validated against BIR Alphalist Module v7\.0:\s*not run/);
    assert.match(verifiedText ?? "", /For v7\.4:\s*not run/);
    // The Year-End panel is taller than a 900px viewport. Scroll to the
    // heading itself: asserting the root's top is on-screen is incorrect once
    // its internal content overflows the viewport vertically.
    const heading = root.locator("h3").first();
    const headingBounds = await captureVisibleViewportElement(heading, page, "BIR heading");
    const bounding = await root.evaluate(el => {
      const rect = el.getBoundingClientRect();
      const descendants = [...el.querySelectorAll("*")];
      return {
        left: rect.left, right: rect.right,
        viewport: window.innerWidth,
        childMaxRight: Math.max(rect.right, ...descendants.map(node => node.getBoundingClientRect().right)),
      };
    });

    assert.equal(bounding.viewport, width, "Expected exact mobile/desktop browser viewport");
    assert.ok(bounding.left >= -2 && bounding.right <= width + 2 &&
      bounding.childMaxRight <= width + 2,
      "BIR panel or child overflows " + width + "px viewport");
    assert.ok(headingBounds && headingBounds.y >= -2 &&
      headingBounds.y + headingBounds.height <= 902,
      "BIR heading must actually be visible in the captured viewport");
    await page.screenshot({ path: outDir + "/year-end-bir-" + width + ".png", fullPage: false });
    const status = root.locator('[data-bir-v70-validation-status]');
    const statusBounds = await captureVisibleViewportElement(status, page, "BIR validator status");
    assert.ok(statusBounds && statusBounds.y >= -2 &&
      statusBounds.y + statusBounds.height <= 902,
      "BIR validator status must actually be visible in its screenshot");
    await page.screenshot({ path: outDir + "/year-end-bir-status-" + width + ".png", fullPage: false });
    results.push({ checkpoint: "compliance-year-end-" + width + "px", result: "pass", synthetic: true });
    await context.close();
  }
  for (const width of [1280, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 900 },
      ignoreHTTPSErrors: true, storageState: await owner.storageState() });
    page = await context.newPage();
    const evidenceRequests = [];
    page.on("request", request => {
      if (request.url().includes("/api/bir/annual-employer/module-evidence")) evidenceRequests.push(request.url());
    });
    const legacyLoaded = page.waitForResponse(response => response.url().includes("/api/year-end?") && response.request().method() === "GET");
    await navigateCompliance(page, width, "https://127.0.0.1:3444", false);
    assert.equal((await legacyLoaded).status(), 200, "Disabled candidate preserves authorized legacy year-end reads");
    assert.equal(await page.locator('[data-bir-1604c-candidate]').count(), 0);
    assert.equal(evidenceRequests.length, 0, "Disabled panel must not read new evidence endpoints");
    assert.equal(await page.getByRole("link", { name: "Prepare unsigned PDF" }).count(), 0, "Default-off preserves existing navigation");
    await page.screenshot({ path: outDir + "/year-end-flag-off-" + width + ".png", fullPage: false });
    results.push({ checkpoint: "flag-off-legacy-year-end-" + width + "px", result: "pass", evidenceRequests: 0 });
    await context.close();
  }
  // Execute the actual authenticated printable 2316 route in both flag modes.
  for (const enabled of [true, false]) {
    const base = enabled ? "https://127.0.0.1:3443" : "https://127.0.0.1:3444";
    const url = base + "/api/year-end?format=2316-print&organizationId=" + fixture.organizationId + "&taxYear=2025&employeeId=" + fixture.employeeId;
    const response = await owner.request.get(url);
    assert.equal(response.status(), 200, "2316 review uses authorized exact employee source");
    assert.match(response.headers()["cache-control"], /no-store/, "framework response must prevent browser and shared-cache storage");
    const html = await response.text();
    assert.equal(html.includes("data-bir-2316-reconciliation"), enabled);
    if (enabled) {
      assert.doesNotMatch(html, /SETTLEMENT_UNVERIFIED/);
      assert.match(html, /Item 25A[^<]*<\/dt><dd>42,500\.00/);
      assert.match(html, /PREVIOUS_EMPLOYER_UNVERIFIED/);
      assert.match(html, /REQUIRES VERIFIED SOURCE/);
    }
    for (const width of [1280, 390]) {
      const context = await browser.newContext({ viewport: { width, height: 900 }, ignoreHTTPSErrors: true, storageState: await owner.storageState() });
      const reviewPage = await context.newPage();
      await reviewPage.goto(url);
      assert.equal(await reviewPage.locator("[data-bir-2316-reconciliation]").count(), enabled ? 1 : 0);
      if (enabled) await reviewPage.locator("[data-bir-2316-reconciliation]").scrollIntoViewIfNeeded();
      await reviewPage.screenshot({ path: outDir + "/2316-review-" + (enabled ? "on-" : "off-") + width + ".png", fullPage: true });
      await context.close();
    }
    const reviewEmployee = await login("employee");
    const denied = await reviewEmployee.request.get(url);
    assert.equal(denied.status(), 403, "non-payroll employee cannot access 2316 review");
    const finalUrl = base + "/api/separation/" + fixture.separationId + "/2316";
    const finalResponse = await owner.request.get(finalUrl);
    assert.equal(finalResponse.status(), 200);
    const finalText = await finalResponse.text();
    assert.match(finalResponse.headers()["cache-control"], /no-store/);
    if (enabled) {
      assert.match(finalText, /UNSETTLED_ADJUSTMENT/);
      const actualLine = finalText.split("\n").find(line => line.includes("Item 25A"));
      assert.ok(actualLine.includes(Number(fixture.actualFinalWithheld).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })));
      const unpaidLine = finalText.split("\n").find(line => line.includes("Uncollected tax adjustment"));
      assert.ok(unpaidLine.includes(Number(fixture.uncollectedTax).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })));
    } else assert.ok(!finalText.includes("Uncollected tax adjustment"));
    assert.equal((await reviewEmployee.request.get(finalUrl)).status(), 403);
    await reviewEmployee.close();
    results.push({ checkpoint: "2316-review-" + (enabled ? "on" : "off"), result: "pass", widths: [1280, 390], sourceStatusDoesNotProveSettlement: true });
  }
  await test2316Certificate({ browser, owner, fixture, outDir, results });
  const certificateEmployee = await login("employee");
  assert.equal((await certificateEmployee.request.get("https://127.0.0.1:3443/api/year-end/2316-certificate?organizationId=" + fixture.organizationId + "&employeeId=" + fixture.employeeId + "&taxYear=2025")).status(), 403);
  await certificateEmployee.close();
  const priorChecker = await login("payroll");
  const priorEmployee = await login("employee");
  await testPriorEvidence({ browser, owner, checker: priorChecker, employee: priorEmployee, fixture, outDir, results });
  await priorChecker.close(); await priorEmployee.close();
  await owner.close();
  await writeFile(outDir + "/results.json", JSON.stringify({
    status: "PASS", syntheticOnly: true, validatedByBir: false,
    agencyAccepted: false, headSha: process.env.GITHUB_SHA, results,
  }, null, 2));
} catch (error) {
  await page?.screenshot({ path: outDir + "/failure.png", fullPage: true }).catch(() => {});
  throw error;
} finally {
  await browser.close();
}
