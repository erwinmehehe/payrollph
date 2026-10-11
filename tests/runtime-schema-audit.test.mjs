import assert from 'node:assert/strict';
import test from 'node:test';
import { auditSource, auditDirectory } from '../scripts/audit-runtime-schema-writers.mjs';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const before = `
export async function ensureDoleReportingSchema() {
  if (ready) return;
  inFlight = (async () => {
    const client = await pool.connect();
    await client.query("CREATE TABLE IF NOT EXISTS dole_reporting_profiles (id integer)");
    await client.query("CREATE UNIQUE INDEX my_idx ON dole_reporting_profiles(id)");
  })();
}`;

const after = `
export async function ensureDoleReportingSchema() {
  const mode = coreSchemaCompatibilityMode(process.env.CORE_SCHEMA_COMPATIBILITY_MODE);
  if (mode === "read-only") {
    await verifyRequestSchemaReadOnly(query, doleReportingSchemaSpec);
    return;
  }
  if (ready) return;
  inFlight = (async () => {
    const client = await pool.connect();
    await client.query("CREATE TABLE IF NOT EXISTS dole_reporting_profiles (id integer)");
    await client.query("CREATE UNIQUE INDEX my_idx ON dole_reporting_profiles(id)");
  })();
}`;

test('finds unguarded DDL in nested lifecycle callback', () => {
  const findings = auditSource(before, 'src/lib/dole-reporting-schema.ts');
  assert.equal(findings.length, 2);
  assert.ok(findings.every(x => x.type === 'DDL' && x.state === 'unguarded'));
  assert.ok(findings.every(x => x.owner === 'ensureDoleReportingSchema'));
});

test('early read-only exit is credited without claiming production safety', () => {
  const findings = auditSource(after);
  assert.equal(findings.length, 2);
  assert.ok(findings.every(x => x.state === 'early-readonly-exit'));
  assert.ok(findings.every(x => x.evidence.includes('catalog')));
});

test('a late read-only branch does not shield earlier DDL', () => {
  const code = `async function ensurePaySchema() {
    await db.query("ALTER TABLE employees ADD COLUMN foo text");
    const mode = coreSchemaCompatibilityMode(process.env.CORE_SCHEMA_COMPATIBILITY_MODE);
    if (mode === 'read-only') { await verifyRequestSchemaReadOnly(q,s); return; }
  }`;
  const findings = auditSource(code);
  assert.equal(findings[0].state, 'unguarded');
});

test('implicit backfills in lifecycle functions are detected but normal CRUD is not', () => {
  const code = `async function ensurePayProfiles() {
    await client.query("INSERT INTO employee_pay_profiles SELECT * FROM employees");
    await client.query("UPDATE employee_pay_profiles SET rate_amount = 0");
  }
  async function saveProfile() {
    await client.query("UPDATE employees SET first_name = $1 WHERE id = $2");
  }`;
  const findings = auditSource(code);
  assert.equal(findings.length, 2);
  assert.ok(findings.every(x => x.type === 'IMPLICIT_BACKFILL'));
});

test('comments and error messages are not misclassified as executable SQL', () => {
  const code = `// CREATE TABLE employees (id int);
  function noWrite() { throw new Error("never CREATE TABLE during requests"); }`;
  assert.deepEqual(auditSource(code), []);
});

test('dynamic SQL inside lifecycle helpers fails closed as requiring review', () => {
  const code = `async function ensureSchema() {
    const sql = resolveSchemaSql();
    await pool.query(sql);
  }`;
  const records = auditSource(code);
  assert.equal(records.length, 1);
  assert.equal(records[0].type, 'DYNAMIC_QUERY_REVIEW');
  assert.equal(records[0].state, 'unguarded');
});

test('concatenation and SQL tagged templates are detected without duplicates', () => {
  const code = 'async function ensureSchema() { ' +
    'await client.query("ALTER TABLE " + "employees ADD COLUMN x text"); ' +
    'await db.execute(sql' + String.fromCharCode(96) +
    'CREATE UNIQUE INDEX test_idx ON employees(id)' + String.fromCharCode(96) + '); }';
  const records = auditSource(code);
  assert.deepEqual(records.map(x => x.type), ['DDL', 'DDL']);
});

test('directory inventory includes all findings and remains source-only', () => {
  const dir = mkdtempSync(join(tmpdir(), 'runtime-schema-audit-'));
  try {
    mkdirSync(join(dir, 'lib'));
    writeFileSync(join(dir, 'lib', 'unsafe.ts'), before);
    writeFileSync(join(dir, 'lib', 'guarded.ts'), after);
    const report = auditDirectory(dir, dir);
    assert.equal(report.filesScanned, 2);
    assert.equal(report.unguarded, 2);
    assert.equal(report.earlyReadOnlyExit, 2);
    assert.equal(report.databaseConnected, false);
    assert.equal(report.productionReleaseApproved, false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('source symlinks are rejected instead of followed', () => {
  const dir = mkdtempSync(join(tmpdir(), 'runtime-schema-audit-'));
  try {
    writeFileSync(join(dir, 'src.ts'), before);
    symlinkSync(join(dir, 'src.ts'), join(dir, 'alias.ts'));
    assert.throws(() => auditDirectory(dir, dir), /Refusing symlinked source/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('strict CLI exits nonzero for unguarded SQL and zero for guarded SQL', () => {
  const script = fileURLToPath(new URL('../scripts/audit-runtime-schema-writers.mjs', import.meta.url));
  const dir = mkdtempSync(join(tmpdir(), 'runtime-schema-cli-'));
  try {
    writeFileSync(join(dir, 'schema.ts'), before);
    const fail = spawnSync(process.execPath, [script, '--strict', dir], { encoding:'utf8' });
    assert.equal(fail.status, 1);
    assert.equal(JSON.parse(fail.stdout).unguarded, 2);
    writeFileSync(join(dir, 'schema.ts'), after);
    const pass = spawnSync(process.execPath, [script, '--strict', dir], { encoding:'utf8' });
    assert.equal(pass.status, 0);
    assert.equal(JSON.parse(pass.stdout).earlyReadOnlyExit, 2);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('named arrow-function legacy helper is discovered and source-guarded', () => {
  const code = `const ensureCoreSchema = async () => {
    const mode = coreSchemaCompatibilityMode(process.env.CORE_SCHEMA_COMPATIBILITY_MODE);
    if (mode === 'read-only') { await verifyCoreSchemaReadOnly(q); return; }
    await pool.query("CREATE TABLE test_guard(id integer)");
  };`;
  const findings = auditSource(code);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].owner, 'ensureCoreSchema');
  assert.equal(findings[0].state, 'early-readonly-exit');
});
