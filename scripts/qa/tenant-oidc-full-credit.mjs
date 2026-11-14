import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {verifyOidcBatchMethod} from './tenant-oidc-batch-credit.mjs';
export const OIDC_CALLBACK='src/app/api/auth/sso/callback/route.ts';
export const OIDC_RECEIPT='scripts/qa/tenant-oidc-full-renewal-receipt.json';
const HARNESS='scripts/qa/tenant-oidc-full-http.mjs';
const MANIFEST='scripts/qa/tenant-isolation-coverage-manifest.json';
const INVENTORY='docs/engineering/tenant-isolation-coverage-inventory.md';
const digest=x=>createHash('sha256').update(String(x).replaceAll('\r\n','\n')).digest('hex');
export function oidcFullExecution(read=readFileSync){
 assert.equal(digest(read('scripts/qa/tenant-oidc-full-receipt.json','utf8')),'26540730ee86fca67a9e01858867a4d854a61b0afc09dd1d892f3fe646428a27','Historical OIDC receipt changed');
 const raw=read(OIDC_RECEIPT,'utf8');
 assert.equal(digest(raw),'833b92c3ac44cbdca519fd2bea5969ad207449242b59e002e0878df49c1cdcbb','Executed OIDC receipt changed');
 const r=JSON.parse(raw);
 assert.equal(r.sourceCommit,'d46ed24b239b47a2182b868f399f3cbb1d706ca0');
 assert.equal(r.workflowRunId,43251981343);assert.equal(r.workflowJobId,131299924274);assert.equal(r.jobConclusion,'success');
 assert.equal(r.evidence,'https://github.com/erwinmehehe/payrollph/actions/runs/43251981343/job/131299924274');
 assert.equal(r.method,'GET auth/sso/callback');assert.equal(r.evidenceClassification,'SOLO_VERIFIED_DEV_RECOVERY');
 assert.deepEqual([r.ownLogins,r.refusedCallbacks,r.authenticatedForeignReadsDenied],[2,43,2]);
 for(const k of ['victimOwnLogin','realPkce','realRsaJwks','tlsVerificationEnabled','ssrfGuardUnchanged','onlyLocallyRoutedSyntheticIdp'])assert.equal(r[k],true,k);
 assert.equal(r.transportMocks,false);assert.equal(r.realProviderCalls,0);assert.equal(r.coverageCredits,0);assert.equal(r.productionCertified,false);
 assert.equal(r.independentSecurityReview,'PENDING');
 assert.equal(Object.keys(r.proofInputs).length,11);assert.equal(Object.keys(r.additionalInputs).length,16);
 for(const [p,sha]of Object.entries({...r.proofInputs,...r.additionalInputs}))assert.equal(digest(read(p,'utf8')),sha,'Executed OIDC source/proof drift: '+p);
 return r;
}
const anchors={line:'Own callback must authenticate:',ownPositiveLine:'Own callback must authenticate:',
 foreignDenialLine:'await reject(victimFlow, 403,',unchangedDbLine:'Denied callback changed victim SQL',
 forgedSelectorLine:'const url = flow.url + "&organizationId="',
 discriminationLine:'assert.equal(foreign.status, 403); discriminator++',
 victimPositiveLine:'assert.equal(victimLogin.status, 302)',victimIdOrderingLine:'assert.ok(v.org.id > Math.max',
 twoAttackerLine:'let denied = 0, ownLogins = 0, discriminator = 0;'};
function expected(read=readFileSync){const r=oidcFullExecution(read),lines=read(HARNESS,'utf8').split('\n'),citations={};
 for(const[k,marker]of Object.entries(anchors)){const matches=lines.flatMap((s,i)=>s.includes(marker)?[i+1]:[]);assert.equal(matches.length,1,'Unique evidence anchor: '+marker);citations[k]=matches[0];}
 return {file:HARNESS,...citations,receiptFile:OIDC_RECEIPT,routeBlobSha:'a27d855a81751498cc907134e8e9dde7400c9f58',
  sourceHead:r.sourceCommit,workflowRunId:r.workflowRunId,workflowJobId:r.workflowJobId,evidence:r.evidence,
  evidenceLabel:'SOLO_VERIFIED_DEV_RECOVERY',postgresMajor:16,independentlyAccepted:false,independentSecurityReview:'PENDING',productionCertified:false,
  scope:'Real production Next and disposable PG16 with synthetic CA-verified HTTPS IdP, client-authenticated token exchange, S256 PKCE and RSA/JWKS verification. Two employer-owned real sessions, forged selectors ignored, 43 refused callbacks with unchanged victim/account/membership/identity/session/audit SQL, two authenticated foreign API denials and a successful genuine victim comparator. No real IdP or production acceptance.'};
}
export function verifyOidcCallbackCredit(m,read=readFileSync){const e=m.allApiRouteFiles[OIDC_CALLBACK],row=e.methods.find(x=>x.name==='GET');
 if(row.testedBy?.kind==='oidc-start-callback-batch-real-https-pg16')return verifyOidcBatchMethod(m,OIDC_CALLBACK,read);
 assert.equal(e.gitBlobSha,'a27d855a81751498cc907134e8e9dde7400c9f58');assert.equal(row.status,'COVERED');assert.equal(row.reviewedUncertified,undefined);assert.deepEqual(row.testedBy,expected(read));return 1;
}
function reconcileClosure(m,write){
 const path='docs/engineering/tenant-isolation-closure-plan.md';let doc=readFileSync(path,'utf8');
 const begin=doc.indexOf('### Current 406-method frozen batch queue'),end=doc.indexOf('### Three narrowly promoted API methods',begin);
 assert.ok(begin>=0&&end>begin);const section=doc.slice(begin,end),rows=section.split('\n');
 // Count the immutable source-linked queue itself: supplemental methods can
 // legitimately be GAP after a source withdrawal, independently of this credit.
 const frozen=[...doc.matchAll(/^- `(GET|POST|PATCH|PUT|DELETE|HEAD|OPTIONS) \/api\/([^`]+)` — \[source\]/gm)].map(x=>[x[1],x[2]]);
 assert.equal(frozen.length,406);assert.equal(new Set(frozen.map(x=>x.join(' '))).size,406);
 const statuses=['COVERED','PUBLIC-BY-DESIGN','PRIVILEGED-OPERATIONS-TOKEN-ONLY','GAP'];
 const totals=[0,0,0,0];for(const [method,path]of frozen){
  const entry=m.allApiRouteFiles['src/app/api/'+path+'/route.ts'];
  const row=entry?.methods.find(x=>x.name===method);assert.ok(row,'Missing frozen method: '+method+' '+path);
  const index=statuses.indexOf(row.status);assert.ok(index>=0);totals[index]++;
 }
 assert.equal(totals.reduce((a,b)=>a+b,0),406);
 const other=[0,0,0,0];for(const line of rows.filter(x=>x.startsWith('| ')&&/\*\*[A-Z]+-\d+\*\*/.test(x)&&!x.includes('**EDG-01**'))){const cells=line.split('|');for(let i=0;i<4;i++)other[i]+=Number(cells[i+4]);}
 const at=rows.findIndex(x=>x.includes('**EDG-01**'));assert.ok(at>=0);const cells=rows[at].split('|');
 for(let i=0;i<4;i++){const n=totals[i]-other[i];assert.ok(Number.isSafeInteger(n)&&n>=0);cells[i+4]=' '+n+' ';}rows[at]=cells.join('|');
 let next=rows.join('\n').replace(/Frozen subtotal \(2026-11-11 classification proposal\): \*\*\d+ COVERED \+ \d+ PUBLIC-BY-DESIGN \+ \d+ PRIVILEGED-OPERATIONS-TOKEN-ONLY \+ \d+ GAP = 406\*\*/,
 'Frozen subtotal (2026-11-11 classification proposal): **'+totals[0]+' COVERED + '+totals[1]+' PUBLIC-BY-DESIGN + '+totals[2]+' PRIVILEGED-OPERATIONS-TOKEN-ONLY + '+totals[3]+' GAP = 406**');
 doc=doc.slice(0,begin)+next+doc.slice(end);if(write)writeFileSync(path,doc);
}
export function creditOidcCallback({write=false}={}){
 const m=JSON.parse(readFileSync(MANIFEST,'utf8')),row=m.allApiRouteFiles[OIDC_CALLBACK].methods.find(x=>x.name==='GET');
 const before={covered:m.metrics.coveredAfter,gap:m.metrics.gap};
 if(row.status==='COVERED'){
  if(write){
   assert.equal(m.allApiRouteFiles[OIDC_CALLBACK].gitBlobSha,'a27d855a81751498cc907134e8e9dde7400c9f58');
   assert.ok(['cf71730f01c2841dbba828bd24c7c802c7832b01',oidcFullExecution().sourceCommit].includes(row.testedBy?.sourceHead),'Unknown prior callback proof');
   const previous=row.testedBy.evidence;row.testedBy=expected();row.reason=row.reason.replaceAll(previous,row.testedBy.evidence);
   m.acceptanceStatus=m.acceptanceStatus.replaceAll(previous,row.testedBy.evidence);
   verifyOidcCallbackCredit(m);
   writeFileSync(MANIFEST,JSON.stringify(m,null,2)+'\n');
   writeFileSync(INVENTORY,readFileSync(INVENTORY,'utf8').replaceAll(previous,row.testedBy.evidence));
  }
  verifyOidcCallbackCredit(m);reconcileClosure(m,write);return {write,before,after:before,newCredits:0};
 }
 assert.equal(row.status,'GAP');assert.equal(row.testedBy,null);
 row.testedBy=expected();row.status='COVERED';delete row.reviewedUncertified;
 row.reason='Provisional complete synthetic IdP HTTPS/PG16 callback proof: two actual own sessions, real victim/browser/code denials, forged selectors and unchanged protected SQL. '+row.testedBy.evidence+'. SOLO_VERIFIED_DEV_RECOVERY; independent review and production acceptance PENDING.';
 const all=Object.values(m.allApiRouteFiles).flatMap(x=>x.methods);m.metrics.coveredAfter=all.filter(x=>x.status==='COVERED').length;m.metrics.gap=all.filter(x=>x.status==='GAP').length;
 assert.equal(m.metrics.coveredAfter,before.covered+1);assert.equal(m.metrics.gap,before.gap-1);
 m.acceptanceStatus=m.acceptanceStatus.replace(/^NOT ACCEPTED: \d+ API methods/,'NOT ACCEPTED: '+m.metrics.gap+' API methods')+' OIDC callback synthetic IdP proof: '+row.testedBy.evidence+'; no production acceptance.';
 let doc=readFileSync(INVENTORY,'utf8');
 for(const[k,old,next]of [['coveredAfter',before.covered,m.metrics.coveredAfter],['gap',before.gap,m.metrics.gap]]){const marker='| '+k+' | '+old+' |';assert.equal(doc.split(marker).length,2);doc=doc.replace(marker,'| '+k+' | '+next+' |');}
 const lines=doc.split('\n'),index=lines.findIndex(x=>x.startsWith('| [`auth/sso/callback` GET]'));assert.ok(index>=0);assert.ok(lines[index].includes('**GAP**'));
 lines[index]=lines[index].replace('| NO VALID METHOD PROOF | **GAP** |','| [complete HTTPS IdP proof]('+row.testedBy.evidence+') | **COVERED** |');assert.ok(lines[index].includes('**COVERED**'));
 doc=lines.join('\n').replace(/^> \*\*RELEASE BLOCKER:\*\* \d+ API methods/m,'> **RELEASE BLOCKER:** '+m.metrics.gap+' API methods').replace(/^> \*\*NOT ACCEPTED\*\*: \d+ (?:API )?method gaps/m,'> **NOT ACCEPTED**: '+m.metrics.gap+' method gaps');
 doc='> **SOLO_VERIFIED_DEV_RECOVERY — OIDC callback proposal:** '+m.metrics.coveredAfter+' COVERED / '+m.metrics.gap+' API GAP. [Actual HTTPS IdP/PG16 receipt]('+row.testedBy.evidence+'). Start/resolve remain GAP. Independent and production acceptance PENDING.\n\n'+doc;
 verifyOidcCallbackCredit(m);reconcileClosure(m,write);if(write){writeFileSync(MANIFEST,JSON.stringify(m,null,2)+'\n');writeFileSync(INVENTORY,doc);}
 return {write,before,after:{covered:m.metrics.coveredAfter,gap:m.metrics.gap},newCredits:1};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){assert.ok(['--credit','--check'].includes(process.argv[2]));console.log(JSON.stringify(creditOidcCallback({write:process.argv[2]==='--credit'})));}
