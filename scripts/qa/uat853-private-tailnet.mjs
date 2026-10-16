/**
 * Safe, opt-in private HTTPS routing for fictional-only #853 UAT.
 * No network or Tailscale state is modified in this module. The operator must
 * configure foreground Tailscale Serve on their own authorized QA machine.
 */
import assert from 'node:assert/strict';

const LOOPBACK_PROXY = 'http://127.0.0.1:3000';
const TAILNET_HOST = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.){2,}ts\\.net$/;

export function assertPrivateTailnetOrigin(candidate) {
  assert.equal(typeof candidate, 'string', 'UAT853_PRIVATE_ORIGIN_MISSING');
  let url;
  try { url = new URL(candidate); }
  catch { throw new Error('UAT853_PRIVATE_ORIGIN_INVALID'); }
  assert.ok(url.protocol === 'https:' && url.port === '' &&
    url.username === '' && url.password === '' &&
    url.origin === candidate && TAILNET_HOST.test(url.hostname),
    'UAT853_PRIVATE_ORIGIN_MUST_BE_EXACT_TAILNET_HTTPS');
  return url.origin;
}

export function originFromTailscaleStatus(status) {
  assert.equal(status?.BackendState, 'Running', 'UAT853_TAILSCALE_NOT_RUNNING');
  const dnsName = status?.Self?.DNSName;
  assert.ok(typeof dnsName === 'string' && dnsName.endsWith('.'),
    'UAT853_TAILSCALE_DNS_MISSING');
  const origin = 'https://' + dnsName.slice(0, -1);
  return assertPrivateTailnetOrigin(origin);
}

function entriesIncludingForeground(status) {
  const foreground = status?.Foreground;
  return [status, ...(foreground && typeof foreground === 'object'
    ? Object.values(foreground) : [])].filter(x => x && typeof x === 'object');
}

export function assertPrivateServeOnly(serveStatus, origin) {
  const expectedOrigin = assertPrivateTailnetOrigin(origin);
  const hostPort = new URL(expectedOrigin).hostname + ':443';
  const configs = entriesIncludingForeground(serveStatus);
  assert.ok(configs.length > 0, 'UAT853_SERVE_STATUS_MISSING');
  for (const config of configs) {
    // A machine already using Funnel is not an acceptable UAT host, even when
    // a different mount is private. Do not reset another service to fix this.
    assert.ok(!Object.values(config.AllowFunnel || {}).some(Boolean),
      'UAT853_PUBLIC_FUNNEL_REFUSED');
  }
  const valid = configs.some(config => {
    const web = config.Web?.[hostPort];
    const handlers = web?.Handlers;
    return config.TCP?.['443']?.HTTPS === true &&
      handlers && Object.keys(handlers).length === 1 &&
      handlers['/']?.Proxy === LOOPBACK_PROXY;
  });
  assert.ok(valid, 'UAT853_PRIVATE_HTTPS_PROXY_NOT_VERIFIED');
  return expectedOrigin;
}

export function privateUatRuntime(app, origin) {
  const safeOrigin = assertPrivateTailnetOrigin(origin);
  assert.equal(app?.APP_BASE_URL, LOOPBACK_PROXY,
    'UAT853_PRIVATE_RUNTIME_MUST_START_LOCAL');
  assert.equal(app?.DATABASE_URL && new URL(app.DATABASE_URL).hostname,
    '127.0.0.1', 'UAT853_PRIVATE_RUNTIME_MUST_USE_LOCAL_DB');
  return { ...app,
    APP_BASE_URL: safeOrigin,
    TRUSTED_APP_ORIGINS: safeOrigin,
    QA_URL: safeOrigin,
  };
}
