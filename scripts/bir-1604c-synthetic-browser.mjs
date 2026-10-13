import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { chromium } from "playwright";
import { generateTotp } from "../src/lib/totp.ts";

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
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const base = "http://127.0.0.1:3000";
  const response = await context.request.post(base + "/api/auth/login", {
    headers: { origin: base, "sec-fetch-site": "same-origin" },
    data: {
      email: role + "@bir-qa.example.test",
      password: "Synthetic-BIR-Only-2026!",
      totpCode: generateTotp("JBSWY3DPEHPK3PXP"),
    },
  });
  assert.equal(response.status(), 200, role + " synthetic MFA authentication must succeed");
  return context;
}
function request(scope, mode, records, sourceDigest) {
  return { ...scope, mode, sourceDigest, records };
}
async function navigateCompliance(page, width) {
  await page.goto("http://127.0.0.1:3000/app?organizationId=" + fixture.organizationId, {
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
  await page.locator('[data-bir-1604c-candidate]').waitFor({ timeout: 60000 });
  await page.locator('[data-bir-v70-validation-status]').waitFor({ timeout: 60000 });
}

const scope = { organizationId: fixture.organizationId, legalEntityId: fixture.legalEntityId, taxYear: 2026 };
try {
  const owner = await login("owner");
  const get = await owner.request.get("http://127.0.0.1:3000/api/bir/annual-employer?organizationId=" +
    fixture.organizationId + "&legalEntityId=" + fixture.legalEntityId + "&taxYear=2026");
  assert.equal(get.status(), 200, "synthetic employer annual reconciliation GET");
  const report = (await get.json()).reconciliation;
  assert.equal(report.totals.blockers, 0);
  assert.equal(report.totals.employees, 1);
  assert.equal(report.totals.payrollActualWithheld, "5000.00");
  const sourceDigest = report.sourceDigest;

  const headersOn = { origin: "http://127.0.0.1:3000", "sec-fetch-site": "same-origin" };
  const headersOff = { origin: "http://127.0.0.1:3001", "sec-fetch-site": "same-origin" };
  const baseOn = "http://127.0.0.1:3000/api/bir/annual-employer/candidate";
  const baseOff = "http://127.0.0.1:3001/api/bir/annual-employer/candidate";

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
  assert.equal(row.fields.ACTUAL_AMT_WTHLD, "5000.00");

  // Explicit fictional amounts for a synthetic browser test. Do NOT reuse
  // these defaults in production; live values must come from verified 2316.
  for (const [field, value] of Object.entries(row.fields)) {
    if (value !== null) continue;
    const overrides = {
      REGION_NUM: "0001", EMPLOYMENT_FROM: "01/01/2026",
      EMPLOYMENT_TO: "12/31/2026", EMPLOYMENT_STATUS: "R",
      REASON_SEPARATION: "NA", SUBS_FILING: "Y",
      PRES_NONTAX_GROSS_COMP_INCOME: "100000.00",
      PRES_NONTAX_13TH_MONTH: "50000.00",
      PRES_TOTAL_NONTAX_COMP_INCOME: "100000.00",
      TAX_BASIC_SAL: "500000.00",
      PRES_TOTAL_COMP: "600000.00", GROSS_COMP_INCOME: "600000.00",
      PRES_TAX_WTHLD: "5000.00",
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

  const moduleStatus = await owner.request.get("http://127.0.0.1:3000/api/bir/annual-employer/module-evidence?" +
    "organizationId=" + fixture.organizationId + "&legalEntityId=" + fixture.legalEntityId + "&taxYear=2026");
  assert.equal(moduleStatus.status(), 200);
  assert.equal((await moduleStatus.json()).moduleV70.status, "not run");

  for (const width of [1280, 390]) {
    const context = await browser.newContext({
      viewport: { width, height: 900 },
      storageState: await owner.storageState(),
    });
    page = await context.newPage();
    await navigateCompliance(page, width);
    const root = page.locator('[data-bir-1604c-candidate]');
    assert.ok(await root.getByText("1604-C reviewed DAT candidate", { exact: false }).isVisible());
    assert.ok((await root.locator('[data-bir-v70-validation-status]').textContent()).includes("not run"));
    await root.screenshot({ path: outDir + "/year-end-bir-" + width + ".png" });
    const bounding = await root.evaluate(el => ({
      left: el.getBoundingClientRect().left, right: el.getBoundingClientRect().right,
      viewport: window.innerWidth,
    }));
    assert.ok(bounding.left >= -2 && bounding.right <= bounding.viewport + 2,
      "BIR panel must remain within " + width + "px viewport");
    results.push({ checkpoint: "compliance-year-end-" + width + "px", result: "pass", synthetic: true });
    await context.close();
  }
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
