/** Source-link guards complement, and never replace, real HTTP/PG evidence. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const file = "scripts/qa/tenant-dl01-filing-file-http.mjs";
const source = readFileSync(file, "utf8");
const hook = readFileSync("scripts/qa/tenant-static-template-http.mjs", "utf8");
const runner = readFileSync("scripts/qa/tenant-second-pass-http.mjs", "utf8");
const manifest = JSON.parse(readFileSync("scripts/qa/tenant-isolation-coverage-manifest.json", "utf8"));

test("filing download proof is called by the real three-employer runner and refuses other databases", () => {
  assert.ok(runner.includes("verifyTenantIndependentImportTemplate(f, { request, expectStatus })"));
  assert.ok(hook.includes('from "./tenant-dl01-filing-file-http.mjs"'));
  assert.ok(hook.includes("await verifyTenantFilingFile(f, { request, expectStatus });"));
  for (const fragment of [
    'requireDisposableFilingFile();', 'process.env.CI, "true"',
    'process.env.TENANT_SECOND_PASS_MODE, "isolated-ci-only"',
    'process.env.SECURITY_SMOKE_URL, "http://127.0.0.1:3000"',
    'assert.equal(url.port, "5432")', 'assert.equal(url.pathname, "/app_db")',
    'const fixture = await recordGeneratedFiling(',
    'const victim = fixtures[9]', 'persistedVictim?.organizationId, victimOrg.id',
    'victim.record.id > fixtures[7].record.id && victim.record.id > fixtures[8].record.id',
    'for (const idx of [1, 2])',
  ]) assert.ok(source.includes(fragment), "Missing actual-fixture or safety contract: " + fragment);
});

test("filing download checks actual bytes, exact denials, forged selectors and real unchanged victim rows", () => {
  for (const fragment of [
    'const own = expectStatus(await request(ownUrl, { cookie }), 200',
    'assert.equal(response.text, fixture.file.body',
    'assert.equal(digest(Buffer.from(response.text, "utf8")), fixture.record.fileSha256)',
    'assert.ok(response.text.includes("# payrollRun=" + fixture.record.payrollRunId))',
    '"/file?organizationId=" + victimOrg.id, { cookie }), 403',
    '"/file?organizationId=" + ownOrg.id, { cookie }), 404',
    'const forged = expectStatus(await request(ownUrl + "&runId=" + victim.record.payrollRunId',
    'assertOwnedFilingBytes(forged, owned)',
    'const before = await snapshotVictimFilings(victimOrg.id)',
    'const after = await snapshotVictimFilings(victimOrg.id)',
    'assert.deepEqual(after, before', 'assert.equal(receipts.length, 2)',
  ]) assert.ok(source.includes(fragment), "Missing runtime proof contract: " + fragment);
});

test("credited filing download requires exact pointers to its independently executed proof", () => {
  const method = manifest.allApiRouteFiles["src/app/api/compliance/filing-validations/[id]/file/route.ts"].methods.find(x => x.name === "GET");
  if (method.status === "GAP") {
    assert.equal(method.testedBy, null);
    return;
  }
  assert.equal(method.status, "COVERED");
  assert.equal(method.testedBy?.file, file);
  const lines = source.split("\n");
  for (const [field, fragment] of Object.entries({
    line: 'export const FILING_FILE_METHOD = "GET compliance/filing-validations/[id]/file";',
    ownPositiveLine: 'const own = expectStatus(await request(',
    foreignDenialLine: 'const foreign = expectStatus(await request(',
    forgedSelectorLine: 'const forged = expectStatus(await request(',
    unchangedDbLine: 'assert.deepEqual(after, before',
  })) {
    const number = method.testedBy[field];
    assert.ok(Number.isInteger(number) && number > 0 && number <= lines.length, field);
    assert.ok(lines[number - 1].includes(fragment), field + " points away from its live assertion");
  }
});
