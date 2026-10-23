/**
 * Static source guard only. Actual proof requires the same exact-head GitHub
 * Security HTTP Smoke PG16/localhost run; this cannot certify a GAP by itself.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const proofPath = "scripts/qa/tenant-dl01-vault-http.mjs";
const source = readFileSync(proofPath, "utf8");
const runner = readFileSync("scripts/qa/tenant-second-pass-http.mjs", "utf8");
const workflow = readFileSync(".github/workflows/security-http-smoke.yml", "utf8");
const manifest = JSON.parse(readFileSync("scripts/qa/tenant-isolation-coverage-manifest.json", "utf8"));

test("DL-01 vault is executed in the existing isolated PG16 server, never production", () => {
  assert.equal(runner.split('verifyDl01Vault(f, { request, expectStatus })').length - 1, 1);
  assert.ok(runner.includes('if (process.env.TENANT_DL01_VAULT_PROOF === "isolated-ci-only")'),
    "Other CI suites must not execute the feature-enabled vault probe unless opted in");
  assert.match(workflow, /image: postgres:16/);
  assert.match(workflow, /DATABASE_URL: postgresql:\/\/postgres:postgres@127\.0\.0\.1:5432\/app_db/);
  assert.match(workflow, /SECURITY_SMOKE_URL: http:\/\/127\.0\.0\.1:3000/);
  const localServer = workflow.split("Start production server")[1]?.split("Run adversarial HTTP")[0];
  const secondPass = workflow.split("Real-HTTP second-pass tenant isolation")[1]?.split("Show server log")[0];
  assert.ok(localServer?.includes('EMPLOYEE_DOCUMENT_VAULT_ENABLED: "true"'));
  assert.ok(secondPass?.includes('EMPLOYEE_DOCUMENT_VAULT_ENABLED: "true"'));
  assert.ok(secondPass?.includes("TENANT_DL01_VAULT_PROOF: isolated-ci-only"));
  assert.ok(source.includes('assert.equal(process.env.TENANT_DL01_VAULT_PROOF, "isolated-ci-only")'));
  assert.ok(source.includes('assert.equal(process.env.TENANT_SECOND_PASS_MODE, "isolated-ci-only")'));
  assert.ok(source.includes('assert.equal(app.href, "http://127.0.0.1:3000/")'));
  assert.ok(source.includes('assert.equal(pg.pathname, "/app_db")'));
  assert.ok(source.includes('assert.notEqual(process.env.PAYMONGO_DISBURSEMENTS_ENABLED, "true")'));
  assert.ok(source.includes('assert.notEqual(process.env.XENDIT_PAYOUTS_ENABLED, "true")'));
});

test("DL-01 vault own/foreign/forged/high-ID/unchanged-victim checks remain real", () => {
  for (const fragment of [
    'for (const idx of [1, 2])',
    'db.insert(documents).values([',
    'victimDoc.id > created[1][1].id',
    'victimDoc.id > created[2][1].id',
    'db.select().from(documents)',
    'const before = await victimSnapshot(victimOrg.id)',
    'assertOwnList(ownRead, ownPrimary.id',
    'victimOrg.id + "&employeeId=" + victimWorker.id',
    'org.id + "&employeeId=" + victimWorker.id',
    '&documentId=" + victimDoc.id',
    'method: "DELETE", cookie',
    '204, "DL-01 vault DELETE must soft-remove',
    '403, "DL-01 vault DELETE must deny',
    'vault-removed:',
    'Employee document removed from active vault',
    'assert.deepEqual(await victimSnapshot(victimOrg.id), before',
  ]) assert.ok(source.includes(fragment), "Missing separate vault real-PG proof: " + fragment);
});

test("DL-01 GET and DELETE credits cannot float without exact three-tenant HTTP proof", () => {
  const expected = [
    { path: "src/app/api/employee-vault/route.ts", method: "GET",
      pins: { line: 128, ownPositiveLine: 128, foreignDenialLine: 132,
        forgedSelectorLine: 138, unchangedDbLine: 173,
        victimExistsLine: 110, victimIdOrderingLine: 104 },
      ownStatus: 200, forgedStatus: 200 },
    { path: "src/app/api/employee-vault/[id]/route.ts", method: "DELETE",
      pins: { line: 148, ownPositiveLine: 148, foreignDenialLine: 144,
        forgedSelectorLine: 160, unchangedDbLine: 173,
        victimExistsLine: 110, victimIdOrderingLine: 104 },
      ownStatus: 204, forgedStatus: 204 },
  ];
  const lines = source.split("\n");
  const span = number => lines.slice(number - 1, number + 4).join("\n");
  for (const { path, method, pins, ownStatus, forgedStatus } of expected) {
    const entry = manifest.allApiRouteFiles[path]?.methods.find(row => row.name === method);
    assert.equal(entry?.status, "COVERED",
      method + " requires a successful own request and a real foreign denial");
    assert.equal(entry?.testedBy?.file, proofPath);
    for (const [field, pinnedLine] of Object.entries(pins)) {
      assert.equal(entry.testedBy[field], pinnedLine, method + " " + field + " must match reviewed source");
      assert.ok(lines[pinnedLine - 1]?.trim() && !lines[pinnedLine - 1].trim().startsWith("//"));
    }
    assert.match(span(pins.ownPositiveLine), /expectStatus\(await request\(/);
    assert.ok(span(pins.ownPositiveLine).includes("), " + ownStatus + ","));
    assert.match(span(pins.foreignDenialLine), /expectStatus\(await request\(/);
    assert.match(span(pins.foreignDenialLine), /\), 403,/);
    assert.match(span(pins.forgedSelectorLine), /expectStatus\(await request\(/);
    assert.ok(span(pins.forgedSelectorLine).includes("), " + forgedStatus + ","));
    assert.match(lines[pins.victimExistsLine - 1], /persistedVictimDoc\?\.organizationId, victimOrg\.id/);
    assert.match(span(pins.victimIdOrderingLine), /victimDoc\.id > created\[2\]\[1\]\.id/);
    assert.match(lines[pins.unchangedDbLine - 1],
      /assert\.deepEqual\(await victimSnapshot\(victimOrg\.id\), before/);
  }
  assert.match(source, /for \(const idx of \[1, 2\]\)/);
  assert.match(source, /assertOwnList\(ownRead, ownPrimary\.id, victimDoc\.id/);
  assert.match(source, /assertOwnList\(forged, ownPrimary\.id, victimDoc\.id/);
  assert.match(source, /removed\?\.sourceKey\?\.startsWith\("vault-removed:"\)/);
  assert.match(source, /Employee document removed from active vault/);
  assert.match(source, /process\.env\.EMPLOYEE_DOCUMENT_VAULT_ENABLED, "true"/);
  // The pre-existing #1303 provisional statutory payment POST must remain linked.
  const statutoryPost = manifest.allApiRouteFiles[
    "src/app/api/compliance/statutory-remittances/payment-evidence/route.ts"
  ]?.methods.find(row => row.name === "POST");
  assert.equal(statutoryPost?.status, "COVERED",
    "The extra provisional method must be the statutory payment-evidence POST");
  assert.equal(statutoryPost?.testedBy?.file, "scripts/qa/tenant-manifest-driven-http.mjs");
  for (const key of ["ownPositiveLine", "foreignDenialLine", "unchangedDbLine"]) {
    assert.ok(Number.isInteger(statutoryPost?.testedBy?.[key]) && statutoryPost.testedBy[key] > 0,
      "Payment POST requires source-pinned own, foreign and unchanged-victim proof: " + key);
  }
  assert.deepEqual([manifest.metrics.coveredAfter, manifest.metrics.publicByDesign, manifest.metrics.gap],
    [153, 10, 330]);
  assert.equal(manifest.metrics.methods, 493);
  assert.match(manifest.acceptanceStatus, /^NOT ACCEPTED: 330 API methods and 19 page\/action GAPs remain/);
  assert.equal(manifest.scopedPages.length, 20);
  assert.equal(manifest.scopedPages.filter(page => page.status === "GAP").length, 19);
});
