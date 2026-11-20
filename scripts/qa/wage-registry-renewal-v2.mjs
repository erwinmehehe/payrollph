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
import {readFileSync,existsSync} from 'node:fs';
import {readWageRenewalInventory,INVENTORY_BLOB} from './wage-registry-renewal-plan.mjs';
import {requiredWageFamilies,methodKey} from './wage-registry-renewal-methods.mjs';
// verify.mjs imports this module (its hold view projects v2 rows too), so nothing from it is read at load time.
import {blob,validateWageReceiptResults} from './wage-registry-renewal-verify.mjs';

export const WAGE_RENEWAL_V2_KIND='wage-registry-current-source-pg16-http-renewal-v2';
export const WAGE_RENEWAL_V2_SCHEMA='payrollph-wage-source-pg16-renewal-v2';
export const WAGE_RENEWAL_V2_RECEIPT='scripts/qa/wage-registry-renewal-receipt-v2.json';
// Set only after inspecting real exact-source successful jobs and their output.
export const WAGE_RENEWAL_V2_RECEIPT_BLOB='PENDING_REAL_PG16_HTTP';
// Ledger bookkeeping only: never an executed runtime, HTTP assertion or fixture input.
// The first 18 entries equal verify.mjs ACCOUNTING_ONLY (asserted by tests/wage-registry-renewal-v2.test.mjs).
export const V2_ACCOUNTING_ONLY=Object.freeze([
 'scripts/qa/wage-registry-renewal-plan.mjs','scripts/qa/wage-registry-renewal-workflow.mjs','scripts/qa/wage-registry-renewal-methods.mjs',
 'scripts/qa/wage-registry-renewal-results.mjs','scripts/qa/wage-registry-renewal-complete.mjs','scripts/qa/wage-registry-renewal-capture.mjs',
 'scripts/qa/wage-registry-renewal-verify.mjs','scripts/qa/wage-registry-renewal-credit.mjs','scripts/qa/wage-registry-credit-holds.mjs',
 'scripts/qa/wage-registry-source-hold.mjs','scripts/qa/wage-registry-transitive-source-hold.mjs','scripts/qa/wage-registry-sealed-receipt-source-hold.mjs',
 'scripts/qa/payroll-run-oracle-hold.mjs','scripts/qa/tenant-staffing-policy-get-credit.mjs','scripts/qa/tenant-worker360-legal-employer-credit.mjs',
 'scripts/qa/tenant-year-end-credit.mjs','tests/helpers/tenant-counts.mjs','tests/helpers/wage-source-holds.mjs',
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
