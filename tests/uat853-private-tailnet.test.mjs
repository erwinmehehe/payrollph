import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertPrivateTailnetOrigin, originFromTailscaleStatus,
  assertPrivateServeOnly, privateUatRuntime,
} from '../scripts/qa/uat853-private-tailnet.mjs';

const origin = 'https://payrollph-qa.example-tailnet.ts.net';
const serve = {
  TCP: {'443': {HTTPS: true}},
  Web: {'payrollph-qa.example-tailnet.ts.net:443': {
    Handlers: {'/': {Proxy: 'http://127.0.0.1:3000'}},
  }},
};

test('only exact tailnet HTTPS host accepted; no IPs, ports, redirects, lookalikes', () => {
  assert.equal(assertPrivateTailnetOrigin(origin), origin);
  for (const bad of [undefined, null, '', 'http://payrollph-qa.example-tailnet.ts.net',
    origin + '/', origin + ':443', origin + '/setup', origin + '?a=1',
    origin + '#f', 'https://user@payrollph-qa.example-tailnet.ts.net',
    'https://payrollph-qa.example-tailnet.ts.net.attacker.com',
    'https://ts.net', 'https://127.0.0.1', 'https://payrollph.ts.net',
    origin + '\\n', 'HTTPS://payrollph-qa.example-tailnet.ts.net']) {
    assert.throws(() => assertPrivateTailnetOrigin(bad), /UAT853_/);
  }
});

test('Tailscale must be running with a real enrolled device DNS name', () => {
  const status = {BackendState:'Running', Self:{DNSName:'payrollph-qa.example-tailnet.ts.net.'}};
  assert.equal(originFromTailscaleStatus(status), origin);
  for (const bad of [{...status, BackendState:'Stopped'},
    {BackendState:'Running', Self:{DNSName:'example.com.'}},
    {BackendState:'Running', Self:{DNSName:'payrollph-qa.example-tailnet.ts.net'}},
    {BackendState:'Running'}, null]) {
    assert.throws(() => originFromTailscaleStatus(bad), /UAT853_/);
  }
});

test('HTTPS 443 must be a tailnet-only reverse proxy to exact localhost app', () => {
  assert.equal(assertPrivateServeOnly(serve, origin), origin);
  assert.equal(assertPrivateServeOnly({Foreground:{session:serve}}, origin), origin);
  for (const bad of [
    {},
    {...serve, AllowFunnel:{'payrollph-qa.example-tailnet.ts.net:443': true}},
    {...serve, Foreground:{bad:{AllowFunnel:{'other.ts.net:443':true}}}},
    {...serve, TCP:{'443': {HTTP:true}}},
    {...serve, Web:{}},
    {...serve, Web:{'payrollph-qa.example-tailnet.ts.net:443': {Handlers:{'/':{Proxy:'http://0.0.0.0:3000'}}}}},
    {...serve, Web:{'payrollph-qa.example-tailnet.ts.net:443': {Handlers:{'/':{Proxy:'http://127.0.0.1:3000'}, '/other':{Proxy:'http://127.0.0.1:9000'}}}}},
  ]) assert.throws(() => assertPrivateServeOnly(bad, origin), /UAT853_/);
});

test('tailnet origin overrides only URL keys; preserves isolated fictional DB', () => {
  const app = {
    DATABASE_URL: 'postgresql://uat853_owner:some-password@127.0.0.1:5432/uat853',
    APP_BASE_URL:'http://127.0.0.1:3000',
    TRUSTED_APP_ORIGINS:'http://127.0.0.1:3000',
    QA_URL:'http://127.0.0.1:3000',
    XENDIT_PAYOUTS_ENABLED:'false',
    BANK_DATA_ENCRYPTION_KEY:'dummy',
  };
  const result = privateUatRuntime(app, origin);
  assert.equal(result.DATABASE_URL, app.DATABASE_URL);
  assert.equal(result.XENDIT_PAYOUTS_ENABLED, 'false');
  assert.equal(result.BANK_DATA_ENCRYPTION_KEY, 'dummy');
  for(const k of ['APP_BASE_URL','TRUSTED_APP_ORIGINS','QA_URL']) assert.equal(result[k],origin);
  assert.equal(app.APP_BASE_URL, 'http://127.0.0.1:3000');
  assert.throws(() => privateUatRuntime({...app,DATABASE_URL:'postgresql://prod@neon.tech/prod'},origin), /UAT853_/);
  assert.throws(() => privateUatRuntime({...app,APP_BASE_URL:'https://prod.example'},origin), /UAT853_/);
});
