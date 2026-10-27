// Explicit local counterpart to the existing CI-only fixture installer. Never
// spoof GITHUB_ACTIONS or relax its guard to prepare a local disposable database.
import assert from 'node:assert/strict';
import pg from 'pg';
import { hcmWorkItemFixtureSql } from './prepare-hcm-work-item-fixture.mjs';

assert.equal(process.env.LOCAL_TENANT_READ_RECOVERY, 'fictional-disposable-only');
assert.equal(process.env.DATABASE_URL, 'postgresql://postgres:postgres@127.0.0.1:5432/app_db');
assert.equal(process.env.PAYMONGO_DISBURSEMENTS_ENABLED, 'false');
assert.equal(process.env.XENDIT_PAYOUTS_ENABLED, 'false');
assert.ok(!process.env.PAYMONGO_SECRET_KEY && !process.env.XENDIT_SECRET_KEY);
const client = new pg.Client(process.env.DATABASE_URL);
await client.connect();
try {
  await client.query('BEGIN');
  await client.query('LOCK TABLE organizations, audit_events IN ACCESS EXCLUSIVE MODE');
  const { rows: [scope] } = await client.query("SELECT current_database() AS db, current_user AS role, current_setting('server_version_num')::int AS version, (SELECT count(*)::int FROM organizations) AS employers, (SELECT count(*)::int FROM audit_events) AS audits");
  assert.equal(scope.db, 'app_db'); assert.equal(scope.role, 'postgres');
  assert.ok([16, 18].includes(Math.floor(scope.version / 10000)));
  assert.equal(scope.employers, 0); assert.equal(scope.audits, 0);
  await client.query(hcmWorkItemFixtureSql());
  await client.query('COMMIT');
  console.log(JSON.stringify({ kind: 'local-reviewed-0104', version: scope.version, employers: 0, audits: 0 }));
} catch (error) { await client.query('ROLLBACK'); throw error; }
finally { await client.end(); }
