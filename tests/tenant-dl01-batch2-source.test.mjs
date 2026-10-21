/**
 * Source-only fail-closed wiring test. Never substitutes for the real HTTP/PG16
 * three-employer run; a method remains GAP until linked to completed proof.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const path = "scripts/qa/tenant-dl01-batch2-http.mjs";
const src = readFileSync(path, "utf8");
const harness = readFileSync("scripts/qa/tenant-second-pass-http.mjs", "utf8");
const manifest = JSON.parse(readFileSync("scripts/qa/tenant-isolation-coverage-manifest.json", "utf8"));
const keys = [
  ["POST", "compliance/statutory-remittances/posting-import"],
  ["GET", "compliance/contribution-issues/evidence"],
  ["GET", "compliance/labor-inspection/evidence-pack"],
  ["GET", "exports"],
  ["GET", "bi-exports"],
];

test("live three-employer harness invokes every candidate from isolated PostgreSQL only", () => {
  assert.equal(harness.split('verifyDl01Batch2(f, { request, expectStatus })').length - 1, 1);
  assert.ok(src.includes('assert.equal(process.env.CI, "true")'));
  assert.ok(src.includes('assert.equal(process.env.TENANT_SECOND_PASS_MODE, "isolated-ci-only")'));
  assert.ok(src.includes('assert.equal(app.href, "http://127.0.0.1:3000/")'));
  assert.ok(src.includes('assert.equal(pg.pathname, "/app_db")'));
  assert.ok(src.includes('for (const idx of [1, 2])'));
  assert.ok(src.includes('assert.equal(account.json?.profile?.id, f.owners[idx].id)'));
  assert.ok(src.includes('const before = await victimSnapshot(victimOrg.id)'));
  assert.ok(src.includes('const after = await victimSnapshot(victimOrg.id)'));
  assert.ok(src.includes('assert.deepEqual(after, before,'));
  assert.ok(src.includes('assert.equal(receipts.length, 2'));
  assert.ok(src.includes('accepted: false, actualFundsMoved: false'));
});

test("posting mutation must apply real own batch and prove real victim denial/unchanged snapshot", () => {
  for (const fragment of [
    'const ownPosting = expectStatus(await request(',
    '}), 200, "DL-01 posting-import own valid CSV POST must APPLY")',
    'assert.equal(ownPosting.json?.applied, true)',
    'assert.equal(posted?.postingStatus, "confirmed")',
    'assert.equal(artifact?.outcome, "applied")',
    'const foreignPosting = expectStatus(await request(',
    '}), 403, "DL-01 real victim employer posting-import POST explicitly denied")',
    'const forgedPosting = expectStatus(await request(',
    '}), 404, "DL-01 real victim batch under attacker\'s authorized employer must be 404")',
    'assert.equal(persistedVictimBatch?.organizationId, victimOrg.id)',
    'assert.equal(persistedVictimMember?.organizationId, victimOrg.id)',
    'assert.equal(persistedVictimCase?.organizationId, victimOrg.id)',
    'assert.ok(victimBatch.id > batches[idx].id',
  ]) assert.ok(src.includes(fragment), "Missing required real mutation proof: " + fragment);
});

test("each download method has own content, victim denial and a forged selector", () => {
  for (const field of ["Export","Bi","Case","Inspection"]) {
    assert.ok(src.includes("const own" + field + " = expectStatus(await request("), field + " missing own request");
    assert.ok(src.includes("const foreign" + field + " = expectStatus(await request("), field + " missing victim denial");
    assert.ok(src.includes("const forged" + field + " = expectStatus(await request("), field + " missing forged selector");
  }
  assert.ok(src.includes('assert.ok(ownExport.text.includes(worker.employeeNo)'));
  assert.ok(src.includes('ownBi.text.includes("ATTACKER-")'));
  assert.ok(src.includes('ownCase.json?.timeline?.length >= 1'));
  assert.ok(src.includes('ownInspection.json.sections.workerRoster.rows.some(row => row.employeeNo === worker.employeeNo)'));
  assert.ok(src.includes('const wrongScopedCase = expectStatus(await request('));
});

test("new candidates remain provisional unless exact reviewed line references exist", () => {
  const lines = src.split("\n");
  for (const [method, route] of keys) {
    const file = manifest.allApiRouteFiles["src/app/api/" + route + "/route.ts"];
    const record = file?.methods.find(x => x.name === method);
    assert.ok(record, "Method must be in actual manifest: " + method + " " + route);
    assert.ok(["GAP", "COVERED"].includes(record.status));
    if (record.status === "GAP") {
      assert.equal(record.testedBy, null, "No provisional method may be credited");
      continue;
    }
    const proof = record.testedBy;
    assert.equal(proof?.file, path);
    for (const field of ["line","ownPositiveLine","foreignDenialLine","forgedSelectorLine","unchangedDbLine","victimExistsLine","victimIdOrderingLine"]) {
      const n = proof[field];
      assert.ok(Number.isSafeInteger(n) && n > 0 && n <= lines.length, route + ": missing " + field);
      assert.ok(lines[n - 1].trim() && !lines[n - 1].trim().startsWith("//"), route + ": inactive " + field);
    }
    assert.ok(proof.ownPositiveLine < proof.foreignDenialLine);
    assert.ok(proof.foreignDenialLine < proof.forgedSelectorLine);
    assert.ok(proof.forgedSelectorLine < proof.unchangedDbLine);
  }
});
