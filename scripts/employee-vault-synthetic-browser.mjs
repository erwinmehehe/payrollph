/**
 * Actual localhost Next.js + PostgreSQL + private MinIO + fictional scanner,
 * Chromium-authenticated A-5 vault HTTP + 1440/390px screenshot acceptance.
 * This is SYNTHETIC provider evidence, never real vendor/DPO sign-off.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { chromium } from "playwright";
import { generateTotp } from "../src/lib/totp.ts";

const BASE = "http://127.0.0.1:3000";
const dbUrl = new URL(process.env.DATABASE_URL ?? "");
assert.equal(process.env.CI, "true");
assert.equal(process.env.VAULT_BROWSER_ACCEPTANCE_MODE, "synthetic-postgres-only");
assert.equal(dbUrl.hostname, "127.0.0.1");
assert.equal(dbUrl.port, "5432");
assert.equal(dbUrl.pathname, "/app_db");
assert.equal(process.env.EMPLOYEE_DOCUMENT_VAULT_ENABLED, "true");
assert.equal(process.env.DOCUMENT_UPLOADS_ENABLED, "true");
assert.equal(process.env.DOCUMENT_OBJECT_STORAGE_ENDPOINT, "http://127.0.0.1:9000/");
assert.equal(process.env.MALWARE_SCAN_URL, "http://127.0.0.1:3877/scan");
assert.equal(process.env.OPENAI_API_KEY ?? "", "");

const fixture = JSON.parse(await readFile("/tmp/ess-profile-synthetic-fixture.json", "utf8"));
const orgA = fixture.organizationA;
const orgB = fixture.organizationB;
assert.notEqual(orgA, orgB);
const BYTES = Buffer.from("%PDF-1.7\n% Private vault FICTIONAL test employee form\n");
const sha = createHash("sha256").update(BYTES).digest("hex");
const ARTIFACT_DIR = "qa-artifacts/employee-vault";
await mkdir(ARTIFACT_DIR, { recursive: true });

const checks = [];
const browser = await chromium.launch({ headless: true });
const password = "Synthetic-Build-Block-Only-2026!";
const roleEmail = {
  hr: "hr@build-block.example.test",
  owner: "owner@build-block.example.test",
  manager: "manager@build-block.example.test",
  employee: "employee@build-block.example.test",
  employeeB: "employee-b@build-block.example.test",
  hrB: "hr-b@build-block.example.test",
};
async function login(role) {
  const context = await browser.newContext();
  try {
    const response = await context.request.post(BASE + "/api/auth/login", {
      headers: { origin: BASE, "sec-fetch-site": "same-origin" },
      data: { email: roleEmail[role], password,
        totpCode: generateTotp("JBSWY3DPEHPK3PXP") },
    });
    assert.equal(response.status(), 200, role + " authenticates with fictional MFA");
    const state = await context.storageState();
    assert.ok(state.cookies.some(c => c.name.includes("session")), "session cookie issued");
    checks.push(role + " MFA authenticated");
    return state;
  } finally { await context.close(); }
}
async function session(state, width) {
  return browser.newContext({ storageState: state, viewport: { width, height: 900 },
    acceptDownloads: true });
}
async function getAs(state, path) {
  const context = await session(state, 1440);
  try { return await context.request.get(BASE + path, { maxRedirects: 0 }); }
  finally { await context.close(); }
}
function assertDenied(response, label) {
  assert.ok([403, 404].includes(response.status()), label + " must be denied");
  checks.push(label + " denied (" + response.status() + ")");
}
async function uploadAs(state, input) {
  const context = await session(state, 1440);
  try {
    return await context.request.post(BASE + "/api/documents", {
      headers: { origin: BASE, "sec-fetch-site": "same-origin" },
      multipart: {
        organizationId: String(input.organizationId),
        employeeId: String(input.employeeId),
        kind: input.kind ?? "contract",
        file: {
          name: input.name ?? "fictional-contract.pdf",
          mimeType: input.mimeType ?? "application/pdf",
          buffer: input.bytes ?? BYTES,
        },
      },
    });
  } finally { await context.close(); }
}

try {
  const [hr, owner, employee, manager, employeeB, hrB] = await Promise.all([
    login("hr"), login("owner"), login("employee"),
    login("manager"), login("employeeB"), login("hrB"),
  ]);
  // A real authenticated ESS endpoint provides the worker identity.
  const ownProfile = await getAs(employee, "/api/self/documents");
  assert.equal(ownProfile.status(), 200);
  const ownInfo = await ownProfile.json();
  const employeeA = ownInfo.employee?.id;
  assert.ok(Number.isSafeInteger(employeeA) && employeeA > 0);
  const employeeForeign = fixture.employeeB;
  assert.ok(Number.isSafeInteger(employeeForeign) && employeeForeign !== employeeA);

  const empty = await getAs(hr, "/api/documents?organizationId=" + orgA +
    "&employeeId=" + employeeA);
  assert.equal(empty.status(), 200, "HR list allowed");
  const emptyPayload = await empty.json();
  assert.deepEqual(emptyPayload.documents, []);
  assert.equal(emptyPayload.storageReady, true, "the disposable private MinIO + scanner must be configured");
  assert.equal(emptyPayload.vaultEnabled, true);

  assertDenied(await getAs(manager, "/api/documents?organizationId=" + orgA +
    "&employeeId=" + employeeA), "manager list");
  assertDenied(await getAs(employeeB, "/api/documents?organizationId=" + orgA +
    "&employeeId=" + employeeA), "foreign tenant employee list");
  assertDenied(await getAs(employee, "/api/documents?organizationId=" + orgA +
    "&employeeId=" + employeeForeign), "own employee account wrong worker list");

  const invalidSignature = await uploadAs(hr, { organizationId: orgA,
    employeeId: employeeA, name: "fake.pdf", bytes: Buffer.from("invalid-magic") });
  assert.equal(invalidSignature.status(), 422, "magic bytes validated server-side");
  const oversized = await uploadAs(hr, { organizationId: orgA,
    employeeId: employeeA, name: "oversized.pdf", bytes: Buffer.alloc(5 * 1024 * 1024 + 1) });
  assert.equal(oversized.status(), 413, "5 MB enforced server-side");
  const invalidCategory = await uploadAs(hr, { organizationId: orgA,
    employeeId: employeeA, kind: "salary", name: "invalid-category.pdf" });
  assert.equal(invalidCategory.status(), 422, "server-side category allowlist");
  const malware = await uploadAs(hr, { organizationId: orgA,
    employeeId: employeeA, name: "synthetic-infected.pdf" });
  assert.equal(malware.status(), 422, "fictional scanner contract rejects infected label");
  const scanOutage = await uploadAs(hr, { organizationId: orgA,
    employeeId: employeeA, name: "synthetic-scanner-outage.pdf" });
  assert.equal(scanOutage.status(), 503, "scanner outage fails closed");
  const managerPost = await uploadAs(manager, {
    organizationId: orgA, employeeId: employeeA, name: "forbidden-manager.pdf" });
  assert.equal(managerPost.status(), 403, "manager cannot upload");
  checks.push("MIME/byte-length/category/scanner-outage/malware/manager-upload rejected");

  // Actual cross-tenant private object PUT through the authorized HR-B API.
  const foreignPut = await uploadAs(hrB, { organizationId: orgB,
    employeeId: employeeForeign, name: "private-tenant-b.pdf" });
  assert.equal(foreignPut.status(), 201, "HR B can upload only inside tenant B");
  const foreignId = (await foreignPut.json()).id;
  assert.ok(Number.isSafeInteger(foreignId));
  assertDenied(await getAs(hr, "/api/documents/" + foreignId),
    "HR A cannot open B private object");
  assertDenied(await getAs(employee, "/api/documents/" + foreignId),
    "employee A cannot open B private object");
  checks.push("cross-tenant private S3 object cannot be read");

  async function screenshotJourney(width, label) {
    const context = await session(hr, width);
    try {
      const page = await context.newPage();
      await page.goto(BASE + "/hcm/worker-360?organizationId=" + orgA +
        "&employeeId=" + employeeA, { waitUntil: "domcontentloaded", timeout: 90_000 });
      const vault = page.locator('section[aria-labelledby="worker360-document-vault"]');
      await vault.waitFor({ state: "visible", timeout: 90_000 });
      await vault.getByRole("heading", { name: "Upload employee document" }).waitFor({ timeout: 60_000 });
      const name = "fictional-" + label + "-contract.pdf";
      await vault.getByRole("combobox", { name: "Category" }).selectOption("contract");
      await vault.locator('input[type="file"]').setInputFiles({
        name, mimeType: "application/pdf", buffer: BYTES,
      });
      await page.screenshot({
        path: ARTIFACT_DIR + "/" + label + "-" + width + "-upload.png", fullPage: true,
        animations: "disabled",
      });
      await vault.getByRole("button", { name: "Upload securely" }).click();
      await vault.getByRole("heading", { name }).waitFor({ timeout: 60_000 });
      const list = await context.request.get(BASE + "/api/documents?organizationId=" + orgA +
        "&employeeId=" + employeeA);
      assert.equal(list.status(), 200);
      const listed = (await list.json()).documents;
      const record = listed.find(item => item.fileName === name);
      assert.ok(record && record.scannedClean, "the UI-created file is an actual clean scanned object");
      assert.equal(record.kind, "contract");
      assert.ok(record.uploadedBy && record.createdAt && record.byteSize === BYTES.length);
      // Both real read/view and attachment download fetch the private object
      // via the 60-second S3 signature. Only hash/length are retained as evidence.
      for (const option of ["", "?download=1"]) {
        const response = await context.request.get(BASE + "/api/documents/" + record.id + option);
        assert.equal(response.status(), 200, "authenticated private view/download");
        assert.equal(createHash("sha256").update(await response.body()).digest("hex"), sha);
        if (option) assert.match(response.headers()["content-disposition"] ?? "", /^attachment;/);
      }
      await vault.getByRole("link", { name: "View" }).waitFor();
      await vault.getByRole("link", { name: "Download" }).waitFor();
      await page.screenshot({
        path: ARTIFACT_DIR + "/" + label + "-" + width + "-view.png", fullPage: true,
        animations: "disabled",
      });

      assertDenied(await getAs(manager, "/api/documents/" + record.id),
        "manager direct document view");
      assertDenied(await getAs(employeeB, "/api/documents/" + record.id),
        "foreign tenant direct document view");
      const ownRead = await getAs(employee, "/api/documents/" + record.id);
      // Direct GET may return a 302 to the 60-second S3 URL; employee identity is checked first.
      assert.equal(ownRead.status(), 302, "employee can view their own document");

      page.once("dialog", async dialog => { await dialog.accept(); });
      await vault.getByRole("button", { name: "Delete" }).click();
      await vault.getByRole("heading", { name }).waitFor({ state: "detached", timeout: 60_000 });
      assertDenied(await getAs(employee, "/api/documents/" + record.id),
        "archived private document cannot be opened");
      const after = await context.request.get(BASE + "/api/documents?organizationId=" + orgA +
        "&employeeId=" + employeeA);
      const afterDocs = (await after.json()).documents;
      assert.ok(!afterDocs.some(item => item.id === record.id),
        "soft-archived record not listed");
      await page.screenshot({
        path: ARTIFACT_DIR + "/" + label + "-" + width + "-delete.png", fullPage: true,
        animations: "disabled",
      });

      const rect = await page.evaluate(() => ({
        viewport: window.innerWidth, scroll: document.documentElement.scrollWidth,
      }));
      assert.equal(rect.viewport, width);
      assert.ok(rect.scroll <= rect.viewport + 1,
        label + " has horizontal overflow: " + JSON.stringify(rect));
      checks.push("authenticated " + label + " " + width +
        "px upload/view/signed-download/soft-delete complete, no overflow");
    } finally { await context.close(); }
  }

  await screenshotJourney(1440, "desktop");
  await screenshotJourney(390, "mobile");
  const report = {
    status: "PASS", syntheticOnly: true, screenshots: 6,
    viewportWidths: [1440, 390], checked: checks,
    testSha256: sha, realS3Approved: false,
    realScannerApproved: false, realEmployeeData: false,
    productionReleaseApproved: false,
  };
  await writeFile(ARTIFACT_DIR + "/acceptance.json",
    JSON.stringify(report, null, 2), { mode: 0o600 });
  console.log("A5_EMPLOYEE_VAULT_SYNTHETIC_BROWSER_PASS " +
    JSON.stringify({ checks: checks.length, screenshots: 6,
      wrongRoleDenied: true, crossTenantDenied: true, realProviderApproved: false }));
} finally {
  await browser.close();
}
