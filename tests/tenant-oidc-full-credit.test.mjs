import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {historicOidcBatchView} from '../scripts/qa/tenant-oidc-batch-credit.mjs';
import {oidcFullExecution,verifyOidcCallbackCredit,OIDC_CALLBACK,OIDC_RECEIPT} from '../scripts/qa/tenant-oidc-full-credit.mjs';
import {assertHistoricalPinnedNetworkPreserved} from '../scripts/qa/tenant-node22-pinned-source-compat.mjs';
const manifest=()=>JSON.parse(readFileSync('scripts/qa/tenant-isolation-coverage-manifest.json','utf8'));
const replaceRead=(path,value)=>(p,...args)=>p===path?value:readFileSync(p,...args);
test('historical HTTPS/PG16 evidence remains real but is not a current callback credit after default-off source change',()=>{
 const r=JSON.parse(readFileSync(OIDC_RECEIPT,'utf8'));
 assert.equal(r.ownLogins,2);assert.equal(r.refusedCallbacks,43);
 assert.equal(r.jobConclusion,'success');
 const m=historicOidcBatchView(manifest()),row=m.allApiRouteFiles[OIDC_CALLBACK].methods.find(x=>x.name==='GET');
 assert.equal(row.status,'GAP');assert.equal(row.testedBy,null);
 assert.equal(row.reviewedUncertified?.linkedIdentityBoundary?.priorProofSuperseded,true);
 assert.equal(row.reviewedUncertified?.linkedIdentityBoundary?.credits,0);
 assert.throws(()=>oidcFullExecution(),/source.*drift/i);
 assert.throws(()=>verifyOidcCallbackCredit(m));
});
test('partial, forged or pending receipts cannot grant callback credit',()=>{
 const raw=JSON.parse(readFileSync(OIDC_RECEIPT,'utf8'));
 for(const patch of [{ownLogins:1},{refusedCallbacks:0},{jobConclusion:'queued'},{transportMocks:true},{realProviderCalls:1},{sourceCommit:'0'.repeat(40)}])
  assert.throws(()=>oidcFullExecution(replaceRead(OIDC_RECEIPT,JSON.stringify({...raw,...patch}))),/receipt changed/);
});
test('source drift invalidates execution, including real network security and MFA code',()=>{
 for(const p of ['src/lib/security-network.ts','src/lib/enterprise-session.ts','src/app/api/auth/sso/callback/route.ts',
  'scripts/qa/tenant-oidc-full-http.mjs','.github/workflows/tenant-oidc-full-http.yml'])
  assert.throws(()=>oidcFullExecution(replaceRead(p,readFileSync(p,'utf8')+'\n// changed')),/source.*drift/);
});
test('forged callback promotion or false production acceptance cannot restore a superseded credit',()=>{
 for(const patch of [{workflowRunId:1},{foreignDenialLine:1},{independentlyAccepted:true},{productionCertified:true},{file:'scripts/qa/tenant-table-http.mjs'}]){
  const m=manifest(),row=m.allApiRouteFiles[OIDC_CALLBACK].methods[0];
  row.status='COVERED';row.testedBy=patch;
  assert.throws(()=>verifyOidcCallbackCredit(m));
 }
});
test('network compatibility retains the exact historic logic and never rewrites its receipt',()=>{
 const p='src/lib/security-network.ts',bytes=readFileSync(p),old='f263da3898451ee53c7b3d1490241ea8aa46e0c2';
 assert.deepEqual(assertHistoricalPinnedNetworkPreserved(bytes,old),{newCredits:0,historicalReexecution:false,productionAccepted:false});
 for(const source of [bytes.toString().replace('isForbiddenIp(address)','false'),bytes.toString()+'\n// unreviewed',bytes.toString().replace('servername: target.hostname','rejectUnauthorized: false')])
  assert.throws(()=>assertHistoricalPinnedNetworkPreserved(Buffer.from(source),old));
 assert.throws(()=>assertHistoricalPinnedNetworkPreserved(bytes,'0'.repeat(40)));
});
