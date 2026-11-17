/** Disposable proof setup only: remove stale credits, never suppress a verifier. */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {ORACLE_HELD_METHODS,verifyOracleSourceHolds} from './payroll-run-oracle-hold.mjs';
import {verifyWageRegistrySourceHold} from './wage-registry-source-hold.mjs';
import {verifyWageRenewalMethod,WAGE_RENEWAL_KIND} from './wage-registry-renewal-verify.mjs';
const FILE='scripts/qa/tenant-isolation-coverage-manifest.json';
const blob=bytes=>createHash('sha1').update('blob '+Buffer.byteLength(bytes)+'\0').update(bytes).digest('hex');
export function zeroCreditSsoProofFixture(input){
  const m=structuredClone(input);
  let held=0, alreadyHeld=0;
  for(const key of ORACLE_HELD_METHODS){
    const at=key.indexOf(' '),verb=key.slice(0,at),file='src/app/api/'+key.slice(at+1)+'/route.ts';
    const row=m.allApiRouteFiles[file].methods.find(r=>r.name===verb);
    if(row.status==='GAP'&&row.reviewedUncertified?.kind==='payroll-run-membership-oracle-source-withdrawal'){
      assert.ok(verifyOracleSourceHolds(m).has(verb+' '+file));alreadyHeld++;continue;
    }
    if(row.status==='GAP' &&
       row.reviewedUncertified?.kind==='wage-registry-dependency-source-withdrawal'){
      // #1989 withdrew these same 19 current-source renewals already. Do not
      // overwrite a stronger wage hold with the older membership-only hold.
      assert.ok(verifyWageRegistrySourceHold(m,file,verb));
      assert.equal(row.testedBy,null);
      assert.equal(row.reviewedUncertified.priorProof.kind,'payroll-run-source-renewal-real-http-pg16');
      assert.equal(row.reviewedUncertified.priorProof.method,key);
      assert.equal(row.historicalOracleSourceWithdrawal?.kind,'payroll-run-membership-oracle-source-withdrawal');
      alreadyHeld++;
      continue;
    }
    assert.equal(row.status,'COVERED','Only the exact nineteen existing renewals may be removed from this disposable fixture');
    if(row.testedBy?.kind===WAGE_RENEWAL_KIND)assert.equal(verifyWageRenewalMethod(m,file,verb),1);
    else{
      assert.equal(row.testedBy?.kind,'payroll-run-source-renewal-real-http-pg16');
      assert.equal(row.testedBy.method,key);
    }
    assert.equal(row.historicalOracleSourceWithdrawal?.kind,'payroll-run-membership-oracle-source-withdrawal');
    row.status='GAP';row.testedBy=null;
    row.reviewedUncertified=structuredClone(row.historicalOracleSourceWithdrawal);
    delete row.historicalOracleSourceWithdrawal;
    delete row.historicalWageSourceWithdrawal;
    row.reason='Fictional CI-only bootstrap: current caller receipt pending; zero credits. Not a committed ledger change.';
    held++;
  }
  // The existing verifier validates all original receipts, route bytes, current
  // membership helper and exact withdrawal objects. Nothing is mocked or skipped.
  assert.equal(held+alreadyHeld,19,'The complete nineteen-method cohort must remain held');
  assert.equal(verifyOracleSourceHolds(m).size,19);
  const rows=Object.values(m.allApiRouteFiles).flatMap(f=>f.methods);
  m.metrics.coveredAfter=rows.filter(r=>r.status==='COVERED').length;
  m.metrics.gap=rows.filter(r=>r.status==='GAP').length;
  assert.equal(input.metrics.coveredAfter-m.metrics.coveredAfter,held);
  assert.equal(m.metrics.gap-input.metrics.gap,held);
  m.acceptanceStatus=m.acceptanceStatus.replace(/^NOT ACCEPTED: \d+ API methods/,'NOT ACCEPTED: '+m.metrics.gap+' API methods');
  return m;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  for(const[k,v]of Object.entries({CI:'true',GITHUB_ACTIONS:'true',
    TENANT_SSO_REPROOF_MANIFEST:'zero-credit-fictional-only',
    DATABASE_URL:'postgresql://postgres:postgres@127.0.0.1:5432/app_db',
    SECURITY_SMOKE_URL:'http://127.0.0.1:3000'}))assert.equal(process.env[k],v,'Refuse non-disposable proof fixture: '+k);
  const before=readFileSync(FILE,'utf8'),m=zeroCreditSsoProofFixture(JSON.parse(before)),after=JSON.stringify(m,null,2)+'\n';
  writeFileSync(FILE,after);
  console.log('SSO_ZERO_CREDIT_FIXTURE '+JSON.stringify({originalManifestBlob:blob(before),fixtureManifestBlob:blob(after),
    heldMethods:19,newDowngrades:JSON.parse(before).metrics.coveredAfter-m.metrics.coveredAfter,
    coverageCredits:0,committedLedgerChanged:false,productionCertified:false}));
}
