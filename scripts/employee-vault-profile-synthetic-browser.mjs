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

  // Use a genuinely authenticated, linked synthetic ESS identity rather than
  // assuming that an HR view proves employee self-service isolation.
  const ess = await browser.newContext();
  try {
    await login(ess, "hcm-employee@example.test");
    const own = await ess.request.get(BASE + "/api/employee-vault?organizationId=1&employeeId=1");
    assert.equal(own.status(), 200, "Linked ESS worker can list own documents");
    const ownBody = await own.json();
    assert.equal(ownBody.organizationId, 1);
    assert.equal(ownBody.employeeId, 1);
    assert.ok(ownBody.documents.some(item => item.id === id), "Own PDF must appear in ESS list");
    const ownView = await ess.request.get(BASE + href, { maxRedirects: 5 });
    assert.equal(ownView.status(), 200, "Employee can view only own private PDF");
    assert.deepEqual(Buffer.from(await ownView.body()), pdf);
    const foreign = await ess.request.get(BASE + "/api/employee-vault?organizationId=2&employeeId=2");
    assert.ok([403, 404].includes(foreign.status()), "ESS must be denied foreign employer records");
  } finally {
    await ess.close();
  }
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
    noOverflow: true, noOverflowWithDocument: true, viewAfterRemovalDenied: true,
    employeeSelfAccess: true, foreignEmployeeDenied: true });
  await context.close();
}

try {
  await exercise(1440);
  await exercise(390);
  for (const email of [
    "hcm-manager@example.test", "hcm-payroll@example.test",
    "hcm-checker@example.test", "hcm-denied@example.test",
    "hcm-unit@example.test",
  ]) {
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
  const beta = await hr.request.get(BASE + "/api/employee-vault?organizationId=2&employeeId=2");
  assert.equal(beta.status(), 200, "Authorized HR can select the second fictional employer");
  const betaBody = await beta.json();
  assert.equal(betaBody.organizationId, 2);
  assert.equal(betaBody.employeeId, 2);
  assert.deepEqual(betaBody.documents, [], "Tenant B cannot inherit Tenant A's documents");

  // Exercise the real multipart HTTP gate with fictional bytes; this must
  // reject forged content, invalid category and cross-site mutations before
  // creating a scanned document or any private S3 object.
  const negativeUpload = async ({ name, buffer, kind = "contract", origin = BASE, site = "same-origin" }) =>
    hr.request.post(BASE + "/api/documents", {
      headers: { origin, "sec-fetch-site": site },
      multipart: {
        organizationId: "1", employeeId: "1", kind,
        file: { name, mimeType: "application/pdf", buffer },
      },
      failOnStatusCode: false,
    });
  const fake = await negativeUpload({
    name: "forged-contract.pdf", buffer: Buffer.from("NOT A PDF, SYNTHETIC ONLY"),
  });
  assert.equal(fake.status(), 422, "Forged PDF bytes must be rejected");
  const category = await negativeUpload({
    name: "test-contract.pdf", buffer: Buffer.from("%PDF-1.7\\nsynthetic test"),
    kind: "unknown_kind",
  });
  assert.equal(category.status(), 422, "Unknown document category must be rejected");
  const origin = await negativeUpload({
    name: "test-contract.pdf", buffer: Buffer.from("%PDF-1.7\\nsynthetic test"),
    origin: "https://attacker.example.invalid", site: "cross-site",
  });
  assert.equal(origin.status(), 403, "Cross-origin upload mutation must be rejected");
  const after = await hr.request.get(BASE + "/api/employee-vault?organizationId=1&employeeId=1");
  assert.equal(after.status(), 200);
  assert.deepEqual((await after.json()).documents, [], "Rejected uploads must create no active document");
  await hr.close();
  await writeFile(out + "/synthetic-acceptance.json", JSON.stringify({
    result: "PASS", checks, wrongRolesDenied: true, wrongTenantDenied: true,
    restrictedHrDenied: true, linkedEssReadProven: true, authorizedTenantSwitchScoped: true,
    forgedFileDenied: true, invalidCategoryDenied: true, crossSiteMutationDenied: true,
    syntheticOnly: true, productionEnabled: false, storageProviderApproved: false,
  }, null, 2), { mode: 0o600 });
  console.log("PASS synthetic vault desktop/390px, linked ESS, HR scope/tenant switch, upload/download/removal and negative upload/origin gates.");
} finally {
  await browser.close();
}
