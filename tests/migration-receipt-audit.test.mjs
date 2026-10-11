import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { inventoryMigrationSources, reconcileMigrationReceipts } from '../scripts/lib/migration-receipt-audit.mjs';

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'payrollph-migration-audit-'));
  writeFileSync(join(dir, 'baseline.sql'), 'historical baseline\n');
  writeFileSync(join(dir, '0021_first.sql'), 'CREATE TABLE first (id int);\n');
  writeFileSync(join(dir, '0021_second.sql'), 'CREATE TABLE second (id int);\n');
  writeFileSync(join(dir, '0110_last.sql'), 'CREATE TABLE last (id int);\n');
  return dir;
}
function receipt(file, changes = {}) {
  return {
    migrationPath: file.path,
    sha256: file.sha256,
    disposition: 'applied',
    evidenceRef: 'DBA-CHANGE-2026-011',
    reviewedBy: 'DBA-APPROVER-01',
    recordedAt: new Date('2026-10-10T09:00:00Z'),
    ...changes,
  };
}
test('inventory is stable, exact-byte hashed and preserves colliding historical numbers', () => {
  const dir = fixture();
  try {
    const a = inventoryMigrationSources(dir);
    assert.equal(a.files.length, 3);
    assert.equal(a.baselinePresent, true);
    assert.equal(a.duplicatePrefixes.length, 1);
    assert.deepEqual(a.duplicatePrefixes[0].paths, [
      'drizzle/0021_first.sql', 'drizzle/0021_second.sql',
    ]);
    assert.equal(inventoryMigrationSources(dir).digest, a.digest);
    const oldHash = a.files[2].sha256;
    writeFileSync(join(dir, '0110_last.sql'), 'CREATE TABLE last (id bigint);\n');
    const changed = inventoryMigrationSources(dir);
    assert.notEqual(changed.files[2].sha256, oldHash);
    assert.notEqual(changed.digest, a.digest);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test('unexpected SQL file names and symlinked SQL are not silently assigned receipts', () => {
  const dir = fixture();
  try {
    writeFileSync(join(dir, 'unnumbered.sql'), 'SELECT 1');
    assert.throws(() => inventoryMigrationSources(dir), /Unclassified/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test('only separately evidenced full-path migration receipts reconcile', () => {
  const dir = fixture();
  try {
    const inv = inventoryMigrationSources(dir);
    const rows = inv.files.map(file => receipt(file));
    const clean = reconcileMigrationReceipts(inv, rows);
    assert.equal(clean.receiptsReconciled, true);
    assert.equal(clean.productionReleaseApproved, false);
    assert.equal(clean.migrationApplicationPerformed, false);
    assert.equal(clean.counts.applied, 3);
    assert.equal(clean.duplicatePrefixGroups, 1);
    const baseline = [...rows];
    baseline[1] = receipt(inv.files[1], { disposition: 'baseline-included' });
    assert.equal(reconcileMigrationReceipts(inv, baseline).receiptsReconciled, true);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test('missing, extra and duplicate receipts block release reconciliation', () => {
  const dir = fixture();
  try {
    const inv = inventoryMigrationSources(dir), rows = inv.files.map(file => receipt(file));
    assert.match(reconcileMigrationReceipts(inv, rows.slice(1)).issues.join(','), /missing_receipt/);
    assert.match(reconcileMigrationReceipts(inv, [...rows, rows[0]]).issues.join(','), /duplicate_receipt/);
    assert.match(reconcileMigrationReceipts(inv, [...rows, { ...rows[0], migrationPath: 'drizzle/0333_not_in_source.sql' }]).issues.join(','), /unexpected_receipt/);
    assert.equal(reconcileMigrationReceipts(inv, rows).receiptsReconciled, true);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test('checksum drift, unverified baseline, evidence omission and not-applied status fail closed', () => {
  const dir = fixture();
  try {
    const inv = inventoryMigrationSources(dir);
    const base = inv.files.map(file => receipt(file));
    const variants = [
      [{ ...base[0], sha256: '0'.repeat(64) }, /checksum_mismatch/],
      [{ ...base[0], disposition: 'not-applied' }, /not_applied/],
      [{ ...base[0], disposition: 'inferred' }, /unknown_disposition/],
      [{ ...base[0], disposition: 'baseline-included', evidenceRef: '' }, /missing_approval_evidence/],
      [{ ...base[0], reviewedBy: 'X' }, /missing_approval_evidence/],
      [{ ...base[0], recordedAt: 'not-a-date' }, /invalid_recorded_at/],
      [{ ...base[0], recordedAt: null }, /invalid_recorded_at/],
    ];
    for (const [different, expected] of variants) {
      const outcome = reconcileMigrationReceipts(inv, [different, ...base.slice(1)]);
      assert.equal(outcome.receiptsReconciled, false);
      assert.match(outcome.issues.join(' | '), expected);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test('read-only operator workflow is manual, pinned and does not run SQL changes', () => {
  const flow = readFileSync('.github/workflows/production-migration-receipts-audit.yml', 'utf8');
  const script = readFileSync('scripts/audit-production-migration-receipts.mjs', 'utf8');
  assert.match(flow, /workflow_dispatch:/);
  assert.match(flow, /environment: production/);
  assert.match(flow, /github\.ref == 'refs\/heads\/main'/);
  assert.match(flow, /REVIEWED_SHA.*inputs\.reviewed_sha/);
  assert.match(flow, /PRODUCTION_MIGRATION_AUDIT_DATABASE_URL/);
  assert.match(flow, /persist-credentials: false/);
  assert.ok(flow.indexOf('run: npm ci') < flow.indexOf('secrets.PRODUCTION_MIGRATION_AUDIT_DATABASE_URL'));
  assert.doesNotMatch(flow, /db:push|db:migrate|--apply|drizzle-kit push/);
  assert.match(script, /REPEATABLE READ, READ ONLY/);
  assert.match(script, /current_database\(\) = \$1::text/);
  assert.match(script, /pg_catalog\.pg_roles/);
  assert.doesNotMatch(script, /CREATE TABLE|ALTER TABLE|DROP TABLE|INSERT INTO|UPDATE .* SET/);
});
