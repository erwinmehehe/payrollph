import {verifyXenditPostCredit} from '../scripts/qa/tenant-xendit-post-credit.mjs';
import {verifyStudioPostCredit,STUDIO_POST_PATH} from '../scripts/qa/tenant-studio-post-credit.mjs';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { CHECKOUT_INPUT_BLOBS } from '../scripts/qa/tenant-billing-checkout-credit-pins.mjs';
import { CHECKOUT_PATH, CHECKOUT_RECEIPT, checkoutEvidence, verifyCheckoutCredit } from '../scripts/qa/tenant-billing-checkout-credit.mjs';
import { verifyOracleSourceHolds,isVerifiedOracleRenewal } from '../scripts/qa/payroll-run-oracle-hold.mjs';
const manifest = () => JSON.parse(readFileSync('scripts/qa/tenant-isolation-coverage-manifest.json'));

test('only the merged real-PG16 two-employer checkout receipt earns one method', () => {
  assert.equal(verifyCheckoutCredit(manifest()), 1);
  const r = checkoutEvidence();
  assert.equal(r.result.ownCheckout201, 2);
  assert.equal(r.result.foreign403, 2);
  assert.equal(r.result.coverageCredits, 0);
  assert.equal(r.sourceComparisonBase, '01a157ae4e423b409080f9899cb799a3b2dd5cb6');
});

test('every sealed runtime, fixture, workflow and receipt byte refuses drift', () => {
  for (const file of [...Object.keys(CHECKOUT_INPUT_BLOBS), CHECKOUT_RECEIPT, 'scripts/qa/tenant-billing-post-credit-receipt.json']) {
    assert.throws(() => checkoutEvidence(path => {
      const bytes = readFileSync(path);
      return path === file ? Buffer.concat([bytes, Buffer.from(' ')]) : bytes;
    }), /receipt|drift/, file);
  }
});

test('borrowed employer-proof anchors and fabricated receipts cannot promote a method', () => {
  for (const change of [
    m => { m.allApiRouteFiles[CHECKOUT_PATH].methods.find(x => x.name === 'POST').testedBy.foreignDenialLine = 1; },
    m => { m.allApiRouteFiles[CHECKOUT_PATH].methods.find(x => x.name === 'POST').testedBy.workflowJobId = 1; },
    m => { m.allApiRouteFiles[CHECKOUT_PATH].gitBlobSha = '0'.repeat(40); },
    m => { m.allApiRouteFiles[CHECKOUT_PATH].methods.find(x => x.name === 'POST').status = 'GAP'; },
  ]) { const m = manifest(); change(m); assert.throws(() => verifyCheckoutCredit(m)); }
});

test('partial exports and unrelated GAPs receive zero credits from this verifier', () => {
  const m = manifest();
  const oracleHolds = verifyOracleSourceHolds(m);
  for (const path of ['payroll-runs/[id]/exports', 'payroll-runs/[id]/xendit-payout', 'automation-studio']) {
    const route = 'src/app/api/' + path + '/route.ts';
    if(isVerifiedOracleRenewal(m,route,'POST'))continue;
    if (oracleHolds.has('POST ' + route)) {
      const held = m.allApiRouteFiles[route].methods.find(x => x.name === 'POST');
      assert.equal(held.status, 'GAP'); assert.equal(held.testedBy, null);
      continue;
    }
    if(path==='automation-studio'){assert.equal(verifyStudioPostCredit(m),1);continue;}
    if(path==='payroll-runs/[id]/xendit-payout'){assert.equal(verifyXenditPostCredit(m),1);continue;}
    if(path==='payroll-runs/[id]/exports'){const x=m.allApiRouteFiles['src/app/api/payroll-runs/[id]/exports/route.ts'].methods.find(y=>y.name==='POST');assert.equal(x.status,'COVERED');assert.equal(x.testedBy.file,'scripts/qa/tenant-payroll-exports-post-http.mjs');continue;}
    assert.equal(m.allApiRouteFiles['src/app/api/' + path + '/route.ts'].methods.find(x => x.name === 'POST').status, 'GAP');
  }
});
