#!/usr/bin/env node
/**
 * Fictional-only QA phone gateway. Tailscale Serve, NOT Funnel, provides private HTTPS.
 * This module never creates a public endpoint, modifies production, or certifies UAT.
 */
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createServer, request as httpRequest } from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  assertSafeHostEnvironment, assertLoopbackUrl,
} from './uat853-local-lab.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const LOCAL_LAB = resolve(ROOT, 'qa-artifacts/uat853-local-lab');
const PRIVATE = resolve(ROOT, 'qa-artifacts/uat853-tailnet-phone');
const PRIVATE_CREDS = resolve(PRIVATE, 'credentials.json');
const GATEWAY_PORT = 3001;
const APP_PORT = 3000;
const SAFETY_FLAGS = [
  'PAYMONGO_DISBURSEMENTS_ENABLED', 'XENDIT_PAYOUTS_ENABLED',
  'XENDIT_PAYOUTS_LIVE_APPROVED', 'FINAL_PAY_MANUAL_RELEASE_ENABLED',
  'WFM_GEOFENCE_PILOT_ENABLED', 'WFM_PUNCH_EVIDENCE_ENABLED',
  'CENTRAL_SCHEDULER_ENABLED', 'WORKER_ENABLED',
];
const MUTATIONS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function run(file, args, timeout = 25000) {
  const result = spawnSync(file, args, {
    cwd: ROOT, encoding: 'utf8', windowsHide: true,
    timeout, maxBuffer: 256 * 1024,
  });
  // Never print command output: it can include device names, access tokens, etc.
  if (result.error || result.status !== 0) {
    throw new Error('UAT853_PHONE_COMMAND_FAILED_' + file.replace(/[^a-z0-9]/gi, ''));
  }
  return result.stdout.trim();
}

function sourceSha() {
  const sha = execFileSync('git', ['-C', ROOT, 'rev-parse', 'HEAD'], {
    encoding: 'utf8', windowsHide: true,
  }).trim();
  assert.match(sha, /^[a-f0-9]{40}$/, 'UAT853_PHONE_INVALID_SOURCE_SHA');
  return sha;
}

function parsedEnv(contents) {
  const lines = contents.trimEnd().split('\n').map(line => {
    const sep = line.indexOf('=');
    assert.ok(sep > 0, 'UAT853_PHONE_MALFORMED_ENV');
    return [line.slice(0, sep), line.slice(sep + 1)];
  });
  assert.equal(new Set(lines.map(x => x[0])).size, lines.length,
    'UAT853_PHONE_DUPLICATE_ENV_KEY');
  return Object.fromEntries(lines);
}

export function assertFictionalPhoneLab(state, app, sha) {
  assert.equal(state.kind, 'fictional-local-disposable-pg16');
  assert.equal(state.sha, sha, 'UAT853_PHONE_SOURCE_SHA_CHANGED');
  assert.equal(state.schemaReady, true, 'UAT853_PHONE_SCHEMA_NOT_READY');
  assert.equal(state.container, 'payrollph-uat853-' + sha.slice(0, 12),
    'UAT853_PHONE_CONTAINER_MISMATCH');
  assertLoopbackUrl(app.DATABASE_URL);
  assert.equal(app.APP_BASE_URL, 'http://127.0.0.1:3000');
  assert.equal(app.TRUSTED_APP_ORIGINS, 'http://127.0.0.1:3000');
  assert.equal(app.DEMO_MODE, 'false');
  for (const flag of SAFETY_FLAGS) assert.equal(app[flag], 'false',
    'UAT853_PHONE_UNSAFE_FLAG_' + flag);
  for (const key of ['PAYMONGO_SECRET_KEY', 'XENDIT_SECRET_KEY',
    'OPENAI_API_KEY', 'SMTP_PASSWORD']) {
    assert.equal(app[key], '', 'UAT853_PHONE_VENDOR_CREDENTIAL_' + key);
  }
}

export function tailnetHostname(status) {
  assert.equal(status?.BackendState, 'Running', 'UAT853_PHONE_TAILSCALE_NOT_RUNNING');
  assert.ok(status.Self && status.Self.Online !== false,
    'UAT853_PHONE_TAILSCALE_DEVICE_OFFLINE');
  const name = String(status.Self.DNSName ?? '').replace(/\.$/, '').toLowerCase();
  assert.match(name, /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9-]+\.ts\.net$/,
    'UAT853_PHONE_INVALID_TAILNET_NAME');
  assert.ok(!name.includes('..') && name.length <= 253,
    'UAT853_PHONE_INVALID_TAILNET_NAME');
  return name;
}

export function assertNoPublicFunnel(funnelStatus) {
  const value = typeof funnelStatus === 'string' ? JSON.parse(funnelStatus) : funnelStatus;
  if (value == null) return;
  assert.ok(typeof value === 'object' && !Array.isArray(value),
    'UAT853_PHONE_FUNNEL_STATUS_UNRECOGNIZED');
  // Serve and Funnel share a configuration. Without AllowFunnel, the listeners
  // are tailnet-only; an explicit AllowFunnel true enables public access.
  if (value.AllowFunnel == null) return;
  const allowed = value.AllowFunnel;
  assert.ok(allowed && typeof allowed === 'object' && !Array.isArray(allowed),
    'UAT853_PHONE_FUNNEL_UNVERIFIED');
  assert.ok(!Object.values(allowed).some(Boolean), 'UAT853_PHONE_FUNNEL_PUBLIC');
}

export function verifyGatewayCredentials(credentials, sha, host) {
  assert.equal(credentials?.kind, 'qa-tailnet-only-gateway');
  assert.equal(credentials.sha, sha, 'UAT853_PHONE_GATEWAY_SOURCE_MISMATCH');
  assert.equal(credentials.hostname, host, 'UAT853_PHONE_TAILNET_HOST_CHANGED');
  assert.match(credentials.username, /^[a-f0-9]{48}$/);
  assert.match(credentials.password, /^[a-f0-9]{64}$/);
}

export function isAuthorizedBasic(authorization, username, password) {
  if (typeof authorization !== 'string' || !authorization.startsWith('Basic ') ||
      authorization.length > 280) return false;
  try {
    // Both credentials are cryptographically random, fixed-size hex strings.
    // Compare the full Basic value in constant time; hashing a password with
    // a fast, unsalted digest would trigger password-storage security warnings.
    const supplied = Buffer.from(authorization.slice(6), 'base64');
    const expected = Buffer.from(username + ':' + password, 'ascii');
    if (supplied.length !== expected.length) return false;
    return timingSafeEqual(supplied, expected);
  } catch { return false; }
}

export function isApprovedMutationOrigin(headers, hostname) {
  const origin = headers.origin;
  if (typeof origin !== 'string') return false;
  const allowed = new Set(['https://' + hostname, 'http://127.0.0.1:' + GATEWAY_PORT]);
  if (!allowed.has(origin)) return false;
  const site = String(headers['sec-fetch-site'] ?? '').toLowerCase();
  return site !== 'cross-site';
}

export function hardenCookies(value) {
  if (!value) return value;
  const cookies = Array.isArray(value) ? value : [value];
  return cookies.map(cookie => /;\s*secure\b/i.test(cookie) ? cookie : cookie + '; Secure');
}

const SECURITY = {
  'cache-control': 'no-store, max-age=0',
  pragma: 'no-cache',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
  'x-robots-tag': 'noindex, nofollow, noarchive',
  'cross-origin-opener-policy': 'same-origin',
  'permissions-policy': 'payment=(), usb=()',
  'content-security-policy': "frame-ancestors 'none'; base-uri 'self'",
  'strict-transport-security': 'max-age=86400',
};

export function createPhoneGateway({ hostname, username, password, upstreamPort = APP_PORT }) {
  assert.match(hostname, /\.ts\.net$/);
  assert.match(username, /^[a-f0-9]{48}$/);
  assert.match(password, /^[a-f0-9]{64}$/);
  assert.ok(Number.isInteger(upstreamPort) && upstreamPort >= 1024 &&
    upstreamPort <= 65535, 'UAT853_PHONE_INVALID_UPSTREAM_PORT');
  const failures = [];
  const writeError = (res, code, reason, extra = {}) => {
    res.writeHead(code, { ...SECURITY, 'content-type': 'text/plain; charset=utf-8', ...extra });
    res.end(reason);
  };
  const server = createServer((req, res) => {
    const method = (req.method ?? '').toUpperCase();
    if (!['GET', 'HEAD', 'OPTIONS', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
      writeError(res, 405, 'Method not allowed'); return;
    }
    const host = String(req.headers.host ?? '').toLowerCase().split(':')[0];
    if (![hostname, '127.0.0.1', 'localhost'].includes(host)) {
      writeError(res, 421, 'Unknown QA host'); return;
    }
    if (typeof req.url !== 'string' || !req.url.startsWith('/') || req.url.startsWith('//')) {
      writeError(res, 400, 'Invalid path'); return;
    }
    let decodedPath;
    try { decodedPath = decodeURIComponent(req.url.split('?')[0]).toLowerCase(); }
    catch { writeError(res, 400, 'Invalid encoded path'); return; }
    if (/^\/(?:qa-artifacts|node_modules|\.git|\.env)(?:\/|$)/.test(decodedPath)) {
      writeError(res, 404, 'Not found'); return;
    }
    if (!isAuthorizedBasic(req.headers.authorization, username, password)) {
      const now = Date.now();
      while (failures.length && failures[0] < now - 60000) failures.shift();
      if (failures.length >= 20) {
        writeError(res, 429, 'Gateway temporarily limited', { 'retry-after': '60' });
      } else {
        failures.push(now);
        writeError(res, 401, 'Private fictional QA - authorized testers only', {
          'www-authenticate': 'Basic realm="PayrollPH Fictional QA", charset="UTF-8"',
        });
      }
      return;
    }
    if (MUTATIONS.has(method) && !isApprovedMutationOrigin(req.headers, hostname)) {
      writeError(res, 403, 'Cross-origin modification blocked'); return;
    }
    const headers = { ...req.headers };
    for (const key of Object.keys(headers)) {
      if (key.startsWith('x-forwarded-')) delete headers[key];
    }
    for (const key of ['authorization', 'proxy-authorization', 'transfer-encoding',
      'connection', 'upgrade']) delete headers[key];
    headers.host = '127.0.0.1:' + upstreamPort;
    headers['x-forwarded-host'] = hostname;
    headers['x-forwarded-proto'] = 'https';
    headers['x-forwarded-port'] = '443';
    const upstream = httpRequest({
      hostname: '127.0.0.1', port: upstreamPort, method, path: req.url,
      headers, timeout: 60000,
    }, incoming => {
      const result = { ...incoming.headers, ...SECURITY };
      delete result.server;
      if (result['set-cookie']) result['set-cookie'] = hardenCookies(result['set-cookie']);
      res.writeHead(incoming.statusCode ?? 502, result);
      incoming.pipe(res);
    });
    upstream.on('timeout', () => upstream.destroy());
    upstream.on('error', () => {
      if (!res.headersSent) writeError(res, 502, 'Local QA app unavailable');
      else res.end();
    });
    req.on('aborted', () => upstream.destroy());
    req.pipe(upstream);
  });
  server.on('upgrade', (req, socket) => {
    socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
  });
  return server;
}

function runtimePreflight() {
  assertSafeHostEnvironment(process.env);
  for (const file of ['.env', '.env.local', '.env.development', '.env.development.local']) {
    assert.ok(!existsSync(resolve(ROOT, file)), 'UAT853_PHONE_ENV_FILES_MUST_BE_ABSENT');
  }
  assert.equal(run('git', ['status', '--porcelain']), '', 'UAT853_PHONE_DIRTY_SOURCE');
  const sha = sourceSha();
  assert.ok(existsSync(resolve(LOCAL_LAB, 'state.json')) &&
    existsSync(resolve(LOCAL_LAB, 'app.env')), 'UAT853_PHONE_LAB_NOT_READY');
  const state = JSON.parse(readFileSync(resolve(LOCAL_LAB, 'state.json'), 'utf8'));
  const app = parsedEnv(readFileSync(resolve(LOCAL_LAB, 'app.env'), 'utf8'));
  assertFictionalPhoneLab(state, app, sha);
  run(process.execPath, [resolve(ROOT, 'scripts/qa/uat853-local-lab.mjs'), 'status']);
  const status = JSON.parse(run('tailscale', ['status', '--json']));
  const hostname = tailnetHostname(status);
  assertNoPublicFunnel(run('tailscale', ['funnel', 'status', '--json']));
  return { sha, hostname };
}

function readCredentials(sha, hostname) {
  assert.ok(existsSync(PRIVATE_CREDS), 'UAT853_PHONE_INIT_REQUIRED');
  const parsed = JSON.parse(readFileSync(PRIVATE_CREDS, 'utf8'));
  verifyGatewayCredentials(parsed, sha, hostname);
  return parsed;
}

function main() {
  const command = process.argv[2];
  assert.ok(['init', 'gateway', 'preflight'].includes(command) &&
    process.argv.length === 3,
  'Usage: node scripts/qa/uat853-tailnet-phone.mjs init|preflight|gateway');
  const { sha, hostname } = runtimePreflight();
  if (command === 'preflight') {
    console.log('PASS: clean pinned fictional PG16 lab; tailnet connected; no active Funnel.');
    console.log('Real phone and independent human acceptance: NOT_RUN.');
    return;
  }
  if (command === 'init') {
    assert.ok(!existsSync(PRIVATE), 'UAT853_PHONE_SESSION_ALREADY_INITIALIZED');
    mkdirSync(PRIVATE, { recursive: true, mode: 0o700 });
    const value = {
      kind: 'qa-tailnet-only-gateway', sha, hostname,
      username: randomBytes(24).toString('hex'),
      password: randomBytes(32).toString('hex'),
      initializedAt: new Date().toISOString(),
    };
    writeFileSync(PRIVATE_CREDS, JSON.stringify(value, null, 2) + '\n', {
      flag: 'wx', mode: 0o600,
    });
    console.log('PASS: distinct gateway credentials created in ignored private directory.');
    console.log('Do not paste them into GitHub, CI, chat, or screenshots.');
    console.log('Human physical-phone acceptance remains NOT_RUN.');
    return;
  }
  const credentials = readCredentials(sha, hostname);
  if (process.platform !== 'win32') {
    assert.equal(statSync(PRIVATE_CREDS).mode & 0o077, 0,
      'UAT853_PHONE_PRIVATE_FILE_PERMISSIONS_INVALID');
  }
  // Never use a hostname sourced from the credentials file for proxy headers.
  // The trusted hostname comes from the running local Tailscale daemon;
  // the private credential file is used only to authenticate the gateway.
  const server = createPhoneGateway({
    hostname, username: credentials.username, password: credentials.password,
  });
  server.on('error', () => { console.error('UAT853_PHONE_LOCAL_PORT_UNAVAILABLE'); process.exitCode = 1; });
  server.listen(GATEWAY_PORT, '127.0.0.1', () => {
    console.log('PASS: Basic-auth QA gateway listening ONLY on 127.0.0.1:3001.');
    console.log('Tailscale Serve must be configured by an authorized tailnet admin.');
    console.log('NEVER use tailscale funnel. Real phone acceptance: NOT_RUN.');
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { main(); }
  catch (e) { console.error(e?.message ?? 'UAT853_PHONE_BLOCKED'); process.exitCode = 1; }
}
