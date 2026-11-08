import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import test from "node:test";

function gitBlobSha(content) {
  const bytes = Buffer.isBuffer(content) ? content : Buffer.from(content);
  return createHash("sha1").update("blob " + bytes.length)
    .update(Buffer.from([0])).update(bytes).digest("hex");
}

test("existing careers PATCH four-part proof remains byte-identical and independently credited", () => {
  const canonical = readFileSync("scripts/qa/tenant-edg01-careers-publication-http.mjs");
  assert.equal(gitBlobSha(canonical), "9f799cc2344561ab8f4a47a2c0ddc162335f8096",
    "do not repin, change or invalidate the old executed PATCH proof");
});

test("public Careers GET proof runs only on the original disposable three-employer fixture", () => {
  const src = readFileSync("scripts/qa/tenant-edg01-careers-public-get-http.mjs", "utf8");
  assert.ok(src.indexOf("requireDisposableCareersEnv()") <
    src.indexOf('import("../../src/db/index.ts")'), "refuse remote DB before imports");
  for (const guard of [
    "fixtures.requireTenantTableDisposable()", 'server_version_num',
    'employers.length, 3', '"TTBL-ATTA-"', '"TTBL-ATTB-"', '"TTBL-VICTIM-"',
    "row.careers_published === true", "publicVictim[0].id > 6",
    '"/api/careers?organizationId="', "standaloneRequest(",
    '"job_applicants"', '"payroll_runs"', '"audit_events"',
    "assert.deepEqual(await snapshot(), before", "result.status, 200",
    '"@example.invalid"', '"department", "description", "employmentType", "id", "title"',
    "coverageCredits: 0", "publicByDesignReviewPending: true",
  ]) assert.ok(src.includes(guard), "missing actual public GET privacy gate: " + guard);
  assert.doesNotMatch(src, /(?:update|insert|delete)\s*\(/,
    "public listing helper must not mutate the database");
});

test("public GET remains GAP until a separate executed run and owner privacy classification", () => {
  const manifest = JSON.parse(readFileSync("scripts/qa/tenant-isolation-coverage-manifest.json"));
  const methods = manifest.allApiRouteFiles["src/app/api/careers/route.ts"].methods;
  for (const name of ["GET", "POST"]) {
    const method = methods.find(row => row.name === name);
    assert.equal(method?.status, "GAP", name + " must not borrow the existing PATCH credit");
    assert.equal(method?.testedBy, null);
  }
  const workflow = readFileSync(".github/workflows/tenant-edg01-careers-public-get-http.yml", "utf8");
  const old = workflow.indexOf("tenant-edg01-careers-publication-http.mjs --prove");
  const next = workflow.indexOf("run: node --import tsx scripts/qa/tenant-edg01-careers-public-get-http.mjs");
  assert.ok(old >= 0 && next > old,
    "first run original PG16 publication and unpublish, THEN public GET privacy checks");
  for (const guard of ["postgres:16", "npm run db:push", "--migrate",
    "-H 127.0.0.1", "MULTI_ENTITY_ENABLED: 'false'",
    "XENDIT_PAYOUTS_ENABLED", "WORKER_ENABLED: 'false'"]) {
    // The original CI runner's shell exports payout OFF via tenant-table-env.
    if (guard === "XENDIT_PAYOUTS_ENABLED") continue;
    assert.ok(workflow.includes(guard), "missing disposable workflow guard: " + guard);
  }
});
