/** Authenticated, fictional-only document lifecycle screenshots at 1440/390px.
 * No session cookies, links containing signatures or real files are saved. */
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { chromium } from "playwright";

const BASE = "http://127.0.0.1:3000";
const out = "qa-artifacts/employee-vault-profile";
assert.equal(process.env.CI, "true");
assert.equal(process.env.GITHUB_ACTIONS, "true");
assert.equal(process.env.EMPLOYEE_VAULT_BROWSER_ACCEPTANCE_MODE, "synthetic-postgres-only");
assert.equal(process.env.OPENAI_API_KEY ?? "", "");
assert.equal(process.env.EMPLOYEE_DOCUMENT_VAULT_ENABLED, "true");
assert.equal(process.env.DOCUMENT_OBJECT_STORAGE_ENDPOINT, "http://127.0.0.1:9000/");
const url = new URL(process.env.DATABASE_URL ?? "");
assert.equal(url.hostname, "127.0.0.1");
assert.equal(url.pathname, "/app_db");
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
const checks = [];

async function login(context, email) {
  const result = await context.request.post(BASE + "/api/auth/login", {
    headers: { origin: BASE, "sec-fetch-site": "same-origin" },
    data: { email, password: "Synthetic-HCM-QA-Password-Only-2026!" },
    failOnStatusCode: false,
  });
  assert.equal(result.status(), 200, "Synthetic login failed");
}

async function exercise(width) {
  const context = await browser.newContext({ viewport: { width, height: 940 }, acceptDownloads: true });
  await login(context, "hcm-hr@example.test");
  const page = await context.newPage();
  const response = await page.goto(BASE + "/hcm/worker-360?organizationId=1&employeeId=1", {
    waitUntil: "domcontentloaded", timeout: 90_000,
  });
  assert.equal(response?.status(), 200, "Worker 360 must be available to synthetic HR");
  const panel = page.getByRole("region", { name: "Employee documents" });
  await panel.waitFor({ timeout: 90_000 });
  await panel.getByText("No active employee documents.").waitFor({ timeout: 90_000 });
  const files = page.getByRole("list", { name: "Employee documents" });
  const pdf = Buffer.from("%PDF-1.7\n% fictional contract only\n1 0 obj <<>> endobj\n%%EOF");
  await panel.getByRole("combobox", { name: "Category" }).selectOption("contract");
  await panel.getByLabel("File", { exact: true }).setInputFiles({
    name: "synthetic-contract.pdf", mimeType: "application/pdf", buffer: pdf,
  });
  await panel.getByRole("button", { name: "Upload", exact: true }).click();
  await panel.getByText("Document scanned and stored in the private employee vault.").waitFor({
    timeout: 90_000,
  });
  await files.getByText("synthetic-contract.pdf").waitFor({ timeout: 90_000 });
  await panel.screenshot({ path: out + "/" + width + "-upload.png" });

  const view = files.getByRole("link", { name: "View" });
  const href = await view.getAttribute("href");
  assert.match(href ?? "", /^\/api\/documents\/[1-9]\d*$/);
  const id = Number(href.split("/").pop());
  const viewed = await context.request.get(BASE + href, { maxRedirects: 5 });
  assert.equal(viewed.status(), 200, "Authorized signed-GET PDF view");
  assert.deepEqual(Buffer.from(await viewed.body()), pdf, "Private viewed bytes must match scanned upload");
  // Capture the real document panel after the authorized view; do not save
  // presigned URLs or browser context/session state to artifacts.
  await view.focus();
  await panel.screenshot({ path: out + "/" + width + "-view.png" });
  // 390px must remain scroll-free with the document row and all action controls
  // present. A check only after Delete missed a real earlier regression.
  const visibleFileLayout = await page.evaluate(() => ({
    viewport: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
  }));
  assert.equal(visibleFileLayout.viewport, width);
  assert.ok(visibleFileLayout.documentWidth <= width + 1,
    "Document row overflow while visible at " + width + "px: " + JSON.stringify(visibleFileLayout));


  const downloaded = await context.request.get(BASE + href + "?download=1", { maxRedirects: 5 });
  assert.equal(downloaded.status(), 200, "Authenticated private download");
  assert.match(downloaded.headers()["content-disposition"] ?? "", /attachment.*synthetic-contract\.pdf/i);
  assert.deepEqual(Buffer.from(await downloaded.body()), pdf);
  const [attachment] = await Promise.all([
    page.waitForEvent("download", { timeout: 30_000 }),
    files.getByRole("link", { name: "Download" }).click(),
  ]);
  assert.equal(attachment.suggestedFilename(), "synthetic-contract.pdf");
  const downloadedBytes = await readFile(await attachment.path());
  assert.deepEqual(downloadedBytes, pdf);

  await files.getByRole("button", { name: "Delete" }).click();
  await files.getByRole("button", { name: "Confirm" }).click();
  await panel.getByText("No active employee documents.").waitFor({ timeout: 90_000 });
  await panel.screenshot({ path: out + "/" + width + "-delete.png" });
  const noLongerViewable = await context.request.get(BASE + href, { maxRedirects: 0 });
  assert.equal(noLongerViewable.status(), 404, "Removed file cannot mint a fresh signed GET");
  const dimensions = await page.evaluate(() => ({
    width: window.innerWidth, scrollWidth: document.documentElement.scrollWidth,
  }));
  assert.ok(dimensions.scrollWidth <= dimensions.width + 1,
    "Horizontal overflow at " + width + "px: " + JSON.stringify(dimensions));
  checks.push({ width, upload: true, view: true, download: true, removal: true,
    noOverflow: true, noOverflowWithDocument: true, viewAfterRemovalDenied: true });
  await context.close();
}

try {
  await exercise(1440);
  await exercise(390);
  for (const email of ["hcm-manager@example.test", "hcm-payroll@example.test", "hcm-checker@example.test"]) {
    const context = await browser.newContext();
    await login(context, email);
    const result = await context.request.get(BASE + "/api/employee-vault?organizationId=1&employeeId=1");
    assert.equal(result.status(), 403, "Unauthorized role cannot list 201 files");
    await context.close();
  }
  const hr = await browser.newContext();
  await login(hr, "hcm-hr@example.test");
  const crossTenant = await hr.request.get(BASE + "/api/employee-vault?organizationId=1&employeeId=2");
  assert.equal(crossTenant.status(), 404, "Foreign employer worker in local tenant must not resolve");
  await hr.close();
  await writeFile(out + "/synthetic-acceptance.json", JSON.stringify({
    result: "PASS", checks, wrongRolesDenied: true, wrongTenantDenied: true,
    syntheticOnly: true, productionEnabled: false, storageProviderApproved: false,
  }, null, 2), { mode: 0o600 });
  console.log("PASS synthetic vault desktop/390px screenshots, stored PDF view/download, removal, role/tenant denials.");
} finally {
  await browser.close();
}
