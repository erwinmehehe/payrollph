/** Receipt v2: per-method closure pins plus one global base.
 *
 * The v1 receipt pinned the union of every renewed method's inputs (668 files) and verified all of them
 * for every method, so one engine edit withdrew all 75 credits although only a handful of routes reach
 * the engine (docs/qa/tenant-proof-staleness-analysis.md, option e). v2 binds each renewed method to:
 *   - a GLOBAL base that every proof executes (executing workflow, package lock, middleware, schema,
 *     baseline SQL); drift here withholds EVERY v2 method, and
 *   - its OWN closure: route, original proof file, its own receipt citations, and every harness,
 *     fixture and workflow its proof families execute, followed through every local import and every
 *     repository path literal; drift here withholds THAT method only.
 * Verification needs no npm dependency and no compiler: it compares sealed blob hashes only. A new
 * import can only enter a closure by editing a pinned file, which already changes that file's hash.
 * Generation lives in wage-registry-renewal-v2-capture.mjs. This file grants nothing by itself.
 */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {readWageRenewalInventory,INVENTORY_BLOB} from './wage-registry-renewal-plan.mjs';
import {requiredWageFamilies,methodKey} from './wage-registry-renewal-methods.mjs';
// verify.mjs imports this module (its hold view projects v2 rows too), so nothing from it is read at load time.
import {blob,validateWageReceiptResults} from './wage-registry-renewal-verify.mjs';

export const WAGE_RENEWAL_V2_KIND='wage-registry-current-source-pg16-http-renewal-v2';
export const WAGE_RENEWAL_V2_SCHEMA='payrollph-wage-source-pg16-renewal-v2';
export const WAGE_RENEWAL_V2_RECEIPT='scripts/qa/wage-registry-renewal-receipt-v2.json';
// Set only after inspecting real exact-source successful jobs and their output.
export const WAGE_RENEWAL_V2_RECEIPT_BLOB='bbc156c56f63d2ee3ab83de296ddd6e6402eb369';
// Ledger bookkeeping only: never an executed runtime, HTTP assertion or fixture input.
// The first 18 entries equal verify.mjs ACCOUNTING_ONLY (asserted by tests/wage-registry-renewal-v2.test.mjs).
export const V2_ACCOUNTING_ONLY=Object.freeze([
 'scripts/qa/wage-registry-renewal-plan.mjs','scripts/qa/wage-registry-renewal-workflow.mjs','scripts/qa/wage-registry-renewal-methods.mjs',
 'scripts/qa/wage-registry-renewal-results.mjs','scripts/qa/wage-registry-renewal-complete.mjs','scripts/qa/wage-registry-renewal-capture.mjs',
 'scripts/qa/wage-registry-renewal-verify.mjs','scripts/qa/wage-registry-renewal-credit.mjs','scripts/qa/wage-registry-credit-holds.mjs',
 'scripts/qa/wage-registry-source-hold.mjs','scripts/qa/wage-registry-transitive-source-hold.mjs','scripts/qa/wage-registry-sealed-receipt-source-hold.mjs',
 'scripts/qa/payroll-run-oracle-hold.mjs','scripts/qa/tenant-staffing-policy-get-credit.mjs','scripts/qa/tenant-worker360-legal-employer-credit.mjs',
 'scripts/qa/tenant-year-end-credit.mjs','tests/helpers/tenant-counts.mjs','tests/helpers/wage-source-holds.mjs',
 // Ledger reconcilers that must recognise a v2 row; they validate the manifest and never run an HTTP proof.
 'scripts/qa/payroll-run-credit-renewal.mjs','scripts/qa/payroll-run-sso-proof-fixture.mjs','scripts/qa/wage-registry-renewal-supersession.mjs',
 'scripts/qa/wage-registry-renewal-v2.mjs',
 'scripts/qa/wage-registry-renewal-v2-capture.mjs',
 'scripts/qa/wage-registry-renewal-packets.mjs',
]);
// Files every proof executes. Any drift here withholds every v2 method.
export const V2_GLOBAL_ROOTS=Object.freeze([
 '.github/workflows/wage-registry-renewal.yml','package.json','package-lock.json','tsconfig.json','next.config.ts',
 'drizzle.config.ts','src/proxy.ts','src/instrumentation.ts','src/db/schema.ts',
 'scripts/qa/apply-isolated-baseline.mjs','scripts/qa/tenant-table-env.mjs','scripts/qa/prepare-hcm-work-item-fixture.mjs',
 'docs/sql/source-baseline-supplement.sql','drizzle/0109_tamper_evident_audit_chain.sql','drizzle/0104_hcm_work_item_sla.sql',
]);
const REQUIRED_GLOBAL=['.github/workflows/wage-registry-renewal.yml','package-lock.json','src/proxy.ts','src/db/schema.ts'];

export const hasWageRenewalV2Receipt=()=>/^[a-f0-9]{40}$/.test(WAGE_RENEWAL_V2_RECEIPT_BLOB)&&existsSync(WAGE_RENEWAL_V2_RECEIPT);

/** Validates a v2 receipt object: results, eligibility and closure shape. Source drift is checked per method. */
export function validateWageRenewalV2Receipt(r,inventory=readWageRenewalInventory()){
 assert.equal(r.inventoryBlobSha,INVENTORY_BLOB);
 const eligible=validateWageReceiptResults(r,WAGE_RENEWAL_V2_SCHEMA);
 assert.deepEqual(r.accountingScope?.excludedInputs,V2_ACCOUNTING_ONLY,'Accounting scope changed');
 return validateWageRenewalV2Closures(r,inventory,eligible);
}

/** Closure shape only: one closure per eligible method, route and original proof pinned, nothing repeated or bookkeeping. */
export function validateWageRenewalV2Closures(r,inventory,eligible){
 const global=r.globalPins||{};
 for(const file of REQUIRED_GLOBAL)assert.match(global[file]??'',/^[a-f0-9]{40}$/,'Global base must pin '+file);
 const keys=new Set(inventory.methods.map(methodKey));
 assert.deepEqual(Object.keys(r.methodPins||{}).sort(),[...eligible].sort(),'Exactly one closure per eligible method');
 for(const [key,pins]of Object.entries(r.methodPins)){
  assert.ok(keys.has(key),'Unreviewed renewal method '+key);
  const entry=inventory.methods.find(e=>methodKey(e)===key);
  assert.equal(pins[entry.path],entry.routeBlobSha,'Every exact withdrawn handler must remain pinned: '+key);
  const proof=entry.held.reviewedUncertified.priorProof.file;
  if(proof)assert.ok(pins[proof]||global[proof],'Original HTTP assertions cannot be omitted: '+proof);
  for(const [file,sha]of Object.entries(pins)){
   assert.match(sha,/^[a-f0-9]{40}$/);
   assert.ok(!Object.hasOwn(global,file),'A global pin cannot be repeated per method: '+file);
   assert.ok(!V2_ACCOUNTING_ONLY.includes(file),'Bookkeeping cannot masquerade as executed runtime: '+file);
  }
 }
 for(const file of Object.keys(global))assert.ok(!V2_ACCOUNTING_ONLY.includes(file),'Bookkeeping cannot masquerade as executed runtime: '+file);
 return eligible;
}

export function readWageRenewalV2Receipt(read=readFileSync){
 assert.match(WAGE_RENEWAL_V2_RECEIPT_BLOB,/^[a-f0-9]{40}$/,'Fresh v2 execution has not been sealed; no credit');
 const raw=read(WAGE_RENEWAL_V2_RECEIPT);
 assert.equal(blob(raw),WAGE_RENEWAL_V2_RECEIPT_BLOB,'Fresh v2 receipt changed');
 const r=JSON.parse(raw);validateWageRenewalV2Receipt(r,readWageRenewalInventory(read));
 return r;
}

/** Files of this method's global base or own closure whose current bytes differ from the sealed execution. */
export function wageRenewalV2Drift(receipt,key,read=readFileSync){
 const pins={...receipt.globalPins,...(receipt.methodPins[key]??{})};
 assert.ok(receipt.methodPins[key],'No sealed closure for '+key);
 return Object.entries(pins).filter(([file,sha])=>{
  let current;try{current=read(file);}catch(error){if(error.code==='ENOENT')return true;throw error;}
  return blob(current)!==sha;
 }).map(([file])=>file).sort();
}

export function wageRenewalV2Proof(entry,receipt){
 const key=methodKey(entry),jobs=requiredWageFamilies(entry).flatMap(f=>receipt.families[f]);
 const old=entry.held.reviewedUncertified.priorProof,pins={...receipt.globalPins,...receipt.methodPins[key]};
 const anchors=Object.fromEntries(Object.entries(old).filter(([k,v])=>k==='file'||k==='line'||k.endsWith('Line')||['family','profile'].includes(k)||
  (k.endsWith('File')&&k!=='workflowFile'&&typeof v==='string'&&Object.hasOwn(pins,v))));
 return {...anchors,kind:WAGE_RENEWAL_V2_KIND,method:key,routeBlobSha:entry.routeBlobSha,receiptFile:WAGE_RENEWAL_V2_RECEIPT,
  ...(old.file?{proofBlobSha:pins[old.file]}:{}),
  renewalReceiptBlobSha:WAGE_RENEWAL_V2_RECEIPT_BLOB,closurePins:Object.keys(receipt.methodPins[key]).length,globalPins:Object.keys(receipt.globalPins).length,
  evidenceLabel:'SOLO_VERIFIED_DEV_RECOVERY',postgresMajor:16,
  renewedWorkflowJobs:jobs.map(j=>({runId:j.runId,jobId:j.jobId,sourceHead:j.sourceHead,evidence:j.evidence,role:j.metadataOnly?'orchestration':'real-http-pg16'})),
  scope:'Complete original method cohorts: '+requiredWageFamilies(entry).join(', ')+'. Bound to this method\'s own sealed source closure plus the global base; drift outside them does not withdraw it. Actual isolated flag profiles are retained in the executing workflow; no real provider, payroll or production acceptance.',
  independentSecurityReview:'PENDING',independentlyAccepted:false,productionCertified:false,productionTested:false};
}
export function wageRenewalV2Row(entry,receipt){
 const result={...structuredClone(entry.held),status:'COVERED',testedBy:wageRenewalV2Proof(entry,receipt),
  historicalWageSourceWithdrawal:structuredClone(entry.held.reviewedUncertified),
  reason:'SOLO_VERIFIED_DEV_RECOVERY: fresh complete-method fictional PG16/real-HTTP renewal sealed to this method\'s own source closure; original withdrawal and old receipts retained as history. Independent/security/payroll and production acceptance remain PENDING.'};
 delete result.reviewedUncertified;return result;
}

const v2Rows=manifest=>Object.entries(manifest.allApiRouteFiles).flatMap(([path,file])=>file.methods
 .filter(row=>row.testedBy?.kind===WAGE_RENEWAL_V2_KIND).map(row=>({path,row})));

/** Every v2 row must be exactly the sealed row and its closure must be current. Returns the verified keys. */
export function verifyWageRenewalV2Rows(manifest,read=readFileSync){
 const rows=v2Rows(manifest);if(!rows.length)return new Set();
 const receipt=readWageRenewalV2Receipt(read),inventory=readWageRenewalInventory(read),eligible=new Set(receipt.methods),keys=new Set();
 const drifted=[];
 for(const {path,row}of rows){
  const entry=inventory.methods.find(e=>e.path===path&&e.verb===row.name);assert.ok(entry,'Unreviewed renewal method');
  const key=methodKey(entry);assert.ok(eligible.has(key),'Incomplete proof family cannot restore a method');
  assert.equal(manifest.allApiRouteFiles[path].gitBlobSha,entry.routeBlobSha,'Never modify route identity to keep a credit');
  assert.deepEqual(row,wageRenewalV2Row(entry,receipt),'Renewed method metadata/provenance changed');
  const drift=wageRenewalV2Drift(receipt,key,read);
  if(drift.length)drifted.push(key+' <- '+drift.join(', '));
  keys.add(key);
 }
 assert.equal(drifted.length,0,'Wage renewal v2 source drift; withdraw exactly these methods with '+
  '`node scripts/qa/wage-registry-renewal-v2.mjs --withdraw-drifted` (zero credit):\n'+drifted.join('\n'));
 return keys;
}

/** Strict ledger projection: every verified v2 row returns to its exact captured withdrawal. Never HTTP acceptance. */
export function wageRenewalV2HoldView(manifest,read=readFileSync){
 const rows=v2Rows(manifest);if(!rows.length)return manifest;
 verifyWageRenewalV2Rows(manifest,read);
 const inventory=readWageRenewalInventory(read),view=structuredClone(manifest);
 for(const {path,row}of rows){
  const entry=inventory.methods.find(e=>e.path===path&&e.verb===row.name),file=view.allApiRouteFiles[path];
  file.methods[file.methods.findIndex(x=>x.name===row.name)]=structuredClone(entry.held);
 }
 view.metrics.coveredAfter-=rows.length;view.metrics.gap+=rows.length;
 view.acceptanceStatus=view.acceptanceStatus.replace(/^NOT ACCEPTED: \d+ API methods/,'NOT ACCEPTED: '+view.metrics.gap+' API methods');
 return view;
}

/** The only sanctioned demotion: v2 rows whose own closure (or the global base) drifted go back to the exact
 * captured withdrawal. Rows that are still current are untouched. Returns the new manifest and the keys. */
export function withdrawDriftedWageRenewalV2(manifest,read=readFileSync){
 const rows=v2Rows(manifest);if(!rows.length)return {manifest,withdrawn:[]};
 const receipt=readWageRenewalV2Receipt(read),inventory=readWageRenewalInventory(read),next=structuredClone(manifest),withdrawn=[];
 for(const {path,row}of rows){
  const entry=inventory.methods.find(e=>e.path===path&&e.verb===row.name),key=methodKey(entry);
  assert.deepEqual(row,wageRenewalV2Row(entry,receipt),'Renewed method metadata/provenance changed');
  if(!wageRenewalV2Drift(receipt,key,read).length)continue;
  const file=next.allApiRouteFiles[path];file.methods[file.methods.findIndex(x=>x.name===row.name)]=structuredClone(entry.held);
  withdrawn.push(key);
 }
 next.metrics.coveredAfter-=withdrawn.length;next.metrics.gap+=withdrawn.length;
 next.acceptanceStatus=next.acceptanceStatus.replace(/^NOT ACCEPTED: \d+ API methods/,'NOT ACCEPTED: '+next.metrics.gap+' API methods');
 return {manifest:next,withdrawn:withdrawn.sort()};
}

const MANIFEST='scripts/qa/tenant-isolation-coverage-manifest.json';
const PLAN='docs/engineering/tenant-isolation-closure-plan.md';
const OVERVIEW='docs/engineering/tenant-isolation-coverage-inventory.md';
const REPORT='docs/qa/wage-registry-75-method-renewal.md';
const V2_LINK='../../scripts/qa/wage-registry-renewal-receipt-v2.json';
const V2_CELL=' + [Fresh v2 per-method PG16 renewal]('+V2_LINK+')';
const V2_BANNER='> **CURRENT / WAGE-SOURCE API RENEWAL v2 (PER-METHOD SOURCE CLOSURES) — SOLO_VERIFIED_DEV_RECOVERY:** ';
const REPORT_START='<!-- wage-renewal-v2:start -->',REPORT_END='<!-- wage-renewal-v2:end -->';
const apiKey=entry=>entry.verb+' /api/'+entry.path.slice('src/app/api/'.length,-'/route.ts'.length);
const countStatuses=m=>Object.values(m.allApiRouteFiles).flatMap(x=>x.methods).reduce((a,r)=>(a[r.status]=(a[r.status]||0)+1,a),{});

/** Credit every eligible, drift-free method from the sealed v2 receipt, or (withdrawDrifted) demote only drifted
 * v2 rows back to their exact captured withdrawal. Rewrites the ledger documents to match. */
export async function reconcileWageRenewalV2({write=false,withdrawDrifted=false}={},read=readFileSync){
 const {regeneratedOverview,regeneratedClosure}=await import('./tenant-mkt01-marketing-credit.mjs');
 const {reconcilePlan}=await import('./payroll-run-credit-renewal.mjs');
 const receipt=readWageRenewalV2Receipt(read),inventory=readWageRenewalInventory(read);
 const input=JSON.parse(read(MANIFEST,'utf8'));
 let manifest=structuredClone(input),credited=[],withdrawn=[];
 if(withdrawDrifted)({manifest,withdrawn}=withdrawDriftedWageRenewalV2(manifest,read));
 else{
  const eligible=new Set(receipt.methods);
  for(const entry of inventory.methods){
   const key=methodKey(entry),route=manifest.allApiRouteFiles[entry.path];
   assert.equal(route.gitBlobSha,entry.routeBlobSha,'Never modify route identity to obtain a credit');
   const index=route.methods.findIndex(x=>x.name===entry.verb),row=route.methods[index];
   if(!eligible.has(key)||wageRenewalV2Drift(receipt,key,read).length)continue;
   if(row.testedBy?.kind===WAGE_RENEWAL_V2_KIND){assert.deepEqual(row,wageRenewalV2Row(entry,receipt));continue;}
   assert.deepEqual(row,entry.held,'Only the exact captured withdrawal may be renewed: '+key);
   route.methods[index]=wageRenewalV2Row(entry,receipt);credited.push(key);
  }
 }
 const after=countStatuses(manifest);
 manifest.metrics.coveredAfter=after.COVERED||0;manifest.metrics.gap=after.GAP||0;
 assert.equal(manifest.metrics.methods,Object.values(after).reduce((a,n)=>a+n,0));
 manifest.acceptanceStatus=manifest.acceptanceStatus.replace(/^NOT ACCEPTED: \d+ API methods/,'NOT ACCEPTED: '+manifest.metrics.gap+' API methods');
 verifyWageRenewalV2Rows(manifest,read);
 const renewed=new Set(Object.values(manifest.allApiRouteFiles).flatMap(f=>f.methods).filter(r=>r.testedBy?.kind===WAGE_RENEWAL_V2_KIND).map(r=>r.testedBy.method));
 const summary=manifest.metrics.methods+' methods = **'+manifest.metrics.coveredAfter+' COVERED + '+manifest.metrics.publicByDesign+' PUBLIC-BY-DESIGN + '+
  manifest.metrics.privilegedOperationsTokenOnly+' PRIVILEGED-OPERATIONS-TOKEN-ONLY + '+manifest.metrics.gap+' GAP**';
 const jobs=Object.values(receipt.families).flat(),runs=[...new Set(jobs.map(j=>j.runId))],heads=[...new Set(jobs.map(j=>j.sourceHead))];
 const banner=V2_BANNER+summary+'. '+renewed.size+' of 75 wage-withdrawn methods renewed from [fresh PG16/real-HTTP run '+runs.join(', ')+
  '](https://github.com/erwinmehehe/payrollph/actions/runs/'+runs[0]+') at `'+heads.join('`, `')+'`; each is bound to its own sealed source closure plus a global base, so a later edit withdraws only the methods that execute it. Independent/security/payroll and production acceptance PENDING. No live release, provider or money activation.';
 const lines=(text,fn)=>text.split('\n').map(fn).join('\n');
 const withBanner=text=>{
  text=text.split('\n\n').filter(p=>!p.startsWith(V2_BANNER)).join('\n\n');
  const at=text.indexOf('\n\n');assert.ok(at>0,'Ledger heading missing');
  return text.slice(0,at+2)+banner+'\n\n'+text.slice(at+2);
 };
 const covered=key=>renewed.has(key);
 let plan=lines(read(PLAN,'utf8'),line=>{
  const m=/^- (?:HELD|RENEWED) `([A-Z]+ \/api\/[^`]+)` — /.exec(line);if(!m)return line;
  const entry=inventory.methods.find(e=>apiKey(e)===m[1]);if(!entry)return line;
  if(covered(methodKey(entry)))return '- RENEWED `'+m[1]+'` — [per-method source-sealed v2 PG16 renewal]('+V2_LINK+'); independent acceptance PENDING';
  return line.includes(V2_LINK)?'- HELD `'+m[1]+'` — [v2 renewal source drift; zero credit until a fresh renewal]('+V2_LINK+'); independent acceptance PENDING':line;
 });
 plan=withBanner(regeneratedClosure(reconcilePlan(plan,manifest),manifest));
 let overview=lines(read(OVERVIEW,'utf8'),line=>{
  const entry=inventory.methods.find(e=>line.startsWith('| [`'+e.path.slice('src/app/api/'.length,-'/route.ts'.length)+'` '+e.verb+']'));
  if(!entry)return line;
  const cells=line.split(' | ');
  cells[cells.length-2]=cells[cells.length-2].replace(V2_CELL,'')+(covered(methodKey(entry))?V2_CELL:'');
  cells[cells.length-1]='**'+manifest.allApiRouteFiles[entry.path].methods.find(r=>r.name===entry.verb).status+'** |';
  return cells.join(' | ');
 });
 overview=withBanner(regeneratedOverview(overview,manifest));
 const section=[REPORT_START,'# Wage-source API renewal v2 (per-method source closures)','',
  'SOLO_VERIFIED_DEV_RECOVERY. '+summary+'. '+renewed.size+' of 75 methods CREDITED from one fresh run; '+(75-renewed.size)+' remain zero-credit holds.','',
  'Execution: '+runs.map(r=>'[run '+r+'](https://github.com/erwinmehehe/payrollph/actions/runs/'+r+')').join(', ')+', '+jobs.length+' successful jobs at exact source head `'+heads.join('`, `')+'`. Receipt: [`wage-registry-renewal-receipt-v2.json`](../../scripts/qa/wage-registry-renewal-receipt-v2.json) ('+Object.keys(receipt.globalPins).length+' global pins; one closure per method).','',
  'A later change withdraws only the methods whose own closure or the global base contains the changed file: run `node scripts/qa/wage-registry-renewal-v2.mjs --withdraw-drifted` (zero credit) and commit the result.','',
  '| Method | Result | Closure files | Fresh executed evidence |','| --- | --- | --- | --- |',
  ...inventory.methods.map(entry=>{
   const key=methodKey(entry),row=manifest.allApiRouteFiles[entry.path].methods.find(r=>r.name===entry.verb);
   const links=row.testedBy?.kind===WAGE_RENEWAL_V2_KIND?[...new Set(row.testedBy.renewedWorkflowJobs.filter(j=>j.role==='real-http-pg16').map(j=>j.evidence))].map((u,i)=>'[PG16 '+(i+1)+']('+u+')').join(' + '):'zero credit';
   return '| `'+apiKey(entry)+'` | '+(covered(key)?'CREDITED':'HELD')+' | '+(receipt.methodPins[key]?Object.keys(receipt.methodPins[key]).length:'-')+' | '+links+' |';
  }),REPORT_END].join('\n');
 const oldReport=read(REPORT,'utf8'),start=oldReport.indexOf(REPORT_START),end=oldReport.indexOf(REPORT_END);
 const report=start>=0?oldReport.slice(0,start)+section+oldReport.slice(end+REPORT_END.length):section+'\n\n'+oldReport;
 const updates=[[MANIFEST,JSON.stringify(manifest,null,2)+'\n'],[PLAN,plan],[OVERVIEW,overview],[REPORT,report]];
 const changed=updates.some(([file,text])=>read(file,'utf8')!==text);
 if(write)for(const [file,text]of updates)writeFileSync(file,text);
 return {covered:manifest.metrics.coveredAfter,gap:manifest.metrics.gap,renewed:renewed.size,credited,withdrawn,changed,wrote:write};
}

const cli=process.argv[1]?.replaceAll('\\','/').endsWith('/wage-registry-renewal-v2.mjs');
if(cli){
 const withdraw=process.argv.includes('--withdraw-drifted');
 assert.ok(withdraw||process.argv.includes('--write')||process.argv.includes('--check'),'Use --check, --write or --withdraw-drifted');
 // No top-level await: the ledger modules imported below import this module back.
 reconcileWageRenewalV2({write:withdraw||process.argv.includes('--write'),withdrawDrifted:withdraw}).then(result=>{
  console.log(JSON.stringify(result));
  if(process.argv.includes('--check')&&result.changed)process.exitCode=1;
 });
}
