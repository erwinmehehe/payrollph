import {readWageWithdrawalFixture} from './helpers/wage-renewal-fixture.mjs';
import {verifiedWageCreditHolds} from '../scripts/qa/wage-registry-credit-holds.mjs';
import {verifyWageRenewalEngineWithdrawal} from '../scripts/qa/wage-registry-renewal-supersession.mjs';
import {baseTenantManifest} from './helpers/tenant-counts.mjs';
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
  assert.equal(steps[2].name,'Fetch main ledger for strict source-withdrawal assertions');
  assert.ok(steps[2].run.includes('git fetch --no-tags --depth=1 origin +refs/heads/main:refs/remotes/origin/main'));
  assert.ok(steps[2].run.includes('git cat-file -e origin/main:scripts/qa/tenant-isolation-coverage-manifest.json'));
  assert.doesNotMatch(steps[2].run,/git (checkout|switch|reset)|node |npm /);
});
test('historical unaccepted page evidence permits only the source-sealed checkout change',()=>{
  const file='.github/workflows/security-http-smoke.yml',expected='cca392e383c9f24b3ab6d3ec0e5b0de5a6be2736';
  assert.equal(assertHistoricalHttpWorkflowCheckout(file,expected),true);
  assert.throws(()=>assertHistoricalHttpWorkflowCheckout(file,'0'.repeat(40)));
  assert.throws(()=>assertHistoricalHttpWorkflowCheckout(file,expected,(p,...args)=>readFileSync(p,...args)+'\n# unreviewed change'));
  for(const change of [
    source=>source.replace('refs/heads/main:refs/remotes/origin/main','refs/heads/unreviewed:refs/remotes/origin/main'),
    source=>source.replace('git cat-file -e','git checkout main\n          git cat-file -e'),
  ])assert.throws(()=>assertHistoricalHttpWorkflowCheckout(file,expected,(p,...args)=>change(readFileSync(p,...args))));
});

test('nine historical PG16 cohorts remain archived but cannot certify changed wage sources',()=>{
  assert.deepEqual([...verifyPayrollRenewalResults(receipt())],PAYROLL_RENEWAL_METHODS);
  const manifest=readWageWithdrawalFixture();
  assert.equal(verifyAllWageRegistrySourceHolds(manifest).length,23);
  assert.throws(()=>readVerifiedPayrollRenewal(),/Executed input closure drift:/);
  assert.throws(()=>readVerifiedPayrollRenewal(readFileSync,undefined,['POST payroll-runs']),
    /Executed input closure drift:/);
});

test('all nine changed wage cohorts remain archived and refuse current-source renewal',()=>{
  const manifest=readWageWithdrawalFixture();
  assert.equal(verifiedWageCreditHolds(manifest).size,75);
  const prior=receipt(),before=readFileSync('scripts/qa/tenant-isolation-coverage-manifest.json');
  assert.equal(Object.keys(prior.cohorts).length,9);
  for(const [name,cohort] of Object.entries(prior.cohorts)){
    const actual=collectRenewalInputs(cohort.roots,undefined,undefined,true);
    const changed=['src/lib/wage-orders.ts','src/lib/statutory-rule-watch.ts']
      .filter(path=>Object.hasOwn(cohort.sourcePins,path)&&actual[path]!==cohort.sourcePins[path]);
    assert.ok(changed.length>0,name+': the executed closure must demonstrably be stale');
  }
  assert.throws(()=>readVerifiedPayrollRenewal(),/Executed input closure drift:/);
  const result=reconcilePayrollRenewal({write:false});
  assert.equal(result.credited,0);assert.equal(result.held,result.status==='SUPERSEDED_BY_WAGE_SOURCE_RENEWAL'?0:19);
  assert.deepEqual(readFileSync('scripts/qa/tenant-isolation-coverage-manifest.json'),before);
});

test('fast source guards reject stale wage code without loading TypeScript',()=>{
  const script=`import {registerHooks} from 'node:module';
    registerHooks({resolve(specifier,context,next){
      if(specifier==='typescript')throw new Error('Compiler unavailable in fast source-only CI');
      return next(specifier,context);
    }});
    const {readVerifiedPayrollRenewal}=await import('./scripts/qa/payroll-run-credit-renewal-verify.mjs');
    try { readVerifiedPayrollRenewal(); throw new Error('Stale payroll proof incorrectly accepted'); }
    catch(error) {
      if(!String(error.message).includes('Executed input closure drift:'))throw error;
      console.log('stale wage source held without compiler');
    }`;
  assert.match(execFileSync(process.execPath,['--input-type=module','-e',script],{encoding:'utf8'}),
    /stale wage source held without compiler/);
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
test('historical job citations cannot award current-source payroll coverage',()=>{
  assert.equal(receipt().cohorts.creation.jobId,131745203827);
  assert.equal(receipt().productionCertified,false);
  assert.throws(()=>payrollRenewalProof('POST payroll-runs'),/Executed input closure drift:/);
  assert.ok(!PAYROLL_RENEWAL_METHODS.includes('POST payroll-runs/[id]/xendit-payout'));
});

test('payroll documents reconcile without duplicating or moving the separate SSO hold banner',()=>{
  const result=reconcilePayrollRenewal({write:false});
  assert.equal(result.credited,0);
  const renewed=result.status==='SUPERSEDED_BY_WAGE_SOURCE_RENEWAL';
  assert.equal(result.held,renewed?0:19);
  assert.equal(result.status,renewed?'SUPERSEDED_BY_WAGE_SOURCE_RENEWAL':'WAGE_REGISTRY_DEPENDENCY_SOURCE_HOLD');
  assert.equal(verifyWageRenewalEngineWithdrawal(JSON.parse(readFileSync('scripts/qa/tenant-isolation-coverage-manifest.json','utf8'))).size,75);
  for(const file of ['docs/engineering/tenant-isolation-coverage-inventory.md','docs/engineering/tenant-isolation-closure-plan.md']){
    const text=readFileSync(file,'utf8');
    assert.ok(text.includes('> **CURRENT / #2006 PAYROLL-ENGINE SOURCE SUPERSESSION — 75 ZERO-CREDIT HOLDS'));
    assert.ok(text.split('\n\n').some(b=>b.startsWith('> **SSO DEFAULT-OFF INTEGRATION HOLD')));
    // The independently source-verified MKT-01 and OIDC receipts change only the live totals, not historical Studio proofs.
    const studioBanners=text.split('\n').filter(line=>line.startsWith('> **SOLO_VERIFIED_DEV_RECOVERY — complete Studio POST proposal:** '));
    // The inventory records two older Studio checkpoints, while the plan
    // retains one. Neither may be manufactured or erased during reconciliation.
    const expectedBanners=file.endsWith('coverage-inventory.md')?3:2;
    assert.equal(studioBanners.length,expectedBanners,
      'Keep exactly the historical Studio accounting snapshots in each document');
    const live=readWageWithdrawalFixture().metrics;
    assert.equal(live.coveredAfter+live.publicByDesign+live.privilegedOperationsTokenOnly+live.gap,live.methods);
    // The dated studio banner is historical, not the current PR #1989 ledger.
    const base=baseTenantManifest();
    assert.ok(base,'Historical banner comparison requires the fetched comparison base');
    const baseText=execFileSync('git',['show',base.ref+':'+file],{encoding:'utf8'});
    const baseBanner=baseText.split('\n').find(line=>line.startsWith('> **SOLO_VERIFIED_DEV_RECOVERY — complete Studio POST proposal:** '));
    assert.equal(studioBanners[0],baseBanner,'Historical Studio checkpoint must equal main byte-for-byte');
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
