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

test('each sealed fresh input set equals the full locked-compiler import closure',()=>{
  for(const [name,cohort] of Object.entries(receipt().cohorts)){
    const actual=collectRenewalInputs(cohort.roots,undefined,undefined,true);
    for(const [file,expected] of Object.entries(cohort.sourcePins)){
      if(actual[file]===expected)continue;
      if(['src/lib/wage-orders.ts','src/lib/statutory-rule-watch.ts'].includes(file)){
        // Check the immutable historical receipt in isolation: its actual current
        // source is DIFFERENT, all affected methods are explicitly HELD, and
        // readVerifiedPayrollRenewal must reject these old source pins.
        assert.notEqual(actual[file],expected);
        assert.equal(verifyAllWageRegistrySourceHolds(JSON.parse(readFileSync('scripts/qa/tenant-isolation-coverage-manifest.json','utf8'))).length,23);
        actual[file]=expected;
        continue;
      }
      // Only two exact, reviewed default-OFF SSO probe changes may borrow
      // the earlier source pin after a current-source fictional PG16 reproof.
      assert.ok(isReviewedHeldSsoSecondPassInput(name,file,expected) ||
        isReviewedFiveScopedPageProbeInput(name,file,expected),
        'Unreviewed execution input or import drift: '+name+': '+file);
      actual[file]=expected;
    }
    // The changed page probe imports two new, separately source-sealed,
    // page-only accounting modules. They cannot retroactively enter an
    // immutable payroll execution receipt or extend its method credits.
    if(name==='secondPass'){
      assert.ok(isReviewedFiveScopedPageProbeInput(name,
        'scripts/qa/tenant-scoped-page-probes.mjs',
        cohort.sourcePins['scripts/qa/tenant-scoped-page-probes.mjs']));
      const manifest=JSON.parse(readFileSync('scripts/qa/tenant-isolation-coverage-manifest.json','utf8'));
      const marketingGet=manifest.allApiRouteFiles['src/app/api/marketing/leads/route.ts']?.methods
        .find(method=>method.name==='GET');
      // The standalone MKT-01 proof cannot alter an old payroll receipt.
      // Permit its exact reviewed accounting imports only after independent
      // operator-only receipt/source validation; fail on every other new input.
      const mktCredit=marketingGet?.status==='COVERED'?assertMkt01Receipt(manifest):0;
      // The exact archived payroll proof is unchanged. Recognize only this
      // source-pinned MKT-01/OIDC ledger adaptation, after both separate
      // independent synthetic execution receipts verify completely.
      assert.equal(mktCredit,1,"Operator-only MKT-01 receipt required");
      assert.equal(verifyOidcBatchCredits(manifest),2,"Both OIDC protocol receipts required");
      // Historical payroll receipts cannot absorb the six-page closure. The
      // separate six-page compat verifier has already source-validated every
      // candidate and reconstructed the immutable 10/11 ledger.
      const reviewedPageOnlyImports = new Map([
        ['scripts/qa/tenant-five-scoped-page-credit.mjs',
          '6d41c7f76cce4c6835994912b56a35eeb4315109'],
        ['scripts/qa/tenant-six-scoped-page-credit.mjs',
          'ecedd3988aebfde1549b69e67b704c8db30b1999'],
        ['scripts/qa/tenant-four-scoped-page-credit.mjs',
          '43f4b303e6c2fd957f3301f4a5418584bda26306'],
        ['scripts/qa/payroll-run-five-scoped-page-source-compat.mjs',
          '56c6f539f4e21c91533e8ca85fbc61c2dbbf77cc'],
        ['scripts/qa/tenant-oidc-batch-credit-verify.mjs',
          'c7f5986f71d1e68df93ba391b891ade2685857fa'],
        ['scripts/qa/tenant-mkt01-marketing-credit.mjs',
          '6b71ba5a442e263064b260e260abbc6334d4a04c'],
        ['scripts/qa/tenant-saml-metadata-privacy-verify.mjs','adb087454e668257a9f149dbe7574ce2f7042557'],
        ['scripts/qa/tenant-saml-metadata-public-policy.mjs','13571ec83005ee6220ee99a9649482597d61c682'],
      ]);
      for(const [path,expectedSha] of reviewedPageOnlyImports){
        if(!Object.hasOwn(actual,path))continue;
        assert.equal(actual[path],expectedSha,'Unreviewed new page-only import: '+path);
        delete actual[path];
      }
    }
    assert.deepEqual(actual,cohort.sourcePins,'No unreviewed input may join or leave the executed closure');
  }
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
