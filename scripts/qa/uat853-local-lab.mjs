#!/usr/bin/env node
/**
 * #988: opt-in disposable PostgreSQL 16 on one trusted QA workstation.
 * NO remote database or production Vercel access. NO human UAT certification.
 */
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { originFromTailscaleStatus, assertPrivateServeOnly, privateUatRuntime } from './uat853-private-tailnet.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const PRIVATE = resolve(ROOT, 'qa-artifacts/uat853-local-lab');
const STATE = resolve(PRIVATE, 'state.json');
const DOCKER_ENV = resolve(PRIVATE, 'postgres.env');
const APP_ENV = resolve(PRIVATE, 'app.env');
const PG_IMAGE = 'postgres:16';
const DB = 'uat853';
const DB_USER = 'uat853_owner';
const LOOPBACK = '127.0.0.1';
const PG_PORT = 5432; // The existing reviewed db:push guard accepts only this port.
const unsafeFlags = [
  'PAYMONGO_DISBURSEMENTS_ENABLED', 'XENDIT_PAYOUTS_ENABLED',
  'XENDIT_PAYOUTS_LIVE_APPROVED', 'FINAL_PAY_MANUAL_RELEASE_ENABLED',
  'WFM_GEOFENCE_PILOT_ENABLED', 'WFM_PUNCH_EVIDENCE_ENABLED',
  'CENTRAL_SCHEDULER_ENABLED', 'WORKER_ENABLED',
];

export function assertSafeHostEnvironment(env) {
  assert.notEqual(env.GITHUB_ACTIONS, 'true', 'UAT853_NO_GITHUB_HOSTED_SERVICE');
  assert.notEqual(env.CI, 'true', 'UAT853_NO_CI_LAB');
  assert.ok(!env.DATABASE_URL, 'UAT853_REMOVE_INHERITED_DATABASE_URL');
  assert.ok(!env.POSTGRES_URL && !env.POSTGRES_PRISMA_URL,
    'UAT853_REMOVE_INHERITED_POSTGRES_CREDENTIALS');
  if (env.DOCKER_HOST) assertLocalDockerEndpoint(env.DOCKER_HOST);
}
export function assertLoopbackUrl(value) {
  const u = new URL(value);
  assert.equal(u.protocol, 'postgresql:');
  assert.equal(u.hostname, LOOPBACK);
  assert.equal(u.port, String(PG_PORT));
  assert.equal(u.pathname, '/' + DB);
  assert.equal(u.username, DB_USER);
  assert.ok(u.password.length >= 32 && !u.search && !u.hash, 'UAT853_DB_URL_INVALID');
}
export function buildLocalRuntime(password, keys) {
  assert.match(password, /^[a-f0-9]{48}$/);
  for (const key of ['BANK_DATA_ENCRYPTION_KEY', 'PII_ENCRYPTION_KEY',
    'TOTP_ENCRYPTION_KEY']) assert.match(keys[key] ?? '', /^[a-f0-9]{64}$/);
  const env = {
    DATABASE_URL: 'postgresql://' + DB_USER + ':' + password + '@' + LOOPBACK + ':' + PG_PORT + '/' + DB,
    APP_BASE_URL: 'http://127.0.0.1:3000',
    TRUSTED_APP_ORIGINS: 'http://127.0.0.1:3000',
    QA_URL: 'http://127.0.0.1:3000',
    DEMO_MODE: 'false', REQUIRE_PRIVILEGED_MFA: 'false',
    NEXT_TELEMETRY_DISABLED: '1',
    ...Object.fromEntries(unsafeFlags.map(x => [x, 'false'])),
    ...keys,
    OPENAI_API_KEY: '', PAYMONGO_SECRET_KEY: '', XENDIT_SECRET_KEY: '',
    SMTP_HOST: '', SMTP_USER: '', SMTP_PASSWORD: '',
  };
  assertLoopbackUrl(env.DATABASE_URL);
  for (const flag of unsafeFlags) assert.equal(env[flag], 'false');
  return env;
}
export function onlySafeProcessEnvironment(parent, app) {
  const allowed = ['PATH', 'HOME', 'USER', 'USERPROFILE', 'SYSTEMROOT',
    'SystemRoot', 'WINDIR', 'COMSPEC', 'APPDATA', 'LOCALAPPDATA',
    'TMP', 'TEMP', 'TMPDIR', 'LANG', 'TERM'];
  const filtered = Object.fromEntries(allowed.filter(k => parent[k] != null)
    .map(k => [k, parent[k]]));
  return { ...filtered, ...app, NODE_ENV: 'development' };
}
export function assertLocalDockerEndpoint(value) {
  assert.ok(typeof value === 'string' &&
    (value.startsWith('unix:///') || value.startsWith('npipe:////./pipe/')),
    'UAT853_REMOTE_DOCKER_DAEMON_REFUSED');
}
export function assertBoundPort(output) {
  assert.equal(output.trim(), '127.0.0.1:5432',
    'UAT853_DATABASE_PORT_NOT_BOUND_TO_LOOPBACK');
}
function npmProcess(args) {
  // All arguments here are program-owned fixed subcommands; no user text.
  return process.platform === 'win32'
    ? ['cmd.exe', ['/d', '/s', '/c', 'npm ' + args.join(' ')]]
    : ['npm', args];
}
function run(file, args, options = {}) {
  const result = spawnSync(file, args, {
    cwd: ROOT, encoding: 'utf8', windowsHide: true,
    timeout: options.timeout ?? 90000, maxBuffer: 4 * 1024 * 1024,
    env: options.env ?? process.env, input: options.input,
  });
  if (result.error || result.status !== 0) {
    // Never reflect raw command stdout/stderr, which might include credentials.
    throw new Error('UAT853_COMMAND_FAILED_' + file.replace(/[^a-z0-9]/gi, ''));
  }
  return result.stdout.trim();
}
function gitSha() {
  const sha = execFileSync('git', ['-C', ROOT, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  assert.match(sha, /^[a-f0-9]{40}$/);
  return sha;
}
function assertCleanCheckout() {
  assert.equal(run('git', ['status', '--porcelain']), '',
    'UAT853_CHECKOUT_DIRTY_ARCHIVE_AND_REINITIALIZE');
}
function assertNoDotenv() {
  for (const file of ['.env', '.env.local', '.env.development', '.env.development.local']) {
    assert.ok(!existsSync(resolve(ROOT, file)),
      'UAT853_DOTENV_MAY_LOAD_REAL_CREDENTIALS_USE_CLEAN_CHECKOUT');
  }
}
function privateWrite(path, content) {
  writeFileSync(path, content, { flag: 'wx', mode: 0o600 });
}
function parseEnv(contents) {
  const entries = contents.trimEnd().split('\n').map(x => {
    const i = x.indexOf('=');
    assert.ok(i > 0, 'UAT853_MALFORMED_ENV_FILE');
    return [x.slice(0, i), x.slice(i + 1)];
  });
  const env = Object.fromEntries(entries);
  assert.equal(Object.keys(env).length, entries.length, 'UAT853_DUPLICATE_ENV_KEY');
  return env;
}
function readSession(requireSameSha = true) {
  assert.ok(existsSync(STATE) && existsSync(APP_ENV) && existsSync(DOCKER_ENV),
    'UAT853_NO_INITIALIZED_SESSION');
  const state = JSON.parse(readFileSync(STATE, 'utf8'));
  assert.equal(state.kind, 'fictional-local-disposable-pg16');
  assert.match(state.sha, /^[a-f0-9]{40}$/);
  assert.equal(state.container, 'payrollph-uat853-' + state.sha.slice(0, 12));
  if (requireSameSha) assert.equal(state.sha, gitSha(), 'UAT853_SOURCE_SHA_CHANGED');
  const app = parseEnv(readFileSync(APP_ENV, 'utf8'));
  assertLoopbackUrl(app.DATABASE_URL);
  for (const flag of unsafeFlags) assert.equal(app[flag], 'false');
  assert.equal(app.APP_BASE_URL, 'http://127.0.0.1:3000');
  return { state, app };
}
function assertLocalDockerDaemon() {
  const endpoint = run('docker', ['context', 'inspect', '--format',
    '{{ (index .Endpoints "docker").Host }}']);
  assertLocalDockerEndpoint(endpoint);
}
function assertOwnContainer(state) {
  assertLocalDockerDaemon();
  const actualLabel = run('docker', ['inspect', '--format',
    '{{ index .Config.Labels "org.payrollph.uat853" }}', state.container]);
  assert.equal(actualLabel, state.sha, 'UAT853_FOREIGN_CONTAINER_REFUSED');
  const image = run('docker', ['inspect', '--format', '{{ .Config.Image }}', state.container]);
  assert.equal(image, PG_IMAGE, 'UAT853_CONTAINER_IMAGE_MISMATCH');
  assertBoundPort(run('docker', ['port', state.container, '5432/tcp']));
  run('docker', ['exec', state.container, 'pg_isready', '-U', DB_USER, '-d', DB]);
  const details = run('docker', ['exec', state.container, 'psql', '-X', '-A', '-t',
    '-v', 'ON_ERROR_STOP=1', '-U', DB_USER, '-d', DB, '-c',
    "SELECT current_database(), current_setting('server_version_num'), current_setting('server_encoding')"]);
  const [dbname, version, encoding] = details.split('|');
  assert.equal(dbname, DB);
  assert.ok(Number(version) >= 160000 && Number(version) < 170000, 'UAT853_PG16_ONLY');
  assert.equal(encoding, 'UTF8');
}
function databaseTableCount(state) {
  return Number(run('docker', ['exec', state.container, 'psql', '-X', '-A', '-t',
    '-v', 'ON_ERROR_STOP=1', '-U', DB_USER, '-d', DB, '-c',
    "SELECT count(*) FROM pg_catalog.pg_tables WHERE schemaname='public'" ]));
}
function start() {
  assertSafeHostEnvironment(process.env);
  assertNoDotenv();
  assertCleanCheckout();
  assert.ok(!existsSync(PRIVATE), 'UAT853_EXISTING_SESSION_PRESERVE_EVIDENCE_FIRST');
  run('docker', ['version', '--format', '{{.Server.Version}}']);
  assertLocalDockerDaemon();
  mkdirSync(PRIVATE, { recursive: true, mode: 0o700 });
  const sha = gitSha();
  const state = { kind: 'fictional-local-disposable-pg16', sha,
    container: 'payrollph-uat853-' + sha.slice(0, 12),
    schemaReady: false, createdAt: new Date().toISOString() };
  const password = randomBytes(24).toString('hex');
  const keys = Object.fromEntries([
    'BANK_DATA_ENCRYPTION_KEY', 'PII_ENCRYPTION_KEY', 'TOTP_ENCRYPTION_KEY',
  ].map(x => [x, randomBytes(32).toString('hex')]));
  for (const key of ['SETUP_TOKEN', 'READINESS_TOKEN', 'WORKER_TOKEN']) {
    keys[key] = randomBytes(32).toString('hex');
  }
  const app = buildLocalRuntime(password, keys);
  const appText = Object.entries(app).map(([k, v]) => k + '=' + v).join('\n') + '\n';
  const dockerText = 'POSTGRES_USER=' + DB_USER + '\n' + 'POSTGRES_PASSWORD=' + password + '\n' + 'POSTGRES_DB=' + DB + '\n' + 'POSTGRES_INITDB_ARGS=--encoding=UTF8\n';
  let created = false;
  try {
    privateWrite(APP_ENV, appText);
    privateWrite(DOCKER_ENV, dockerText);
    run('docker', ['run', '--rm', '--detach', '--name', state.container,
      '--label', 'org.payrollph.uat853=' + sha,
      '--publish', '127.0.0.1:5432:5432', '--env-file', DOCKER_ENV, PG_IMAGE],
      { timeout: 180000 });
    created = true;
    let ready = false;
    for (let i = 0; i < 40; i++) {
      try { assertOwnContainer(state); ready = true; break; }
      catch { const pause = new Int32Array(new SharedArrayBuffer(4)); Atomics.wait(pause, 0, 0, 1000); }
    }
    assert.ok(ready, 'UAT853_PG_SERVICE_NOT_READY');
    assert.equal(databaseTableCount(state), 0, 'UAT853_DATABASE_NOT_EMPTY');
    privateWrite(STATE, JSON.stringify(state, null, 2) + '\n');
    console.log('PASS: empty disposable PostgreSQL 16 on 127.0.0.1:5432');
    console.log('Source SHA: ' + sha);
    console.log('Credentials are private in gitignored qa-artifacts; not printed.');
  } catch (error) {
    if (created) try { run('docker', ['stop', state.container]); } catch { /* report original */ }
    rmSync(PRIVATE, { recursive: true, force: true });
    throw error;
  }
}
function migrate() {
  assertSafeHostEnvironment(process.env);
  assertNoDotenv();
  assertCleanCheckout();
  const { state, app } = readSession();
  assertOwnContainer(state);
  assert.equal(state.schemaReady, false, 'UAT853_ALREADY_MIGRATED');
  assert.equal(databaseTableCount(state), 0, 'UAT853_REFUSE_NONEMPTY_DATABASE');
  const env = onlySafeProcessEnvironment(process.env, app);
  const [npm, npmArgs] = npmProcess(['run', 'db:push']);
  run(npm, npmArgs, { env, timeout: 240000 });
  // Additional 0109 append-only audit guard, also in the isolated CI workflow.
  const before = run('docker', ['exec', state.container, 'psql', '-X', '-A', '-t',
    '-v', 'ON_ERROR_STOP=1', '-U', DB_USER, '-d', DB, '-c',
    "SELECT (to_regclass('public.audit_events') IS NOT NULL), (to_regclass('public.organizations') IS NOT NULL)"]);
  assert.equal(before, 't|t', 'UAT853_EXPECTED_SCHEMA_MISSING');
  const counts = run('docker', ['exec', state.container, 'psql', '-X', '-A', '-t',
    '-v', 'ON_ERROR_STOP=1', '-U', DB_USER, '-d', DB, '-c',
    'SELECT (SELECT count(*) FROM organizations), (SELECT count(*) FROM audit_events)']);
  assert.equal(counts, '0|0', 'UAT853_NONEMPTY_EMPLOYER_OR_AUDIT_REFUSED');
  const sql = readFileSync(resolve(ROOT, 'drizzle/0109_tamper_evident_audit_chain.sql'), 'utf8');
  run('docker', ['exec', '-i', state.container, 'psql', '-X', '-v', 'ON_ERROR_STOP=1',
    '-U', DB_USER, '-d', DB], { input: sql, timeout: 180000 });
  const trigger = run('docker', ['exec', state.container, 'psql', '-X', '-A', '-t',
    '-v', 'ON_ERROR_STOP=1', '-U', DB_USER, '-d', DB, '-c',
    "SELECT t.tgenabled, p.proname FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid WHERE t.tgrelid='public.audit_events'::regclass AND t.tgname='audit_events_protect_mutation' AND NOT t.tgisinternal"]);
  assert.equal(trigger, 'O|audit_events_protect', 'UAT853_AUDIT_TRIGGER_MISSING');
  state.schemaReady = true;
  writeFileSync(STATE, JSON.stringify(state, null, 2) + '\n', { mode: 0o600 });
  console.log('PASS: isolated local schema and append-only audit guard installed.');
  console.log('Do not mark UAT PASS; real operators must observe the UI.');
}
function status() {
  assertSafeHostEnvironment(process.env);
  const { state } = readSession();
  assertOwnContainer(state);
  console.log('PASS: localhost PostgreSQL 16 / UTF8 / fictional-only lab');
  console.log('Checkout SHA: ' + state.sha);
  console.log('Local schema marked ready: ' + state.schemaReady);
  console.log('Independent human acceptance: NOT_RUN. Pilot: NO-GO.');
}
function serve() {
  assertSafeHostEnvironment(process.env);
  assertNoDotenv();
  assertCleanCheckout();
  const { state, app } = readSession();
  assertOwnContainer(state);
  assert.equal(state.schemaReady, true, 'UAT853_SCHEMA_NOT_PROVISIONED');
  const env = onlySafeProcessEnvironment(process.env, app);
  console.log('Serving only 127.0.0.1:3000 (NOT accessible from physical phones).');
  const [npm, npmArgs] = npmProcess(['run', 'dev', '--', '--hostname', '127.0.0.1', '--port', '3000']);
  const child = spawnSync(npm, npmArgs,
    { cwd: ROOT, env, stdio: 'inherit', windowsHide: true });
  process.exitCode = child.status ?? 1;
}
function servePrivate() {
  assertSafeHostEnvironment(process.env);
  assertNoDotenv();
  assertCleanCheckout();
  const { state, app } = readSession();
  assertOwnContainer(state);
  assert.equal(state.schemaReady, true, 'UAT853_SCHEMA_NOT_PROVISIONED');
  // Only a separately-authorized foreground Tailscale Serve endpoint is
  // accepted. This command never configures Funnel, public ports, DNS, or VPN.
  const origin = originFromTailscaleStatus(JSON.parse(
    run('tailscale', ['status', '--json'])));
  assertPrivateServeOnly(JSON.parse(
    run('tailscale', ['serve', 'status', '--json'])), origin);
  const env = onlySafeProcessEnvironment(process.env, privateUatRuntime(app, origin));
  console.log('PASS: preconfigured tailnet-only HTTPS reverse proxy verified.');
  console.log('App on 127.0.0.1:3000; PostgreSQL on 127.0.0.1:5432.');
  console.log('Operator must independently verify tailnet ACL, testers and real phone access.');
  console.log('This does NOT mark any #852/#853 human acceptance as PASS.');
  const [npm, npmArgs] = npmProcess(['run', 'dev', '--', '--hostname', '127.0.0.1', '--port', '3000']);
  const child = spawnSync(npm, npmArgs, {
    cwd: ROOT, env, stdio: 'inherit', windowsHide: true,
  });
  process.exitCode = child.status ?? 1;
}
function stop(args) {
  assert.deepEqual(args, ['--discard-fictional-session'],
    'UAT853_STOP_REQUIRES_EXPLICIT_DISCARD_CONFIRMATION');
  const { state } = readSession(false);
  assertOwnContainer(state);
  run('docker', ['stop', state.container]); // --rm removes ephemeral DB.
  rmSync(PRIVATE, { recursive: true, force: true });
  console.log('Discarded this named fictional session. No shared database touched.');
}
function main() {
  const [cmd, ...args] = process.argv.slice(2);
  if (cmd === 'start' && args.length === 0) return start();
  if (cmd === 'migrate' && args.length === 0) return migrate();
  if (cmd === 'status' && args.length === 0) return status();
  if (cmd === 'serve' && args.length === 0) return serve();
  if (cmd === 'serve-private' && args.length === 0) return servePrivate();
  if (cmd === 'stop') return stop(args);
  throw new Error('Usage: node scripts/qa/uat853-local-lab.mjs start|migrate|status|serve|serve-private|stop --discard-fictional-session');
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { main(); }
  catch (e) { console.error(e?.message || 'UAT853_LOCAL_LAB_FAILED'); process.exitCode = 1; }
}
