import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
// Node does not render styles; keep the actual page and Next redirect implementation.
require.extensions['.css'] = () => {};
const { default: DemoPage } = require('../src/app/demo/page') as typeof import('../src/app/demo/page');
import { HOSTED_DEMO_ORIGIN } from '../src/lib/hosted-demo-navigation';

test('demo page executes redirect only when opted in and keeps identical flag-off element tree', () => {
 const flag = process.env.HOSTED_DEMO_NAVIGATION_ENABLED;
 const base = process.env.APP_BASE_URL;
 try {
  process.env.APP_BASE_URL = 'https://erwinmehehe-payrollph.vercel.app';
  delete process.env.HOSTED_DEMO_NAVIGATION_ENABLED;
  const original = DemoPage();
  process.env.HOSTED_DEMO_NAVIGATION_ENABLED = 'false';
  assert.deepEqual(DemoPage(), original);
  process.env.HOSTED_DEMO_NAVIGATION_ENABLED = 'true';
  assert.throws(() => DemoPage(), (error: unknown) => {
   assert.equal((error as {digest: string}).digest, `NEXT_REDIRECT;replace;${HOSTED_DEMO_ORIGIN}/demo;307;`);
   return true;
  });
  process.env.APP_BASE_URL = HOSTED_DEMO_ORIGIN;
  assert.deepEqual(DemoPage(), original);
 } finally {
  if (flag === undefined) delete process.env.HOSTED_DEMO_NAVIGATION_ENABLED; else process.env.HOSTED_DEMO_NAVIGATION_ENABLED = flag;
  if (base === undefined) delete process.env.APP_BASE_URL; else process.env.APP_BASE_URL = base;
 }
});
