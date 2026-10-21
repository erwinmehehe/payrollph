/** Wiring guards only. Actual coverage requires the existing real HTTP/PG16 job. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const file = "scripts/qa/tenant-dl01-import-history-http.mjs";
const source = readFileSync(file, "utf8");
const templates = readFileSync("scripts/qa/tenant-static-template-http.mjs", "utf8");
const runner = readFileSync("scripts/qa/tenant-second-pass-http.mjs", "utf8");
const manifest = JSON.parse(readFileSync("scripts/qa/tenant-isolation-coverage-manifest.json", "utf8"));

test("private import-history probe is executed by the existing three-employer HTTP harness", () => {
  assert.ok(runner.includes("verifyTenantIndependentImportTemplate(f, { request, expectStatus })"));
  assert.ok(templates.includes('from "./tenant-dl01-import-history-http.mjs"'));
  assert.ok(templates.includes("await verifyTenantImportHistory(f, { request, expectStatus });"));
  assert.ok(source.includes('export const IMPORT_HISTORY_METHOD = "GET employees/import";'));
  const route = manifest.allApiRouteFiles["src/app/api/employees/import/route.ts"];
  assert.ok(route.methods.some(method => method.name === "GET"));
  for (const method of route.methods) assert.notEqual(method.status, "PUBLIC-BY-DESIGN",
    "Private import and history methods must never borrow the public CSV template disposition");
});

test("import-history proof refuses non-disposable hosts and uses real higher victim records", () => {
  for (const required of [
    'assert.equal(process.env.CI, "true")',
    'assert.equal(process.env.TENANT_SECOND_PASS_MODE, "isolated-ci-only")',
    'assert.equal(process.env.SECURITY_SMOKE_URL, "http://127.0.0.1:3000")',
    'assert.equal(url.port, "5432")', 'assert.equal(url.pathname, "/app_db")',
    'requireDisposableImportHistory();',
    'await db.insert(importBatches).values(',
    'const victim = rows[10];',
    'await db.select().from(importBatches).where(eq(importBatches.id, victim.id))',
    'assert.equal(persistedVictim?.organizationId, victimOrg.id)',
    'assert.ok(victim.id > 6 && victim.id > rows[8].id && victim.id > rows[9].id)',
    'for (const idx of [1, 2])',
  ]) assert.ok(source.includes(required), "Missing fail-closed fixture assertion: " + required);
});

test("each attacker must see real own rows before victim denial and forged-selector checks", () => {
  const own = source.indexOf('const own = expectStatus(await request("/api/employees/import?organizationId=" + ownOrg.id');
  const foreign = source.indexOf('const foreign = expectStatus(await request("/api/employees/import?organizationId=" + victimOrg.id');
  const forged = source.indexOf('const ignored = expectStatus(await request("/api/employees/import?organizationId=" + ownOrg.id');
  assert.ok(own > 0 && foreign > own && forged > foreign);
  assert.ok(source.includes('response.json.batches.length > 0'));
  assert.ok(source.includes('row.id === owned.id && row.fileName === owned.fileName'));
  assert.ok(source.includes('"&batchId=" + victim.id, { cookie }), 403'));
  assert.ok(source.includes('"&employeeId=" + victimEmployee.id + "&runId=" + victimRun.id'));
  assert.ok(source.includes('assertOwnHistory(ignored, ownOrg.id, owned, victim)'));
  assert.ok(source.includes('assert.deepEqual(ignored.json.batches, own.json.batches)'));
  assert.ok(source.includes('const before = await snapshotVictimImportHistory(victimOrg.id)'));
  assert.ok(source.includes('const after = await snapshotVictimImportHistory(victimOrg.id)'));
  assert.ok(source.includes('assert.deepEqual(after, before'));
  assert.ok(source.includes('assert.equal(receipts.length, 2)'));
});

test("a credited import-history method must reference all exact executed proof lines", () => {
  const method = manifest.allApiRouteFiles["src/app/api/employees/import/route.ts"].methods.find(x => x.name === "GET");
  if (method.status === "GAP") {
    assert.equal(method.testedBy, null, "Unexecuted or uncredited HTTP proof stays GAP");
    return;
  }
  assert.equal(method.status, "COVERED");
  assert.equal(method.testedBy?.file, file);
  const lines = source.split("\n");
  for (const [field, required] of Object.entries({
    line: 'export const IMPORT_HISTORY_METHOD = "GET employees/import";',
    ownPositiveLine: 'const own = expectStatus(await request(',
    foreignDenialLine: 'const foreign = expectStatus(await request(',
    forgedSelectorLine: 'const ignored = expectStatus(await request(',
    unchangedDbLine: 'assert.deepEqual(after, before',
  })) {
    const number = method.testedBy[field];
    assert.ok(Number.isInteger(number) && number > 0 && number <= lines.length, field);
    assert.ok(lines[number - 1].includes(required), field + " does not point to the live assertion");
  }
});

// Source guards catch missing named exports before the expensive HTTP job.
// They do not execute a database query or confer tenant-isolation coverage.
const schemaSource = readFileSync("src/db/schema.ts", "utf8");
const schemaExports = new Set([...schemaSource.matchAll(/^export\s+const\s+([A-Za-z_$][\w$]*)\s*=/gm)]
  .map(match => match[1]));

function assertDl01SchemaImports(moduleSource, moduleFile) {
  const declaration = moduleSource.match(/import\s*\{([^}]+)\}\s*from\s*"\.\.\/\.\.\/src\/db\/schema\.ts"/);
  assert.ok(declaration, moduleFile + ": explicit named schema imports are required");
  const names = declaration[1].split(",").map(name => name.trim()).filter(Boolean);
  assert.ok(names.length > 0, moduleFile + ": schema imports must not be empty");
  for (const name of names) {
    assert.ok(schemaExports.has(name), moduleFile + ": schema.ts does not export " + name);
  }
  assert.ok(names.includes("auditEvents"), moduleFile + ": retain the real audit-event table");
  assert.ok(moduleSource.includes(
    "db.select().from(auditEvents).where(eq(auditEvents.organizationId, organizationId)).orderBy(auditEvents.id)"),
  moduleFile + ": retain the organization-scoped, deterministic audit snapshot");
}

for (const moduleFile of [file, "scripts/qa/tenant-dl01-filing-file-http.mjs"]) {
  const moduleSource = readFileSync(moduleFile, "utf8");
  test(moduleFile + " imports real schema exports and retains victim audit snapshots", () => {
    assertDl01SchemaImports(moduleSource, moduleFile);
  });
  test(moduleFile + " guard rejects the auditLogs missing-export regression", () => {
    const broken = moduleSource.replace(/\bauditEvents\b/g, "auditLogs");
    assert.notEqual(broken, moduleSource);
    assert.throws(() => assertDl01SchemaImports(broken, moduleFile), /schema\.ts does not export auditLogs/);
  });
  test(moduleFile + " guard rejects removal of tenant-scoped audit snapshots", () => {
    const broken = moduleSource.replace(".where(eq(auditEvents.organizationId, organizationId))", "");
    assert.notEqual(broken, moduleSource);
    assert.throws(() => assertDl01SchemaImports(broken, moduleFile), /organization-scoped, deterministic audit snapshot/);
  });
}
