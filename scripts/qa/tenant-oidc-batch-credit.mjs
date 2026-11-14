/** Restricted credit writer; pure receipt verification lives outside this write/import graph. */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {OIDC_START,OIDC_BATCH_CALLBACK,verifyOidcBatchCredits,expectedOidcBatchProof} from './tenant-oidc-batch-credit-verify.mjs';
export * from './tenant-oidc-batch-credit-verify.mjs';
const TARGETS=[OIDC_START,OIDC_BATCH_CALLBACK];
const MANIFEST='scripts/qa/tenant-isolation-coverage-manifest.json';
const INVENTORY='docs/engineering/tenant-isolation-coverage-inventory.md',PLAN='docs/engineering/tenant-isolation-closure-plan.md';
export async function creditOidcBatch({write=false}={}){
 const m=JSON.parse(readFileSync(MANIFEST)),before={covered:m.metrics.coveredAfter,gap:m.metrics.gap};
 const rows=TARGETS.map(path=>m.allApiRouteFiles[path].methods.find(x=>x.name==='GET'));
 if(rows.every(r=>r.status==='COVERED')){verifyOidcBatchCredits(m);await reconcileOidcCreditDocs(write);return{write,before,after:before,newCredits:0};}
 assert.ok(rows.every(r=>r.status==='GAP'&&r.testedBy===null),'Only the complete two-method GAP pair may be promoted');assert.ok(write,'Execute reviewed credit writer first');
 for(const path of TARGETS){const row=m.allApiRouteFiles[path].methods.find(x=>x.name==='GET');
  const prior=structuredClone(row);row.status='COVERED';row.testedBy=expectedOidcBatchProof(path);
  if(row.reviewedUncertified)row.historicalOidcSourceWithdrawal=prior;
  delete row.reviewedUncertified;
  row.reason='Provisional current-source identity protocol proof: '+row.testedBy.scope+'. '+row.testedBy.evidence+'. SOLO_VERIFIED_DEV_RECOVERY; default-OFF deployment, anonymous resolve GAP, independent identity/security/privacy and production acceptance PENDING.';
 }
 const all=Object.values(m.allApiRouteFiles).flatMap(x=>x.methods);
 m.metrics.coveredAfter=all.filter(x=>x.status==='COVERED').length;m.metrics.gap=all.filter(x=>x.status==='GAP').length;
 assert.equal(m.metrics.coveredAfter,before.covered+2);assert.equal(m.metrics.gap,before.gap-2);
 m.acceptanceStatus=m.acceptanceStatus.replace(/^NOT ACCEPTED: \d+ API methods/,'NOT ACCEPTED: '+m.metrics.gap+' API methods')+
  ' Current-source OIDC start/callback recovery: '+rows[0].testedBy.evidence+'; anonymous resolve remains GAP by owner decision. No production SSO activation.';
 verifyOidcBatchCredits(m);writeFileSync(MANIFEST,JSON.stringify(m,null,2)+'\n');
 let inventory=readFileSync(INVENTORY,'utf8');
 for(const path of TARGETS){const route=m.allApiRouteFiles[path].route,lines=inventory.split('\n');
  const at=lines.findIndex(l=>l.startsWith('| [`'+route+'` GET]'));assert.ok(at>=0&&lines[at].includes('**GAP**'));
  lines[at]=lines[at].replace('| NO VALID METHOD PROOF | **GAP** |','| [current HTTPS IdP / PG16]('+rows[0].testedBy.evidence+') | **COVERED** |');
  assert.ok(lines[at].includes('**COVERED**'));inventory=lines.join('\n');
 }
 const prefix='> **SSO DEFAULT-OFF INTEGRATION HOLD (PR #1954, pending review):** ';
 const banner=prefix+'Deployment remains default-OFF. Source-current start and callback proofs provisionally recover two protocol methods; anonymous resolve remains GAP by explicit owner decision. **498 methods = '+m.metrics.coveredAfter+' COVERED / 23 PUBLIC-BY-DESIGN / 12 TOKEN-ONLY / '+m.metrics.gap+' GAP**. Independent identity/privacy/security and production acceptance PENDING.';
 for(const[file,text]of [[INVENTORY,inventory],[PLAN,readFileSync(PLAN,'utf8')]]){
  assert.ok(text.startsWith(prefix));writeFileSync(file,banner+text.slice(text.indexOf('\n')));
 }
 await reconcileOidcCreditDocs(true);
 return{write,before,after:{covered:m.metrics.coveredAfter,gap:m.metrics.gap},newCredits:2};
}
async function reconcileOidcCreditDocs(write){
 const {reconcilePayrollRenewal}=await import('./payroll-run-credit-renewal.mjs');
 const {reconcileStudioPostCredit}=await import('./tenant-studio-post-credit.mjs');
 reconcilePayrollRenewal({write});reconcileStudioPostCredit({write});
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 assert.ok(['--write','--check'].includes(process.argv[2]));
 // Complete module evaluation before importing historical reconcilers that
 // themselves validate this receipt. Awaiting here would form an ESM cycle.
 creditOidcBatch({write:process.argv[2]==='--write'}).then(result=>console.log(JSON.stringify(result)))
  .catch(error=>{console.error(error);process.exitCode=1;});
}
