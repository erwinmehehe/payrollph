import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertSafeHostEnvironment, assertLoopbackUrl, assertBoundPort,
  buildLocalRuntime, onlySafeProcessEnvironment,
} from '../scripts/qa/uat853-local-lab.mjs';

const password = 'a'.repeat(48);
const keys = {
  BANK_DATA_ENCRYPTION_KEY: 'b'.repeat(64),
  PII_ENCRYPTION_KEY: 'c'.repeat(64),
  TOTP_ENCRYPTION_KEY: 'd'.repeat(64),
  SETUP_TOKEN: 'e'.repeat(64), READINESS_TOKEN: 'f'.repeat(64),
  WORKER_TOKEN: '1'.repeat(64),
};

test('remote or inherited production credential fails closed', () => {
  for (const bad of [
    { DATABASE_URL: 'postgresql://live@prod.neon.tech/db' },
    { POSTGRES_URL: 'postgresql://prod' },
    { POSTGRES_PRISMA_URL: 'postgresql://prod' },
    { CI: 'true' }, { GITHUB_ACTIONS: 'true' },
  ]) assert.throws(() => assertSafeHostEnvironment(bad), /UAT853_/);
  assert.doesNotThrow(() => assertSafeHostEnvironment({}));
});

test('target must always be local, named UAT db on original guarded port', () => {
  const url = 'postgresql://uat853_owner:' + password + '@127.0.0.1:5432/uat853';
  assert.doesNotThrow(() => assertLoopbackUrl(url));
  for (const bad of [
    url.replace('127.0.0.1', 'neon.tech'),
    url.replace('127.0.0.1', '0.0.0.0'),
    url.replace(':5432', ':6543'),
    url.replace('/uat853', '/neondb'),
    url.replace('uat853_owner', 'postgres'),
    url.replace(password, 'short'),
    url + '?sslmode=disable',
  ]) assert.throws(() => assertLoopbackUrl(bad));
  assert.doesNotThrow(() => assertBoundPort('127.0.0.1:5432\n'));
  assert.throws(() => assertBoundPort('0.0.0.0:5432'), /UAT853_/);
  assert.throws(() => assertBoundPort(':::5432'), /UAT853_/);
});

test('all money, biometric, scheduler and vendor paths remain OFF', () => {
  const app = buildLocalRuntime(password, keys);
  for (const f of [
    'PAYMONGO_DISBURSEMENTS_ENABLED', 'XENDIT_PAYOUTS_ENABLED',
    'XENDIT_PAYOUTS_LIVE_APPROVED', 'FINAL_PAY_MANUAL_RELEASE_ENABLED',
    'WFM_GEOFENCE_PILOT_ENABLED', 'WFM_PUNCH_EVIDENCE_ENABLED',
    'CENTRAL_SCHEDULER_ENABLED', 'WORKER_ENABLED',
  ]) assert.equal(app[f], 'false');
  assert.equal(app.DATABASE_URL.includes('neon.tech'), false);
  assert.equal(app.APP_BASE_URL, 'http://127.0.0.1:3000');
  for (const k of ['PAYMONGO_SECRET_KEY', 'XENDIT_SECRET_KEY', 'OPENAI_API_KEY'])
    assert.equal(app[k], '');
});

test('server env cannot inherit parent DB URLs, payment keys, or production flags', () => {
  const app = buildLocalRuntime(password, keys);
  const parent = { PATH: '/usr/bin', DATABASE_URL: 'postgresql://prod',
    XENDIT_SECRET_KEY: 'live', PAYMONGO_DISBURSEMENTS_ENABLED: 'true',
    NEXT_PUBLIC_PROMOTION_TOKEN: 'live', MAIL_HOST: 'production-smtp' };
  const result = onlySafeProcessEnvironment(parent, app);
  assert.equal(result.PATH, '/usr/bin');
  assert.equal(result.NODE_ENV, 'development');
  assert.notEqual(result.DATABASE_URL, parent.DATABASE_URL);
  assert.notEqual(result.XENDIT_SECRET_KEY, parent.XENDIT_SECRET_KEY);
  assert.equal(result.PAYMONGO_DISBURSEMENTS_ENABLED, 'false');
  assert.equal(result.NEXT_PUBLIC_PROMOTION_TOKEN, undefined);
  assert.equal(result.MAIL_HOST, undefined);
});

test('invalid encryption and database passwords fail closed', () => {
  assert.throws(() => buildLocalRuntime('short', keys));
  assert.throws(() => buildLocalRuntime(password,
    { ...keys, BANK_DATA_ENCRYPTION_KEY: 'plaintext' }));
});
