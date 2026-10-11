import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const NUMBERED_SQL = /^([0-9]{4})_[a-z0-9][a-z0-9_-]*\.sql$/;
const HEX256 = /^[0-9a-f]{64}$/;
const RECEIPT_STATES = new Set(['applied', 'baseline-included', 'not-applied']);

/**
 * Inventories historical SQL by its *complete path*, never its 4-digit prefix.
 * Legacy collisions are retained as evidence, not silently reordered.
 * The unnumbered historical baseline is explicitly excluded from this list.
 */
export function inventoryMigrationSources(directory = 'drizzle') {
  const entries = readdirSync(directory, { withFileTypes: true });
  const sql = entries.filter(item => item.name.endsWith('.sql'));
  const invalid = sql.filter(item => !item.isFile() || (item.name !== 'baseline.sql' && !NUMBERED_SQL.test(item.name)));
  if (invalid.length) throw new Error('Unclassified, non-regular, or unsafe SQL files in migration directory.');
  const files = sql.filter(item => item.isFile() && NUMBERED_SQL.test(item.name))
    .map(item => {
      const bytes = readFileSync(join(directory, item.name));
      return {
        path: 'drizzle/' + item.name,
        prefix: item.name.slice(0, 4),
        sha256: createHash('sha256').update(bytes).digest('hex'),
      };
    })
    .sort((a, b) => a.path.localeCompare(b.path, 'en'));
  if (!files.length) throw new Error('No numbered SQL migrations were found.');
  const byPrefix = new Map();
  for (const f of files) byPrefix.set(f.prefix, [...(byPrefix.get(f.prefix) ?? []), f.path]);
  const duplicatePrefixes = [...byPrefix].filter(([, paths]) => paths.length > 1)
    .map(([prefix, paths]) => ({ prefix, paths })).sort((a, b) => a.prefix.localeCompare(b.prefix));
  const canonical = files.map(f => f.path + '\0' + f.sha256 + '\n').join('');
  return {
    files,
    duplicatePrefixes,
    digest: createHash('sha256').update(canonical, 'utf8').digest('hex'),
    baselinePresent: sql.some(item => item.name === 'baseline.sql'),
  };
}

function validEvidence(value) {
  return typeof value === 'string' && value.trim().length >= 8 && value.length <= 240 && !/[\r\n\0]/.test(value);
}

/**
 * Every retained SQL file requires separately reviewed DBA evidence.
 * Presence in Git does not prove that a migration ran in production.
 */
export function reconcileMigrationReceipts(inventory, receipts) {
  if (!Array.isArray(inventory?.files) || inventory.files.length === 0 || !Array.isArray(receipts)) {
    throw new Error('A nonempty migration inventory and receipt array are required.');
  }
  const expected = new Map(inventory.files.map(file => [file.path, file]));
  if (expected.size !== inventory.files.length) throw new Error('Migration inventory paths are ambiguous.');
  const seen = new Set();
  const issues = [];
  const counts = { applied: 0, baselineIncluded: 0, notApplied: 0 };
  for (const row of receipts) {
    const path = row?.migrationPath;
    if (typeof path !== 'string' || !/^drizzle\/[0-9]{4}_[a-z0-9][a-z0-9_-]*\.sql$/.test(path)) {
      issues.push('invalid_receipt_path');
      continue;
    }
    if (seen.has(path)) {
      issues.push('duplicate_receipt:' + path);
      continue;
    }
    seen.add(path);
    const file = expected.get(path);
    if (!file) {
      issues.push('unexpected_receipt:' + path);
      continue;
    }
    if (typeof row.sha256 !== 'string' || !HEX256.test(row.sha256) || row.sha256 !== file.sha256) {
      issues.push('checksum_mismatch:' + path);
    }
    if (!validEvidence(row.evidenceRef) || !validEvidence(row.reviewedBy)) {
      issues.push('missing_approval_evidence:' + path);
    }
    const date = row.recordedAt instanceof Date ? row.recordedAt : new Date(row.recordedAt);
    if (row.recordedAt == null || !Number.isFinite(date.getTime())) {
      issues.push('invalid_recorded_at:' + path);
    }
    if (!RECEIPT_STATES.has(row.disposition)) {
      issues.push('unknown_disposition:' + path);
    } else if (row.disposition === 'not-applied') {
      counts.notApplied += 1;
      issues.push('not_applied:' + path);
    } else if (row.disposition === 'applied') {
      counts.applied += 1;
    } else {
      counts.baselineIncluded += 1;
    }
  }
  for (const path of expected.keys()) {
    if (!seen.has(path)) issues.push('missing_receipt:' + path);
  }
  return {
    checkedFiles: inventory.files.length,
    receivedRows: receipts.length,
    duplicatePrefixGroups: inventory.duplicatePrefixes.length,
    counts,
    issues,
    receiptsReconciled: issues.length === 0,
    productionReleaseApproved: false,
    migrationApplicationPerformed: false,
  };
}
