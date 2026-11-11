import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {
  ORIGIN, requireDisposableHrPageEnv, verifyHrPageSourcePins,
  assertDeniedHrResponse, assertReadOnlySql,
} from '../scripts/qa/tenant-hr-cases-page-contract.mjs';

const source = readFileSync('scripts/qa/tenant-hr-cases-patch-http.mjs', 'utf8');
const env = {
  GITHUB_ACTIONS: 'true', CI: 'true', NODE_ENV: 'production',
  TENANT_HR_CASE_PAGE_PROOF: 'fictional-pg16-only',
  BUILD_BLOCK_ACCEPTANCE_MODE: 'synthetic-postgres-only',
  DATABASE_URL: 'postgresql://postgres:postgres@127.0.0.1:5432/app_db',
  APP_BASE_URL: ORIGIN, SECURITY_SMOKE_URL: ORIGIN,
  TRUSTED_APP_ORIGINS: ORIGIN, EMPLOYEE_HR_CASES_ENABLED: 'true',
  MULTI_ENTITY_ENABLED: 'false', EMPLOYEE_DOCUMENT_VAULT_ENABLED: 'false',
  DEMO_MODE: 'false', REQUIRE_PRIVILEGED_MFA: 'true',
  WORKER_ENABLED: 'false', CENTRAL_SCHEDULER_ENABLED: 'false',
  PAYMONGO_DISBURSEMENTS_ENABLED: 'false', XENDIT_PAYOUTS_ENABLED: 'false',
  XENDIT_BILLING_ENABLED: 'false', FINAL_PAY_SIGNED_REVIEW_ENABLED: 'false',
  EXACT_THIRTEENTH_CENTAVOS_ENABLED: 'false',
  PAYROLL_CALCULATION_HISTORY_ENABLED: 'false',
};

test('write proof refuses production, external providers and enabled money/worker features', () => {
  assert.equal(requireDisposableHrPageEnv(env), true);
  for (const [key, value] of Object.entries({
    DATABASE_URL: 'postgresql://postgres:postgres@live.invalid:5432/app_db',
    APP_BASE_URL: 'https://live.invalid',
    EMPLOYEE_DOCUMENT_VAULT_ENABLED: 'true',
    XENDIT_PAYOUTS_ENABLED: 'true',
    PAYMONGO_DISBURSEMENTS_ENABLED: 'true',
    WORKER_ENABLED: 'true', OPENAI_API_KEY: 'forbidden',
    RESEND_API_KEY: 'forbidden', GITHUB_ACTIONS: 'false',
  })) assert.throws(() => requireDisposableHrPageEnv({...env, [key]: value}),
    /HR_CASE_PAGE_REFUSED/, key);
});

test('proof source is tied to the existing exact-source contract before app imports', () => {
  assert.ok(source.indexOf('requireDisposableHrPageEnv();') >= 0);
  assert.ok(source.indexOf('verifyHrPageSourcePins();') >= 0);
  assert.ok(source.indexOf('verifyHrPageSourcePins();') <
    source.indexOf("import('../../src/db/index.ts')"));
  assert.ok(source.includes("assert.equal((await db.select().from(s.users).limit(1)).length, 0"));
  assert.ok(source.includes("import('./tenant-table-http.mjs')"));
  assert.ok(source.includes("'SHOW server_version_num'"));
  assert.ok(source.includes("assert.equal(new Set(allActors.map(actor => actor.cookie)).size, 3)"));
  assert.equal(verifyHrPageSourcePins(), true);
});

test('own results require persisted audit/messages and no victim SQL change', () => {
  assert.ok(source.includes("assert.equal(resp.status, 200"));
  assert.ok(source.includes("after.auditEvents.length, before.auditEvents.length + 1"));
  assert.ok(source.includes("after.employeeHrCaseMessages.length, before.employeeHrCaseMessages.length + 1"));
  assert.ok(source.includes("await verifyVictim('positive action')"));
  assert.match(source, /await own\(a\.cookie, a, aHr\.id, 'reply'\)/);
  assert.match(source, /await own\(b\.cookie, b, bHr\.id, 'reply'\)/);
});

test('wrong employer, role, department, anonymous and revoked writes are checked', () => {
  for (const value of [
    'forged victim employer/worker', 'HR reviewer cannot change payroll case',
    'Payroll reviewer cannot change HR case', 'Unit HR cannot change other-unit case',
    'Bookkeeper cannot change HR case', 'Anonymous user cannot change HR case',
    'Revoked membership must deny write',
  ]) assert.ok(source.includes(value), value);
  assert.match(source, /assertDeniedHrResponse\(resp, expected, allActors, label\)/);
  assert.match(source, /assert\.deepEqual\(await snapshot\(allActors\[n\]\.org\.id\), before\[n\]/);
  assert.match(source, /const intactSession = await request\('\/api\/account', a\.cookie, 'GET'\)/);
});

test('negative controls reject fake positive, leaked marker and changed protected SQL', () => {
  const victim = {label: 'VICTIM', marker: 'FICTIONAL-VICTIM-SECRET'};
  const denied = (status, text, json) => ({status, text, json});
  assert.doesNotThrow(() => assertDeniedHrResponse(
    denied(404, '{"error":"Case not found."}', {error: 'Case not found.'}),
    404, [victim], 'foreign'));
  assert.throws(() => assertDeniedHrResponse(
    denied(200, '{}', {}), 404, [victim], 'forged success'));
  assert.throws(() => assertDeniedHrResponse(
    denied(404, victim.marker, {}), 404, [victim], 'leaked case'));
  assert.throws(() => assertReadOnlySql(
    {cases: [{id: 1}], audit: []}, {cases: [], audit: []}, 'victim altered'));
});
