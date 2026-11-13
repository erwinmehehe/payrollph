import { isYearEndHeld, verifyYearEndCredits, verifyYearEndHold } from "../scripts/qa/tenant-year-end-credit.mjs";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

const ROUTE = "src/app/api/year-end/route.ts";
const MANIFEST = "scripts/qa/tenant-isolation-coverage-manifest.json";
const ROW = "scripts/qa/tenant-table-rows/write/year-end-annualization-post.mjs";
const READ = "scripts/qa/tenant-batches/year-end-json-http.mjs";
const WRITE = "scripts/qa/tenant-write-table-http.mjs";
const WORKFLOW = ".github/workflows/tenant-year-end-post-candidate.yml";
const PINNED = {
  [ROUTE]: "f040f5bbbc3df275d32d23f1728b1b0345f77814",
  [ROW]: "9e64fc18a1a5b76c3ec583a0668ea680efd1ed19",
  [READ]: "0b778aea9d1e66f508a54f3c63cf43a2342f9e55",
  [WRITE]: "c9db7e9f1b0f7035836b4f599e82c51384a0f127",
  "scripts/qa/tenant-table-http.mjs": "31894982d768e34c1653be7c4335194f60233c6e",
  "src/lib/year-end.ts": "b2b52a7913be85eb70c507d26e730fc366852237",
  "src/lib/payroll-engine.ts": "dc5719a2c34094b5449bf4ecacb198ab0d74a313",
};
const source = path => readFileSync(path, "utf8");
const gitBlob = path => {
  const bytes = readFileSync(path);
  return createHash("sha1").update("blob " + bytes.length + "\0").update(bytes).digest("hex");
};

test("source-pinned current year-end GET+POST proof receives only provisional #1804 credits", () => {
  const manifest = JSON.parse(source(MANIFEST));
  const entry = manifest.allApiRouteFiles[ROUTE];
  const held = isYearEndHeld(manifest);
  for (const [path, sha] of Object.entries(PINNED)) {
    // A withdrawn credit (annualization source moved) is verified by its exact hold instead of the old pin.
    if (held && path === "src/lib/year-end.ts") continue;
    assert.equal(gitBlob(path), sha, path + ": changed dependency requires a fresh exact-head PG16 proof");
  }
  assert.equal(entry.gitBlobSha, PINNED[ROUTE]);
  if (held) {
    assert.equal(verifyYearEndHold(manifest), 0);
    assert.deepEqual(entry.methods.map(({ name, status }) => [name, status]), [["GET", "GAP"], ["POST", "GAP"]]);
    return;
  }
  assert.deepEqual(entry.methods.map(({ name, status }) => [name, status]),
    [["GET", "COVERED"], ["POST", "COVERED"]],
    "Only source-matched #1804 real-HTTP evidence allows provisional method credit");
  assert.equal(verifyYearEndCredits(manifest), 2);
  for (const method of entry.methods) {
    assert.equal(method.testedBy?.verifiedPrHeadSha, "ba70678f30e24436dcaac853e0b047adbbe3f96a");
    assert.equal(method.testedBy?.proofPullRequest, 1804);
    assert.equal(method.testedBy?.workflowRunId, 43372002300);
    assert.equal(method.testedBy?.independentSecurityReview, "PENDING");
    assert.equal(method.testedBy?.independentPayrollReview, "PENDING");
    assert.equal(method.testedBy?.independentlyAccepted, false);
    assert.equal(method.testedBy?.productionCertified, false);
    assert.equal(method.reviewedUncertified, undefined, "Obsolete superseded zero-credit hold removed");
  }
  assert.match(manifest.acceptanceStatus, /^NOT ACCEPTED:/);
  assert.equal(manifest.metrics.coveredAfter + manifest.metrics.publicByDesign +
    manifest.metrics.privilegedOperationsTokenOnly + manifest.metrics.gap, manifest.metrics.methods);
});

test("year-end routes require active employer authority and employee-employer matching", () => {
  const raw = source(ROUTE);
  const get = raw.split("export async function POST")[0];
  const post = raw.split("export async function POST")[1];
  assert.ok(get.includes("export async function GET"));
  assert.ok(post);
  assert.match(get, /assertOrganizationRole\([\s\S]*?organizationId,[\s\S]*?PAYROLL_OPERATOR_ROLES/);
  assert.match(get, /if \(!access\?\.companyWide\)/);
  assert.match(get, /\.innerJoin\(employees, and\(\s*eq\(yearEndAdjustments\.employeeId, employees\.id\),\s*eq\(employees\.organizationId, organizationId\)/);
  assert.match(get, /eq\(yearEndAdjustments\.organizationId, organizationId\)/);
  assert.match(get, /eq\(yearEndAdjustments\.taxYear, taxYear\)/);
  assert.match(post, /enforceSameOriginMutation\(request\)/);
  assert.match(post, /assertOrganizationRole\([\s\S]*?organizationId,[\s\S]*?PAYROLL_OPERATOR_ROLES/);
  assert.match(post, /if \(!access\?\.companyWide\)/);
  assert.match(post, /eq\(payrollRuns\.id, applyToPayrollRunId\),\s*eq\(payrollRuns\.organizationId, organizationId\)/);
  assert.match(post, /onBoundToPayrollRun: async \(tx, boundSummary\) => \{/);
  assert.match(post, /await enqueuePayrollRun\(boundRun\.id, undefined, tx\)/);
  assert.match(post, /await runYearEndAnnualization\(/);
});

test("the PG16 candidate exercises both successful POST actions and five GET formats", () => {
  const row = source(ROW);
  for (const evidence of [
    "key: 'POST year-end'",
    "ownBody, foreignBody",
    "forged: { status: 404, body: forgedBody }",
    "after.adjustments.length, 1",
    "response.json?.employees, 1",
    "before.adjustments.length, 0",
    "const ownRead = expectStatus",
    "const ownPreflight = expectStatus",
    "const forgedRead = expectStatus",
    "const bound = expectStatus",
    "const foreignBound = expectStatus",
    "const forgedBound = expectStatus",
    "format: '2316'",
    "format: '2316-print'",
    "format: 'alphalist'",
    "const ownArtifact = expectStatus",
    "const denied = expectStatus",
    "const forged = expectStatus",
    "assert.deepEqual(await state(c.victim.org.id), victimState",
    "methodCredit: 0",
  ]) assert.ok(row.includes(evidence), "Missing full-method proof: " + evidence);
  assert.match(row, /const foreignBody = c => \(\{ organizationId: c\.victim\.org\.id/);
  assert.match(row, /const forgedBody = c => \(\{ organizationId: c\.orgId[\s\S]*?c\.victimSeeded\.id/);
  assert.match(row, /for \(const spec of exportModes\)/);
  assert.match(row, /all actual annual source readiness blockers must be resolved/);
});

test("two-attacker PG16 controls include a genuine foreign-employee FK", () => {
  const read = source(READ), write = source(WRITE);
  assert.ok(read.indexOf("guard();") < read.indexOf('import("../../../src/db/index.ts")'),
    "disposable-only guard must run before database import");
  assert.match(read, /employeeId: victim\.worker\.id/);
  assert.match(read, /crossEmployer\.employeeId, victim\.worker\.id/);
  assert.match(read, /for\(const attacker of \[a,b\]\)/);
  assert.match(read, /assert\.equal\(reply\.json\?\.count, 1/);
  assert.match(read, /assert\.equal\(foreign\.status,403/);
  assert.match(read, /assert\.deepEqual\(after,before/);
  assert.match(write, /for \(const idx of \[1, 2\]\)/);
  assert.match(write, /victim\[field\]\.id > employers\[1\]\[field\]\.id && victim\[field\]\.id > employers\[2\]\[field\]\.id/);
  assert.match(write, /const owned = expectStatus/);
  assert.match(write, /const foreign = expectStatus/);
  assert.match(write, /const refused = expectStatus/);
  assert.match(write, /assert\.deepEqual\(victimAfter, victimBefore/);
});

test("the proof runs only in disposable PostgreSQL 16 against localhost Next", () => {
  const wf = source(WORKFLOW);
  assert.match(wf, /image: postgres:16/);
  assert.match(wf, /TENANT_TABLE_FAMILY=year-end-annualization-post/);
  assert.match(wf, /node --import tsx scripts\/qa\/tenant-write-table-http\.mjs/);
  assert.match(wf, /node --test tests\/tenant-year-end-full-method-candidate\.test\.mjs/);
  assert.match(wf, /npm start -- -H 127\.0\.0\.1/);
  for (const flag of ["WORKER_ENABLED=false", "XENDIT_PAYOUTS_ENABLED=false",
    "PAYMONGO_DISBURSEMENTS_ENABLED=false", "MULTI_ENTITY_ENABLED=false"]) {
    assert.ok(wf.includes(flag), "Required disabled external operation: " + flag);
  }
  assert.doesNotMatch(wf, /vercel deploy|db:migrate:production|npm run deploy/i);
});
