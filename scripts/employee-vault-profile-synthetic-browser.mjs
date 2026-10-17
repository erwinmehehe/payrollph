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
// Keep fictional session cookies strictly in process memory; never persist
// browser storage state, credentials, or cookies in the screenshot artifact.
// Reuse one real login per identity so this extended acceptance suite respects
// the application's unchanged 10-logins-per-minute IP security policy.
const loginCookies = new Map();

async function login(context, email) {
  const existing = loginCookies.get(email);
  if (existing) {
    await context.addCookies(existing);
    return;
  }
  const result = await context.request.post(BASE + "/api/auth/login", {
    headers: { origin: BASE, "sec-fetch-site": "same-origin" },
    data: { email, password: "Synthetic-HCM-QA-Password-Only-2026!" },
    failOnStatusCode: false,
  });
  assert.equal(result.status(), 200, "Synthetic login failed for " + email);
  const cookies = await context.cookies(BASE);
  assert.ok(cookies.length > 0, "Synthetic sign-in must set a browser session");
  loginCookies.set(email, cookies);
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

  // Mobile touch controls must be usable while an actual file row is visible.
  if (width === 390) {
    const touchTargets = [
      ["Refresh", panel.getByRole("button", { name: "Refresh" })],
      ["Category", panel.getByRole("combobox", { name: "Category" })],
      ["File", panel.getByLabel("File", { exact: true })],
      ["Upload", panel.getByRole("button", { name: "Upload", exact: true })],
      ["View", files.getByRole("link", { name: "View" })],
      ["Download", files.getByRole("link", { name: "Download" })],
      ["Delete", files.getByRole("button", { name: "Delete" })],
    ];
    for (const [name, control] of touchTargets) {
      const rect = await control.boundingBox();
      assert.ok(rect && rect.width >= 43 && rect.height >= 43,
        name + " must have a usable 44px-class touch target at 390px");
    }
  }

  const view = files.getByRole("link", { name: "View" });
  const href = await view.getAttribute("href");
  assert.match(href ?? "", /^\/api\/documents\/[1-9]\d*$/);
  const id = Number(href.split("/").pop());
  const viewed = await context.request.get(BASE + href, { maxRedirects: 5 });
  assert.equal(viewed.status(), 200, "Authorized signed-GET PDF view");
  assert.deepEqual(Buffer.from(await viewed.body()), pdf, "Private viewed bytes must match scanned upload");

  // A guessed direct object URL must never bypass authentication or role checks.
  const anonymous = await browser.newContext();
  try {
    const guessed = await anonymous.request.get(BASE + href, { maxRedirects: 0 });
    assert.equal(guessed.status(), 401, "Unauthenticated direct document GET must fail");
  } finally {
    await anonymous.close();
  }
  const manager = await browser.newContext();
  try {
    await login(manager, "hcm-manager@example.test");
    const guessed = await manager.request.get(BASE + href, { maxRedirects: 0 });
    assert.ok([403, 404].includes(guessed.status()),
      "Non-People manager cannot use guessed direct document URL");
  } finally {
    await manager.close();
  }

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
  // This is diagnostic only: the test server uses Next dev, whose own
  // development overlay is not proof of a production UI defect.
  const developmentOverlayObserved = await page.evaluate(() =>
    [...document.querySelectorAll("nextjs-portal")].some(portal =>
      /\b\d+\s+Issues?\b/.test(portal.shadowRoot?.textContent ?? "")));
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
  // Fully decodable fictional 1x1 PNG/JPEG pixels exercise upload, scanning,
  // private signed read, metadata, and guarded removal (not just PDF magic).
  if (width === 1440) {
    const imageCases = [
      {
        filename: "synthetic-government-id.png", category: "government_id",
        mime: "image/png", type: "png",
        bytes: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNQjeoHAAG2AQ9xVRxuAAAAAElFTkSuQmCC", "base64"),
      },
      {
        filename: "synthetic-onboarding-photo.jpg", category: "onboarding",
        mime: "image/jpeg", type: "jpeg",
        bytes: Buffer.from([
          "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAoHBwgHBgoICAgLCgoLDhgQDg0NDh0V",
          "FhEYIx8lJCIfIiEmKzcvJik0KSEiMEExNDk7Pj4+JS5ESUM8SDc9Pjv/2wBDAQoL",
          "Cw4NDhwQEBw7KCIoOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7",
          "Ozs7Ozs7Ozs7Ozs7Ozv/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAA",
          "AAAAAAAAAAb/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAA",
          "AAAABv/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AJkAiHn/2Q=="
        ].join(""), "base64"),
      },
    ];
    for (const image of imageCases) {
      // Byte signatures alone cannot guarantee a usable image. Decode these
      // fictional test pixels in Chromium before private upload.
      const decoded = await page.evaluate(({ mime, data }) => new Promise((resolve, reject) => {
        const bitmap = new Image();
        bitmap.onload = () => resolve({ width: bitmap.naturalWidth, height: bitmap.naturalHeight });
        bitmap.onerror = () => reject(new Error("Synthetic image is not browser-decodable"));
        bitmap.src = "data:" + mime + ";base64," + data;
      }), { mime: image.mime, data: image.bytes.toString("base64") });
      assert.deepEqual(decoded, { width: 1, height: 1 },
        image.filename + " must decode as a 1x1 pixel");
      await panel.getByRole("combobox", { name: "Category" }).selectOption(image.category);
      await panel.getByLabel("File", { exact: true }).setInputFiles({
        name: image.filename, mimeType: image.mime, buffer: image.bytes,
      });
      await panel.getByRole("button", { name: "Upload", exact: true }).click();
      const row = files.getByRole("listitem").filter({ hasText: image.filename });
      await row.waitFor({ timeout: 90_000 });
      const listing = await context.request.get(BASE + "/api/employee-vault?organizationId=1&employeeId=1");
      assert.equal(listing.status(), 200);
      const record = (await listing.json()).documents.find(d => d.fileName === image.filename);
      assert.ok(record, "New image must be listed");
      assert.equal(record.kind, image.category, "Image category must persist");
      assert.equal(record.mimeType, image.mime, "Verified MIME must persist");
      assert.equal(record.canRemove, true);
      assert.ok(record.uploadedAt && record.uploadedBy);
      await panel.screenshot({ path: out + "/1440-" + image.type + "-upload.png" });
      const imageHref = await row.getByRole("link", { name: "View" }).getAttribute("href");
      assert.match(imageHref ?? "", /^\/api\/documents\/[1-9]\d*$/);
      const viewImage = await context.request.get(BASE + imageHref, { maxRedirects: 5 });
      assert.equal(viewImage.status(), 200);
      assert.deepEqual(Buffer.from(await viewImage.body()), image.bytes);
      await row.getByRole("button", { name: "Delete" }).click();
      await row.getByRole("button", { name: "Confirm" }).click();
      await row.waitFor({ state: "detached", timeout: 90_000 });
      const oldView = await context.request.get(BASE + imageHref, { maxRedirects: 0 });
      assert.equal(oldView.status(), 404, "Removed image must not mint fresh read URL");
    }
  }

  checks.push({ width, upload: true, view: true, download: true, removal: true,
    noOverflow: true, noOverflowWithDocument: true, viewAfterRemovalDenied: true,
    employeeSelfAccess: true, foreignEmployeeDenied: true,
    directAnonymousAndManagerReadsDenied: true, touchTargetsChecked: width === 390,
    developmentOverlayObserved });
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
  const negativeUpload = async ({ name, buffer, kind = "contract", origin = BASE,
    site = "same-origin", mimeType = "application/pdf" }) =>
    hr.request.post(BASE + "/api/documents", {
      headers: { origin, "sec-fetch-site": site },
      multipart: {
        organizationId: "1", employeeId: "1", kind,
        file: { name, mimeType, buffer },
      },
      failOnStatusCode: false,
    });
  const fake = await negativeUpload({
    name: "forged-contract.pdf", buffer: Buffer.from("NOT A PDF, SYNTHETIC ONLY"),
  });
  assert.equal(fake.status(), 422, "Forged PDF bytes must be rejected");
  const misdeclared = await negativeUpload({
    name: "mismatch.jpg", mimeType: "image/jpeg",
    buffer: Buffer.from("%PDF-1.7\\nnot really a JPEG"),
  });
  assert.equal(misdeclared.status(), 422, "Spoofed JPEG MIME must be rejected");
  const simulatedThreat = await negativeUpload({
    name: "synthetic-threat.pdf",
    buffer: Buffer.from("%PDF-1.7\\nFICTIONAL TEST SIGNATURE ONLY"),
  });
  assert.equal(simulatedThreat.status(), 422, "Scanner-flagged file must be rejected");
  assert.equal((await simulatedThreat.json()).code, "MALWARE_DETECTED",
    "Scanner refusal must preserve its rejection contract");
  const oversized = await negativeUpload({
    name: "oversized.pdf", buffer: Buffer.concat([
      Buffer.from("%PDF-1.7\\n"), Buffer.alloc(5 * 1024 * 1024),
    ]),
  });
  assert.equal(oversized.status(), 413, "Over-5MB multipart upload must be rejected");
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
    forgedFileDenied: true, mismatchedMimeDenied: true, syntheticScannerThreatDenied: true,
    oversizedMultipartDenied: true,
    pngJpegPrivateLifecycle: true, unauthenticatedDirectReadDenied: true,
    managerDirectReadDenied: true, mobileTouchTargetsChecked: true,
    invalidCategoryDenied: true, crossSiteMutationDenied: true,
    syntheticOnly: true, productionEnabled: false, storageProviderApproved: false,
  }, null, 2), { mode: 0o600 });
  console.log("PASS synthetic vault desktop/390px, PDF/PNG/JPEG private lifecycle, ESS, HR scope, mobile touch targets and negative upload/origin gates.");
} finally {
  loginCookies.clear();
  await browser.close();
}
