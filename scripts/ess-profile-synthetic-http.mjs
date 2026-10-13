/**
 * Authenticated ESS HTTP acceptance with real MFA cookies and isolated synthetic
 * PostgreSQL. Never point at a preview, Neon, production or a real employer.
 * No credentials, plaintext IDs, cookies, encrypted payloads or raw bodies in logs.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { request } from "playwright";
import pg from "pg";
import sharp from "sharp";
import { generateTotp } from "../src/lib/totp.ts";

const BASE = "http://127.0.0.1:3000";
const PHOTO = "/api/self/photo";
const IDS = "/api/self/identifiers";
const REVIEW = "/api/employee-identifier-requests";
const ORIGIN = { origin: BASE, "sec-fetch-site": "same-origin" };
const PASSWORD = "Synthetic-Build-Block-Only-2026!";
const fixture = JSON.parse(readFileSync("/tmp/ess-profile-synthetic-fixture.json", "utf8"));
const database = new URL(process.env.DATABASE_URL ?? "");
assert.equal(process.env.CI, "true");
assert.equal(process.env.ESS_PROFILE_ACCEPTANCE_MODE, "synthetic-postgres-only");
assert.equal(process.env.PII_LEGACY_READ_ENABLED, "false");
assert.equal(process.env.OPENAI_API_KEY ?? "", "");
assert.equal(process.env.APP_BASE_URL, BASE);
assert.equal(database.hostname, "127.0.0.1");
assert.equal(database.port, "5432");
assert.equal(database.pathname, "/app_db");
assert.equal(database.username, "postgres");
assert.deepEqual(new Set([fixture.organizationA, fixture.organizationB]).size, 2);

const clients = [];
const checkpoints = [];
async function login(role, suffix = "") {
  const api = await request.newContext({ baseURL: BASE });
  clients.push(api);
  const email = role + suffix + "@build-block.example.test";
  const response = await api.post("/api/auth/login", {
    headers: ORIGIN,
    data: { email, password: PASSWORD, totpCode: generateTotp("JBSWY3DPEHPK3PXP") },
    timeout: 60_000,
  });
  assert.equal(response.status(), 200, role + suffix + " MFA login");
  const body = await response.json();
  assert.equal(body.user.email, email);
  checkpoints.push("MFA " + role + suffix);
  return api;
}
async function expect(label, promise, expected) {
  const response = await promise;
  assert.equal(response.status(), expected, label + " HTTP status");
  checkpoints.push(label + ": " + expected);
  return response;
}
const get = (api, path) => api.get(path, { timeout: 60_000 });
const post = (api, path, data) => api.post(path, { headers: ORIGIN, data, timeout: 60_000 });
const photoPost = (api, fileName, buffer, mimeType = "image/png") =>
  api.post(PHOTO, {
    headers: ORIGIN,
    multipart: { photo: { name: fileName, mimeType, buffer } },
    timeout: 60_000,
  });
const approve = (organizationId, requestId, verifiedValue, verifiedAgainstRecord = true) =>
  ({ organizationId, requestId, action: "approve", verifiedValue, verifiedAgainstRecord });
const reject = (organizationId, requestId, note) =>
  ({ organizationId, requestId, action: "reject", reviewNote: note });

async function run() {
  const anon = await request.newContext({ baseURL: BASE });
  clients.push(anon);
  await expect("anonymous identifiers", get(anon, IDS), 401);
  await expect("anonymous photo", get(anon, PHOTO), 401);
  await expect("anonymous HR queue", get(anon, REVIEW + "?organizationId=" + fixture.organizationA), 401);

  const a = await login("employee");
  const b = await login("employee", "-b");
  const hrA = await login("hr");
  const hrB = await login("hr", "-b");
  const manager = await login("manager");
  await expect("HR cannot read own-employee identifiers", get(hrA, IDS), 403);
  await expect("Manager cannot read own-employee photo", get(manager, PHOTO), 403);
  await expect("Employee cannot review identifier queue", get(a, REVIEW + "?organizationId=" + fixture.organizationA), 403);
  await expect("HR-A cannot read B", get(hrA, REVIEW + "?organizationId=" + fixture.organizationB), 403);
  await expect("HR-B cannot read A", get(hrB, REVIEW + "?organizationId=" + fixture.organizationA), 403);
  await expect("Cross-site employee mutation denied",
    a.post(IDS, { headers: { origin: "https://invalid.invalid", "sec-fetch-site": "cross-site" },
      data: { kind: "tin", value: "123456789" } }), 403);
  await expect("Disallowed government ID kind", post(a, IDS, { kind: "philsysNo", value: "000000000" }), 422);

  const ownA = await (await expect("A initial identifiers", get(a, IDS), 200)).json();
  const ownB = await (await expect("B initial identifiers", get(b, IDS), 200)).json();
  assert.equal(ownA.current.tin.hasValue, false);
  assert.equal(ownB.current.tin.hasValue, false);

  const pendingA = await (await expect("A new TIN request", post(a, IDS,
    { kind: "tin", value: "123-456-789" }), 201)).json();
  const pendingB = await (await expect("B new TIN request", post(b, IDS,
    { kind: "tin", value: "987-654-321" }), 201)).json();
  assert.ok(Number.isSafeInteger(pendingA.id) && Number.isSafeInteger(pendingB.id));
  assert.notEqual(pendingA.id, pendingB.id);
  await expect("Duplicate pending ID rejected", post(a, IDS,
    { kind: "tin", value: "123456789" }), 409);

  const qa = await (await expect("HR-A own queue", get(hrA,
    REVIEW + "?organizationId=" + fixture.organizationA), 200)).json();
  const qb = await (await expect("HR-B own queue", get(hrB,
    REVIEW + "?organizationId=" + fixture.organizationB), 200)).json();
  assert.deepEqual(qa.requests.map(row => row.id), [pendingA.id]);
  assert.deepEqual(qb.requests.map(row => row.id), [pendingB.id]);
  assert.ok(qa.requests.every(row => !JSON.stringify(row).includes("123456789")));
  assert.ok(qb.requests.every(row => !JSON.stringify(row).includes("987654321")));
  checkpoints.push("Separate tenant queues expose masked values only");

  await expect("HR unverified approval blocked", post(hrA, REVIEW,
    approve(fixture.organizationA, pendingA.id, "123456789", false)), 422);
  await expect("HR mismatched approval blocked", post(hrA, REVIEW,
    approve(fixture.organizationA, pendingA.id, "111111111")), 422);
  await expect("HR cannot approve foreign tenant", post(hrA, REVIEW,
    approve(fixture.organizationB, pendingB.id, "987654321")), 403);
  await expect("HR approves own verified request", post(hrA, REVIEW,
    approve(fixture.organizationA, pendingA.id, "123456789")), 200);
  await expect("Repeated review blocked", post(hrA, REVIEW,
    approve(fixture.organizationA, pendingA.id, "123456789")), 409);
  const afterA = await (await expect("A approved identifier visible", get(a, IDS), 200)).json();
  assert.equal(afterA.current.tin.hasValue, true);
  assert.equal(afterA.requests.find(row => row.id === pendingA.id)?.status, "approved");
  assert.equal(afterA.current.tin.masked.includes("123456789"), false);
  const stillPendingB = await (await expect("Tenant B unaffected by A review", get(b, IDS), 200)).json();
  assert.equal(stillPendingB.current.tin.hasValue, false);

  await expect("Short rejection note denied", post(hrB, REVIEW,
    reject(fixture.organizationB, pendingB.id, "too short")), 422);
  await expect("HR-B rejects own pending request", post(hrB, REVIEW,
    reject(fixture.organizationB, pendingB.id, "Fictional source not verified")), 200);
  const rejectedB = await (await expect("B review rejection visible", get(b, IDS), 200)).json();
  assert.equal(rejectedB.current.tin.hasValue, false);
  assert.equal(rejectedB.requests.find(row => row.id === pendingB.id)?.status, "rejected");
  const resentB = await (await expect("B re-submits after rejection", post(b, IDS,
    { kind: "tin", value: "987654321" }), 201)).json();
  await expect("HR-B approves corrected request", post(hrB, REVIEW,
    approve(fixture.organizationB, resentB.id, "987654321")), 200);
  assert.equal((await (await expect("B approved data visible", get(b, IDS), 200)).json()).current.tin.hasValue, true);

  const optional = await (await expect("A optional passport request", post(a, IDS,
    { kind: "passportNo", value: "P1234567" }), 201)).json();
  await expect("Optional credential verified", post(hrA, REVIEW,
    approve(fixture.organizationA, optional.id, "P1234567")), 200);
  assert.equal((await (await expect("Optional credential visible masked", get(a, IDS), 200)).json())
    .current.passportNo.hasValue, true);

  const png = await sharp({ create: { width: 80, height: 80, channels: 3,
    background: { r: 60, g: 130, b: 190 } } }).png().toBuffer();
  const blank = await expect("B has no photo initially", get(b, PHOTO), 404);
  assert.equal(blank.status(), 404);
  await expect("Empty photo HEAD returns 204", b.head(PHOTO), 204);
  await expect("Invalid photo MIME rejected", photoPost(b, "invalid.txt", png, "text/plain"), 422);
  await expect("Oversize photo rejected", photoPost(b, "oversize.png",
    Buffer.concat([png, Buffer.alloc(524289)])), 413);
  await expect("Scanner unavailable fails closed", photoPost(b,
    "scanner-unavailable.png", png), 503);
  await expect("Scanner detects malicious file", photoPost(b,
    "scanner-detected.png", png), 503);
  await expect("Rejected photos not saved", get(b, PHOTO), 404);

  await expect("B photo upload", photoPost(b, "fictional.png", png), 200);
  await expect("B photo HEAD succeeds", b.head(PHOTO), 200);
  const returned = await expect("B retrieves own photo", get(b, PHOTO), 200);
  assert.equal(returned.headers()["content-type"], "image/png");
  assert.equal(createHash("sha256").update(await returned.body()).digest("hex"),
    createHash("sha256").update(png).digest("hex"));
  await expect("A cannot see B photo", get(a, PHOTO), 404);
  const connection = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await connection.connect();
  try {
    const summary = await connection.query(
      "SELECT organization_id, sealed_photo, content_sha256 FROM ess_employee_photos");
    assert.equal(summary.rows.length, 1);
    assert.equal(summary.rows[0].organization_id, fixture.organizationB);
    assert.ok(summary.rows[0].sealed_photo.startsWith("enc:essphoto:v1:"));
    assert.ok(!summary.rows[0].sealed_photo.includes(png.toString("base64")));
    assert.equal(summary.rows[0].content_sha256,
      createHash("sha256").update(png).digest("hex"));
    checkpoints.push("Stored photo encrypted with SHA-256 integrity");
  } finally { await connection.end(); }

  mkdirSync("qa-artifacts/ess-profile", { recursive: true });
  writeFileSync("qa-artifacts/ess-profile/http-result.json", JSON.stringify({
    status: "PASS", syntheticOnly: true, mode: "isolated-postgres",
    checks: checkpoints, secretValuesIncluded: false, realCustomerData: false,
  }, null, 2));
  console.log("ESS authenticated HTTP acceptance PASS:", checkpoints.length, "checkpoints, two fictional tenants.");
}
run().catch(error => {
  console.error("ESS HTTP acceptance FAIL:", error instanceof Error ? error.message : "unknown");
  process.exitCode = 1;
}).finally(async () => {
  for (const client of clients) await client.dispose().catch(() => {});
});
