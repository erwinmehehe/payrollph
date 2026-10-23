import assert from 'node:assert/strict';
import test from 'node:test';
import { auditSource, auditDirectory } from '../scripts/audit-runtime-schema-writers.mjs';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { symlinkSkip } from './helpers/symlink-capability.mjs';

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

test('source symlinks are rejected instead of followed', { skip: symlinkSkip }, () => {
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


test('read-only branch with only a conditional return cannot hide a legacy writer', () => {
  const code = `async function ensureUnsafe() {
    const mode = coreSchemaCompatibilityMode(process.env.CORE_SCHEMA_COMPATIBILITY_MODE);
    if (mode === "read-only") { if (featureEnabled) return; }
    await client.query("CREATE TABLE employees_unsafe(id integer)");
  }`;
  const findings = auditSource(code);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].state, 'unguarded');
});

test('direct strict parser and fail-closed throw protect backfill helpers', () => {
  const code = `async function backfillGovernmentIds() {
    if (coreSchemaCompatibilityMode(process.env.CORE_SCHEMA_COMPATIBILITY_MODE) === "read-only") {
      throw new Error("READONLY_BACKFILL_FORBIDDEN");
    }
    await client.query("UPDATE employees SET tin = 'encrypted'");
  }`;
  const findings = auditSource(code);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].type, 'IMPLICIT_BACKFILL');
  assert.equal(findings[0].state, 'early-readonly-exit');
});

test('an early branch containing schema DDL is still unsafe', () => {
  const code = `async function ensureUnsafe() {
    const mode = coreSchemaCompatibilityMode(process.env.CORE_SCHEMA_COMPATIBILITY_MODE);
    if (mode === "read-only") {
      await client.query("DROP TABLE payroll_entries");
      return;
    }
    await client.query("CREATE TABLE unsafe(id integer)");
  }`;
  const findings = auditSource(code);
  assert.equal(findings.length, 2);
  assert.ok(findings.every(f => f.state === 'unguarded'));
});

test('a fake mode binding or parser in a comment does not pass the source guard', () => {
  for (const code of [
    `async function ensureFake() {
      const mode = "read-only";
      // coreSchemaCompatibilityMode(process.env.CORE_SCHEMA_COMPATIBILITY_MODE);
      if (mode === "read-only") return;
      await client.query("CREATE TABLE unsafe(id integer)");
    }`,
    `async function ensureLate() {
      if (mode === "read-only") return;
      const mode = coreSchemaCompatibilityMode(process.env.CORE_SCHEMA_COMPATIBILITY_MODE);
      await client.query("CREATE TABLE unsafe(id integer)");
    }`,
  ]) {
    assert.equal(auditSource(code)[0].state, 'unguarded');
  }
});


test('mutable schema mode never qualifies as a fail-closed early exit', () => {
  for (const keyword of ['let', 'var']) {
    const source = `async function ensureUnsafeSchema() {
      ${keyword} mode = coreSchemaCompatibilityMode(process.env.CORE_SCHEMA_COMPATIBILITY_MODE);
      mode = "legacy";
      if (mode === "read-only") return;
      await client.query("CREATE TABLE accidentally_unprotected (id integer)");
    }`;
    const findings = auditSource(source);
    assert.equal(findings.length, 1);
    assert.equal(findings[0].state, 'unguarded');
  }
});

test('catalog verifier delegates only recognize imported reviewed callbacks', () => {
  const verified = `import { verifyRequestSchemaReadOnly } from "@/lib/request-schema-readonly";
  async function ensureAudited() {
    const mode = coreSchemaCompatibilityMode(process.env.CORE_SCHEMA_COMPATIBILITY_MODE);
    if (mode === "read-only") {
      await verifyRequestSchemaReadOnly((sql, args) => connected.query(sql, args), spec);
      return;
    }
    await connected.query("ALTER TABLE employees ADD COLUMN score integer");
  }`;
  const findings = auditSource(verified);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].type, 'DDL');
  assert.equal(findings[0].state, 'early-readonly-exit');

  const fakeImport = verified.replace('import { verifyRequestSchemaReadOnly } from "@/lib/request-schema-readonly";', '');
  const unknown = auditSource(fakeImport);
  assert.equal(unknown.length, 2);
  assert.ok(unknown.some(row => row.type === 'DYNAMIC_QUERY_REVIEW' && row.state === 'unguarded'));

  const injectedWrite = verified.replace('connected.query(sql, args)', 'connected.query("DROP TABLE employee_records")');
  assert.ok(auditSource(injectedWrite).some(row => row.type === 'DDL' && row.state === 'unguarded'));
});

test('try-finally read-only validation with mandatory return protects a later backfill', () => {
  const code = `async function ensureEmployeePayProfiles() {
    const mode = coreSchemaCompatibilityMode(process.env.CORE_SCHEMA_COMPATIBILITY_MODE);
    if (mode === "read-only") {
      try {
        await connected.query("SELECT 1");
        return;
      } finally {
        connected.release();
      }
    }
    await connected.query("INSERT INTO employee_pay_profiles SELECT * FROM employees");
  }`;
  const findings = auditSource(code);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].type, 'IMPLICIT_BACKFILL');
  assert.equal(findings[0].state, 'early-readonly-exit');
});

test('retired sibling schema helpers contain no request-time schema writers', () => {
  // Only core-schema-compat.ts may still carry legacy writers until it is retired.
  const report = auditDirectory(fileURLToPath(new URL('../src', import.meta.url)), fileURLToPath(new URL('..', import.meta.url)));
  const files = [...new Set(report.findings.map(f => f.file.replaceAll('\\', '/')))];
  assert.deepEqual(files, ['src/lib/core-schema-compat.ts']);
  assert.equal(report.unguarded, 0);
});
