import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {collectRenewalInputs} from '../scripts/qa/payroll-run-renewal-inputs.mjs';
import {isReviewedFiveScopedPageProbeInput} from '../scripts/qa/payroll-run-five-scoped-page-source-compat.mjs';
import {assertMkt01Receipt} from '../scripts/qa/tenant-mkt01-marketing-credit.mjs';
import {verifyOidcBatchCredits} from '../scripts/qa/tenant-oidc-batch-credit-verify.mjs';
import {isReviewedHeldSsoSecondPassInput} from '../scripts/qa/payroll-run-sso-source-reproof.mjs';
import {readHistoricalPayrollRenewal,HISTORICAL_RENEWAL_RECEIPT} from '../scripts/qa/payroll-run-credit-renewal-history.mjs';
import {verifyFreshPayrollRenewal} from '../scripts/qa/payroll-run-credit-renewal-fresh-contract.mjs';
import {load} from 'js-yaml';
import {assertHistoricalHttpWorkflowCheckout} from '../scripts/qa/payroll-run-credit-renewal-workflow-compat.mjs';
import {verifyPayrollRenewalResults,PAYROLL_RENEWAL_METHODS} from '../scripts/qa/payroll-run-credit-renewal-contract.mjs';
import {readVerifiedPayrollRenewal,PAYROLL_RENEWAL_RECEIPT,payrollRenewalProof} from '../scripts/qa/payroll-run-credit-renewal-verify.mjs';
import {reconcilePayrollRenewal} from '../scripts/qa/payroll-run-credit-renewal.mjs';
import {verifyAllWageRegistrySourceHolds} from '../scripts/qa/wage-registry-source-hold.mjs';
const receipt=()=>JSON.parse(readFileSync(PAYROLL_RENEWAL_RECEIPT,'utf8'));

test('fresh execution cannot rewrite either original job archive or its accounting projection',()=>{
  const history=readHistoricalPayrollRenewal();
  assert.equal(Object.keys(history.receipt.cohorts).length,9);
  assert.equal(history.receipt.cohorts.creation.jobId,131691175894);
  assert.throws(()=>verifyFreshPayrollRenewal(history.receipt,history.receipt,history.receipt.methods),
    'An unchanged archived result cannot masquerade as a fresh execution');
  for(const target of [HISTORICAL_RENEWAL_RECEIPT,history.receipt.historicalFullInputReceipt.file]){
    assert.throws(()=>readHistoricalPayrollRenewal((file,...args)=>file===target?
      readFileSync(file,...args).replace('131691175894','131691175895'):readFileSync(file,...args)),
      /Historical executed receipt changed/);
  }
});

test('fresh HTTP reproof checks out the exact proposed head with no persisted credentials',()=>{
  const workflow=load(readFileSync('.github/workflows/security-http-smoke.yml','utf8'));
  const steps=workflow.jobs['security-http-acceptance'].steps;
  assert.match(steps[0].uses,/^actions\/checkout@[a-f0-9]{40}$/);
  assert.deepEqual(steps[0].with,{'persist-credentials':false,ref:'${{ github.event.pull_request.head.sha || github.sha }}'});
  assert.equal(steps[1].env.EXPECTED_SOURCE_SHA,'${{ github.event.pull_request.head.sha || github.sha }}');
  assert.equal(steps[1].run,'test "$(git rev-parse HEAD)" = "$EXPECTED_SOURCE_SHA"');
});
test('historical unaccepted page evidence permits only the source-sealed checkout change',()=>{
  const file='.github/workflows/security-http-smoke.yml',expected='cca392e383c9f24b3ab6d3ec0e5b0de5a6be2736';
  assert.equal(assertHistoricalHttpWorkflowCheckout(file,expected),true);
  assert.throws(()=>assertHistoricalHttpWorkflowCheckout(file,'0'.repeat(40)));
  assert.throws(()=>assertHistoricalHttpWorkflowCheckout(file,expected,(p,...args)=>readFileSync(p,...args)+'\n# unreviewed change'));
});

test('historical nine-cohort receipt cannot renew the changed wage-order source',()=>{
  assert.deepEqual([...verifyPayrollRenewalResults(receipt())],PAYROLL_RENEWAL_METHODS);
  assert.equal(verifyAllWageRegistrySourceHolds(JSON.parse(readFileSync('scripts/qa/tenant-isolation-coverage-manifest.json','utf8'))).length,23);
  assert.throws(()=>readVerifiedPayrollRenewal(),/Executed input closure drift:/);
  assert.throws(()=>readVerifiedPayrollRenewal(readFileSync,undefined,['POST payroll-runs']),/Executed input closure drift:/);
});

test('nine archival cohorts remain immutable and fail current-source closure after NWPC update',()=>{
  const historical = receipt();
  assert.deepEqual([...verifyPayrollRenewalResults(historical)], PAYROLL_RENEWAL_METHODS);
  const manifest = JSON.parse(readFileSync('scripts/qa/tenant-isolation-coverage-manifest.json','utf8'));
  assert.equal(verifyAllWageRegistrySourceHolds(manifest).length,23);
  for(const [name,cohort] of Object.entries(historical.cohorts)){
    assert.equal(cohort.sourcePins['src/lib/wage-orders.ts'],
      '2ea37036211a846ff515540d6b982760df8db1eb',
      name+': immutable historical wage source must not be silently rewritten');
    assert.equal(cohort.sourcePins['src/lib/statutory-rule-watch.ts'],
      '0393d836eeee5874a85df4ba571bc4456f47a4ef',
      name+': immutable historical watch source must not be silently rewritten');
    const current = collectRenewalInputs(cohort.roots,undefined,undefined,true);
    assert.notEqual(current['src/lib/wage-orders.ts'],cohort.sourcePins['src/lib/wage-orders.ts'],
      name+': revised registry invalidates archived real-HTTP execution as current proof');
    assert.notEqual(current['src/lib/statutory-rule-watch.ts'],cohort.sourcePins['src/lib/statutory-rule-watch.ts'],
      name+': revised rule-watch invalidates archived real-HTTP execution as current proof');
  }
  assert.throws(()=>readVerifiedPayrollRenewal(), /Executed input closure drift:/,
    'No historical payroll credit can claim to have executed the new wage source');
});

test('fast source guards reject stale wage sources without loading TypeScript',()=>{
  const script=`import {registerHooks} from 'node:module';
    registerHooks({resolve(specifier,context,next){
      if(specifier==='typescript')throw new Error('Compiler unavailable in fast source-only CI');
      return next(specifier,context);
    }});
    const {readVerifiedPayrollRenewal}=await import('./scripts/qa/payroll-run-credit-renewal-verify.mjs');
    try { readVerifiedPayrollRenewal(); throw new Error('Stale credit incorrectly accepted'); }
    catch (error) {
      if (!String(error.message).includes('Executed input closure drift:')) throw error;
      console.log('stale wage source correctly held without compiler');
    }`;
  assert.match(execFileSync(process.execPath,['--input-type=module','-e',script],{encoding:'utf8'}),
    /stale wage source correctly held without compiler/);
});

test('fresh jobs cannot drop proof roots, borrow historical executions or omit the synthetic-provider preload',()=>{
  const history=readHistoricalPayrollRenewal().receipt;
  for(const mutate of [
    r=>{r.cohorts.creation.historicalExecution.jobId++;},
    r=>{r.cohorts.creation.jobId=r.cohorts.creation.historicalExecution.jobId;},
    r=>{r.cohorts.boundary.roots.pop();},
    r=>{r.cohorts.paymongo.roots=r.cohorts.paymongo.roots.filter(p=>!p.endsWith('paymongo-http-proof-preload.mjs'));},
    r=>{delete r.cohorts.secondPass.sourcePins['scripts/qa/tenant-second-pass-http.mjs'];},
    r=>{r.cohorts.paymongo.result.scope='unverified provider traffic';},
  ]){const r=receipt();mutate(r);assert.throws(()=>verifyFreshPayrollRenewal(r,history,r.methods));}
});
test('failed, borrowed, wrong-source, missing or production-accepted cohorts earn no renewal',()=>{
  for(const mutate of [
    r=>{delete r.cohorts.boundary;},r=>{delete r.cohorts.moneyOn;},
    r=>{r.cohorts.creation.conclusion='queued';},
    r=>{r.cohorts.moneyOn.jobId=r.cohorts.moneyOff.jobId;},
    r=>{r.cohorts.creation.sourceHead='0'.repeat(40);},
    r=>{r.productionCertified=true;},r=>{r.liveActivation=true;},
    r=>{r.methods.push('POST payroll-runs/[id]/xendit-payout');},
    r=>{r.methods[1]=r.methods[0];},
  ]){const r=receipt();mutate(r);assert.throws(()=>verifyPayrollRenewalResults(r));}
});
test('empty own success, foreign acceptance, altered victim SQL and fake provider isolation fail closed',()=>{
  for(const mutate of [
    r=>{r.cohorts.creation.result.own201=[0,0];},
    r=>{r.cohorts.secondPass.result.highRisk.validOwnPositives=[0,0];},
    r=>{r.cohorts.moneyOff.result.successes=[];},
    r=>{r.cohorts.moneyOn.result.receipts.find(x=>x.label==='foreign run process').status=200;},
    r=>{r.cohorts.exportsPost.result.fullSnapshotsUnchanged=false;},
    r=>{r.cohorts.readTable.result.discriminatingProofs=0;},
    r=>{r.cohorts.actions.result.forgedSelectorsIgnored=false;},
    r=>{r.cohorts.paymongo.result.realProviderContacted=true;},
    r=>{r.cohorts.paymongo.result.providerCalls[0].url='https://unreviewed.invalid/provider';},
    r=>{r.cohorts.paymongo.result.successes.find(x=>x.freshRetry).syntheticPosts=2;},
  ]){const r=receipt();mutate(r);assert.throws(()=>verifyPayrollRenewalResults(r));}
});
test('receipt seal rejects invented results and exact executed source drift',()=>{
  assert.throws(()=>readVerifiedPayrollRenewal((file,...args)=>file===PAYROLL_RENEWAL_RECEIPT?
    readFileSync(file,...args)+'\n':readFileSync(file,...args)),/receipts changed/);
  for(const [file,method]of [['src/lib/payroll-run-membership.ts','POST payroll-runs'],['src/lib/auth.ts','POST payroll-runs'],
    ['scripts/qa/tenant-money-lifecycle-http.mjs','POST payroll-runs/[id]/process'],['.github/workflows/payroll-run-credit-renewal.yml','POST payroll-runs']]){
    assert.throws(()=>readVerifiedPayrollRenewal((p,...args)=>p===file?
      Buffer.concat([Buffer.from(readFileSync(p)),Buffer.from('\n// unexecuted edit')]):readFileSync(p,...args),undefined,[method]),
      /closure drift/);
  }
});
test('archived payroll-run citations cannot authorize current-source coverage',()=>{
  assert.equal(receipt().cohorts.creation.jobId,131745203827);
  assert.equal(receipt().independentlyAccepted,false);
  assert.equal(receipt().productionCertified,false);
  assert.throws(()=>payrollRenewalProof('POST payroll-runs'),/Executed input closure drift:/);
  assert.ok(!PAYROLL_RENEWAL_METHODS.includes('POST payroll-runs/[id]/xendit-payout'));
});

test('payroll documents reconcile without duplicating or moving the separate SSO hold banner',()=>{
  const result=reconcilePayrollRenewal({write:false});
  assert.equal(result.credited,0);
  assert.equal(result.held,19);
  assert.equal(result.status,'WAGE_REGISTRY_DEPENDENCY_SOURCE_HOLD');
  for(const file of ['docs/engineering/tenant-isolation-coverage-inventory.md','docs/engineering/tenant-isolation-closure-plan.md']){
    const text=readFileSync(file,'utf8');
    assert.match(text,/^> \*\*CURRENT \/ PR #1989 WAGE-ORDER DEPENDENCY PROOF HOLD/);
    assert.match(text.split('\n\n')[1],/^> \*\*SSO DEFAULT-OFF INTEGRATION HOLD/);
    // The independently source-verified MKT-01 and OIDC receipts change only the live totals, not historical Studio proofs.
    const studioBanners=text.split('\n').filter(line=>line.startsWith('> **SOLO_VERIFIED_DEV_RECOVERY — complete Studio POST proposal:** '));
    // The inventory records two older Studio checkpoints, while the plan
    // retains one. Neither may be manufactured or erased during reconciliation.
    const expectedBanners=file.endsWith('coverage-inventory.md')?3:2;
    assert.equal(studioBanners.length,expectedBanners,
      'Keep exactly the historical Studio accounting snapshots in each document');
    const live=JSON.parse(readFileSync('scripts/qa/tenant-isolation-coverage-manifest.json')).metrics;
    assert.equal(live.coveredAfter,438);
    assert.equal(live.gap,24);
    // Dated Studio banners are history; do not rewrite them as newer credits.
    assert.ok(studioBanners[0].includes('461 COVERED + 24 PUBLIC-BY-DESIGN + 12 PRIVILEGED-OPERATIONS-TOKEN-ONLY + 1 GAP'));
    // The historical Studio snapshots are retained byte-for-byte; OIDC
    // recovery updates only the first live summary, not the older 460/3
    // checkpoints or their original 16/17 page-gap accounting.
    for(const historic of studioBanners.slice(1))
      assert.match(historic,/460 COVERED \+ 23 PUBLIC-BY-DESIGN \+ 12 PRIVILEGED-OPERATIONS-TOKEN-ONLY \+ 3 GAP/);
    if(file.endsWith('coverage-inventory.md'))
      assert.match(studioBanners[1],/16 separate page\/action gaps remain/);
    assert.match(studioBanners.at(-1),/17 separate page\/action gaps remain/,
      'Retain the older 17-page-gap Studio evidence without rewriting it');

  }
});
