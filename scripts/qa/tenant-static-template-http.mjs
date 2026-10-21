/**
 * Employee-import template is tenant-independent (no employer record lookup).
 * Verify that the SAME static CSV bytes are served to three authenticated
 * fictional employers, even with forged victim selectors. PUBLIC-BY-DESIGN
 * is about this inert template, NOT the separate employee import/history APIs.
 * Invoked only from the protected real PG16/local HTTP second-pass harness.
 */
import assert from "node:assert/strict";

export async function verifyTenantIndependentImportTemplate(f, { request, expectStatus }) {
  assert.equal(process.env.CI, "true");
  assert.equal(process.env.TENANT_SECOND_PASS_MODE, "isolated-ci-only");
  assert.equal(process.env.SECURITY_SMOKE_URL, "http://127.0.0.1:3000");
  const dbUrl = new URL(process.env.DATABASE_URL);
  assert.ok(["127.0.0.1", "localhost"].includes(dbUrl.hostname));
  assert.equal(dbUrl.port, "5432");
  assert.equal(dbUrl.pathname, "/app_db");

  let reference = null;
  for (const idx of [0, 1, 2]) {
    const cookie = f.ownerSessions[idx].cookie;
    const own = expectStatus(await request("/api/employees/import/template", { cookie }), 200,
      "Legitimate signed-in fictional user must receive the shared import CSV");
    assert.match(own.headers.get("content-type") ?? "", /^text\/csv/i);
    assert.match(own.headers.get("content-disposition") ?? "", /^attachment;/);
    assert.match(own.text, /^Employee No,First Name,Last Name,/);
    assert.ok(own.text.length > 100, "Template cannot be an empty or simulated response");

    const forged = expectStatus(await request(
      "/api/employees/import/template?organizationId=" + f.orgs[0].id +
        "&employeeId=" + f.victimEmployee.id + "&runId=" + f.victimRun.id,
      { cookie }), 200, "Forged victim IDs cannot influence the inert template");
    assert.equal(forged.text, own.text, "Template must ignore all client tenant selectors");
    assert.equal(forged.headers.get("content-type"), own.headers.get("content-type"));
    if (reference === null) reference = own.text;
    else assert.equal(own.text, reference,
      "Same static template must be identical across all three independent employers");
  }
  console.log("PASS tenant-independent employee import CSV: three fictional employer sessions, real HTTP 200, identical bytes, forged victim selectors ignored; no private tenant data");

  // The statutory posting GET has NO authentication gate or tenant selector:
  // it serves only a fixed CSV schema; the POST is a separate protected API.
  let postingTemplate = null;
  for (const idx of [null, 0, 1, 2]) {
    const options = idx === null ? {} : { cookie: f.ownerSessions[idx].cookie };
    const own = expectStatus(await request(
      "/api/compliance/statutory-remittances/posting-import", options), 200,
    "Anonymous or signed-in caller receives the same static statutory posting template");
    assert.match(own.headers.get("content-type") ?? "", /^text\\/csv/i);
    assert.match(own.headers.get("content-disposition") ?? "", /^attachment;/);
    assert.ok(own.text.length > 20);
    const forged = expectStatus(await request(
      "/api/compliance/statutory-remittances/posting-import?organizationId=" + f.orgs[0].id +
      "&employeeId=" + f.victimEmployee.id + "&batchId=" + f.victimRun.id,
      options), 200, "Static posting GET cannot read a forged employer batch or employee");
    assert.equal(forged.text, own.text);
    if (postingTemplate === null) postingTemplate = own.text;
    else assert.equal(own.text, postingTemplate, "Fixed statutory template differs by employer session");
  }
  console.log("PASS public statutory posting import CSV: anonymous plus three fictional employer sessions, identical nonempty template bytes and forged selectors ignored");
}
