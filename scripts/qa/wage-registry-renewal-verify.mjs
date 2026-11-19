/** Current-source renewal only. Historical receipts never become fresh execution. */
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {readWageRenewalInventory,INVENTORY_BLOB} from './wage-registry-renewal-plan.mjs';
import {requiredWageFamilies,methodKey} from './wage-registry-renewal-methods.mjs';
import {verifyWageFamilyResults} from './wage-registry-renewal-results.mjs';
import {verifyCompleteWageMethod} from './wage-registry-renewal-complete.mjs';

export const WAGE_RENEWAL_KIND='wage-registry-current-source-pg16-http-renewal';
export const WAGE_RENEWAL_RECEIPT='scripts/qa/wage-registry-renewal-receipt.json';
// Set only after inspecting real exact-source successful jobs and their output.
export const WAGE_RENEWAL_RECEIPT_BLOB='8af7a0d35cb85b2d616babdc0a56fc62fcad9856';
export const blob=raw=>{const b=Buffer.from(raw);return createHash('sha1').update('blob '+b.length+'\0').update(b).digest('hex');};
export function isExactHistoricalLoaderChange(file,sha,raw){
 if(file==='scripts/qa/tenant-five-scoped-page-credit.mjs'){
  const archive=readFileSync('scripts/qa/document-source-accounting-archive.json');
  assert.equal(blob(archive),'b3ccc93613bce6b9ee6ec3dd32b074f7a7befa13');
  const original=JSON.parse(archive).fiveSource;
  assert.equal(blob(original),sha,'Original five-page receipt source must remain immutable');
  assert.equal(blob(readFileSync('scripts/qa/document-source-accounting.mjs')),'65b3c83112a82744e92649ed25539fc73ad8d789');
  const expected=original
   .replace('import assert from "node:assert/strict";','import assert from "node:assert/strict";\nimport {reviewedDocumentSourceHoldCount} from "./document-source-accounting.mjs";')
   .replace('const expectedApiGaps = marketing?.status === "COVERED" ? 4 : 5;','const expectedApiGaps = (marketing?.status === "COVERED" ? 4 : 5) + reviewedDocumentSourceHoldCount(m, read);')
   .replace('if (expectedApiGaps === 4) assert.equal(assertMkt01Receipt(m), 1,','if (marketing?.status === "COVERED") assert.equal(assertMkt01Receipt(m), 1,');
  return Buffer.from(raw).toString('utf8').replaceAll('\r\n','\n')===expected;
 }
 if(file==='scripts/qa/tenant-four-scoped-page-credit.mjs'){
  const archive=readFileSync('scripts/qa/wage-registry-renewal-sso-source.json');
  assert.equal(blob(archive),'3988d1c5f79dbbfb1c01253be90e4676fa4d7512');
  const original=JSON.parse(archive).source;assert.equal(blob(original),sha);
  const start=original.indexOf('    const expected = structuredClone(head);',original.indexOf('FOUR_PAGE_REFUSED: only the exact committed'));
  const end=original.indexOf('    assert.equal(held, 19,',start);
  assert.ok(start>0&&end>start);
  const expected="import {zeroCreditSsoProofFixture} from './payroll-run-sso-proof-fixture.mjs';\n"+original.slice(0,start)+
   '    const expected = zeroCreditSsoProofFixture(head);\n    const held = head.metrics.coveredAfter - expected.metrics.coveredAfter;\n'+original.slice(end);
  return Buffer.from(raw).toString('utf8').replaceAll('\r\n','\n')===expected+'\n';
 }
 if(!['tests/tenant-filing-outcome-contract.test.mjs','tests/tenant-filing-patch-method-contract.test.mjs'].includes(file))return false;
 // These two unit tests are included by the historical workflow collector.
 // Permit ONLY a verified historical manifest loader; every assertion and
 // every HTTP/runtime proof byte must remain unchanged. Never rewrite receipt pins.
 const archive=readFileSync('scripts/qa/wage-registry-renewal-unit-loaders.json');
 assert.equal(blob(archive),'d3d675220aed7dcda9f6afb5f8ecc2d7f16ee784','Executed unit-test source archive changed');
 const original=Buffer.from(JSON.parse(archive)[file]);assert.equal(blob(original),sha);
 const text=original.toString('utf8').replaceAll('\r\n','\n');
 const changed=text.replace(/JSON\.parse\(readFileSync\(\s*(['"])scripts\/qa\/tenant-isolation-coverage-manifest\.json\1\s*(?:,\s*(['"])utf8\2)?\s*\)\)/g,'readWageWithdrawalFixture()');
 if(changed===text)return false;
 return Buffer.from(raw).toString('utf8').replaceAll('\r\n','\n')==="import {readWageWithdrawalFixture} from './helpers/wage-renewal-fixture.mjs';\n"+changed;
}
export const ACCOUNTING_ONLY=Object.freeze([
 'scripts/qa/wage-registry-renewal-plan.mjs',
 'scripts/qa/wage-registry-renewal-workflow.mjs',
 'scripts/qa/wage-registry-renewal-methods.mjs',
 'scripts/qa/wage-registry-renewal-results.mjs',
 'scripts/qa/wage-registry-renewal-complete.mjs',
 'scripts/qa/wage-registry-renewal-capture.mjs',
 'scripts/qa/wage-registry-renewal-verify.mjs',
 'scripts/qa/wage-registry-renewal-credit.mjs',
 'scripts/qa/wage-registry-credit-holds.mjs',
 'scripts/qa/wage-registry-source-hold.mjs',
 'scripts/qa/wage-registry-transitive-source-hold.mjs',
 'scripts/qa/wage-registry-sealed-receipt-source-hold.mjs',
 'scripts/qa/payroll-run-oracle-hold.mjs',
 'scripts/qa/tenant-staffing-policy-get-credit.mjs',
 'scripts/qa/tenant-worker360-legal-employer-credit.mjs',
 'scripts/qa/tenant-year-end-credit.mjs',
 'tests/helpers/tenant-counts.mjs',
 'tests/helpers/wage-source-holds.mjs',
]);
const rowAt=(m,e)=>m.allApiRouteFiles[e.path]?.methods.find(x=>x.name===e.verb);
export function expectedWageJobs(family){
 // Source-only ledger jobs intentionally have no npm install. Use the sealed
 // reviewed expansion, and test parity against the full YAML generator.
 // Actual executing and original workflow bytes remain receipt-source pinned.
 const raw=readFileSync('scripts/qa/wage-registry-renewal-jobs.json');
 assert.equal(blob(raw),'734d3496f426d85fe22ab6d5c6298f68bfedd2b1','Reviewed job/matrix catalog changed');
 return JSON.parse(raw)[family]||[];
}
const stable=value=>Array.isArray(value)?value.map(stable):value&&typeof value==='object'
 ?Object.fromEntries(Object.keys(value).sort().map(k=>[k,stable(value[k])])):value;
const identity=j=>JSON.stringify(stable({jobKey:j.jobKey,variant:j.variant}));

export function qualifiedWageMethods(families,inventory=readWageRenewalInventory()){
 const methods=[],heldMethods={};
 for(const entry of inventory.methods){
  const key=methodKey(entry),missing=requiredWageFamilies(entry).filter(f=>!Object.hasOwn(families,f));
  if(missing.length){heldMethods[key]='Missing complete proof families: '+missing.join(', ');continue;}
  try{verifyCompleteWageMethod(entry,families);methods.push(key);}
  catch(error){heldMethods[key]=error.message.split('\n')[0];}
 }
 return {methods:methods.sort(),heldMethods};
}

/** Validates raw results; source/receipt seals are separately mandatory. */
export function validateWageReceiptResults(receipt){
 assert.equal(receipt.schema,'payrollph-wage-source-pg16-renewal-v1');
 assert.equal(receipt.label,'SOLO_VERIFIED_DEV_RECOVERY');
 assert.equal(receipt.inventoryBlobSha,INVENTORY_BLOB);
 for(const key of ['productionAccepted','independentlyAccepted','liveActivation'])assert.equal(receipt[key],false);
 assert.equal(receipt.creditsAtExecution,0);
 assert.ok(receipt.families&&Object.keys(receipt.families).length>0,'No completed proof families');
 const jobIds=new Set();
 for(const [family,jobs]of Object.entries(receipt.families)){
  const expected=expectedWageJobs(family);assert.ok(expected.length>0,'Unreviewed proof family');
  assert.deepEqual(jobs.map(identity).sort(),expected.map(identity).sort(),'Every original job and matrix leg must finish: '+family);
  for(const j of jobs){
   const metadataOnly=j.jobKey==='security__change-scope'||j.jobKey==='filing__filing-method-all-legs';
   assert.equal(j.metadataOnly,metadataOnly,'An application proof cannot be relabelled a metadata job');
   assert.equal(j.conclusion,'success');assert.equal(j.postgresMajor,metadataOnly?null:16);assert.equal(j.transport,metadataOnly?'source-metadata-only':'real-http');
   assert.match(j.sourceHead,/^[a-f0-9]{40}$/);assert.ok(Number.isSafeInteger(j.runId)&&j.runId>0);assert.ok(Number.isSafeInteger(j.jobId)&&j.jobId>0);
   assert.ok(!jobIds.has(j.jobId),'One job cannot impersonate a different proof/profile');jobIds.add(j.jobId);
   assert.equal(j.evidence,'https://github.com/erwinmehehe/payrollph/actions/runs/'+j.runId+'/job/'+j.jobId);
   assert.ok(Array.isArray(j.steps)&&j.steps.length>0,'Native completed step evidence required');
   assert.equal(j.exactHeadCheckoutVerified,j.steps.some(s=>s.name==='Verify exact proposed renewal source'&&s.conclusion==='success'));
   if(!metadataOnly)assert.equal(j.exactHeadCheckoutVerified,true);
   assert.ok(j.steps.every(s=>s.conclusion==='success'||s.conclusion==='skipped'),'No failed or cancelled execution step');
   assert.ok(j.steps.some(s=>s.name==='Verify exact proposed renewal source'&&s.conclusion==='success')||j.metadataOnly,'Exact-head setup must actually pass');
  }
  verifyWageFamilyResults(family,jobs);
 }
 const {methods:eligible}=qualifiedWageMethods(receipt.families);
 assert.deepEqual(receipt.methods,eligible,'Credit eligibility is derived from complete method-specific cohorts');
 return new Set(eligible);
}

export function readWageRenewalReceipt(read=readFileSync){
 assert.match(WAGE_RENEWAL_RECEIPT_BLOB,/^[a-f0-9]{40}$/,'Fresh execution has not been sealed; no credit');
 const raw=read(WAGE_RENEWAL_RECEIPT);assert.equal(blob(raw),WAGE_RENEWAL_RECEIPT_BLOB,'Fresh receipt changed');
 const r=JSON.parse(raw);validateWageReceiptResults(r);
 assert.ok(Object.keys(r.sourcePins||{}).length>100,'Complete runtime/HTTP/workflow source closure required');
 assert.deepEqual(r.accountingScope.excludedInputs,ACCOUNTING_ONLY);
 for(const entry of readWageRenewalInventory().methods){
  assert.equal(r.sourcePins[entry.path],entry.routeBlobSha,'Every exact withdrawn handler must remain pinned');
  assert.equal(blob(read(entry.path)),entry.routeBlobSha,'Route source changed; rerun before credit');
  const proof=entry.held.reviewedUncertified.priorProof.file;
  if(proof)assert.ok(r.sourcePins[proof],'Original HTTP assertions cannot be omitted: '+proof);
 }
 assert.equal(r.sourcePins['src/lib/wage-orders.ts'],'0bb8c55d6cad0f3a22f6096f0937dd55ca0b227d');
 assert.equal(r.sourcePins['src/lib/statutory-rule-watch.ts'],'0032da010a8065d415415d50f0353a7a430e12fb');
 assert.ok(r.sourcePins['.github/workflows/wage-registry-renewal.yml'],'Actual executing workflow required');
 for(const [file,sha]of Object.entries(r.sourcePins)){
  assert.ok(!ACCOUNTING_ONLY.includes(file),'Bookkeeping cannot masquerade as executed runtime');
  const current=read(file);
  assert.ok(blob(current)===sha||isExactHistoricalLoaderChange(file,sha,current),'Executed runtime/HTTP/source drift: '+file);
 }
 return r;
}
export function wageRenewalProof(entry,receipt){
 const jobs=requiredWageFamilies(entry).flatMap(f=>receipt.families[f]);
 const old=entry.held.reviewedUncertified.priorProof;
 const anchors=Object.fromEntries(Object.entries(old).filter(([key,value])=>key==='file'||key==='line'||key.endsWith('Line')||['family','profile'].includes(key)||
  (key.endsWith('File')&&key!=='workflowFile'&&typeof value==='string'&&Object.hasOwn(receipt.sourcePins,value))));
 return {...anchors,kind:WAGE_RENEWAL_KIND,
  method:methodKey(entry),routeBlobSha:entry.routeBlobSha,receiptFile:WAGE_RENEWAL_RECEIPT,
  ...(old.file?{proofBlobSha:receipt.sourcePins[old.file]}:{}),
  renewalReceiptBlobSha:WAGE_RENEWAL_RECEIPT_BLOB,evidenceLabel:'SOLO_VERIFIED_DEV_RECOVERY',postgresMajor:16,
  renewedWorkflowJobs:jobs.map(j=>({runId:j.runId,jobId:j.jobId,sourceHead:j.sourceHead,evidence:j.evidence,role:j.metadataOnly?'orchestration':'real-http-pg16'})),
  scope:'Complete original method cohorts: '+requiredWageFamilies(entry).join(', ')+'. Actual isolated flag profiles are retained in the executing workflow; no real provider, payroll or production acceptance.',
  independentSecurityReview:'PENDING',independentlyAccepted:false,productionCertified:false,productionTested:false};
}
export function wageRenewalRow(entry,receipt){
 const result={...structuredClone(entry.held),status:'COVERED',testedBy:wageRenewalProof(entry,receipt),
  historicalWageSourceWithdrawal:structuredClone(entry.held.reviewedUncertified),
  reason:'SOLO_VERIFIED_DEV_RECOVERY: fresh complete-method fictional PG16/real-HTTP renewal on the current wage source; original withdrawal and old receipts retained as history. Independent/security/payroll and production acceptance remain PENDING.'};
 delete result.reviewedUncertified;return result;
}
/** Strict ledger projection for old withdrawal/history tests, never HTTP acceptance. */
export function wageRenewalHoldView(manifest,read=readFileSync){
 const candidates=Object.entries(manifest.allApiRouteFiles).flatMap(([path,file])=>file.methods
  .filter(row=>row.testedBy?.kind===WAGE_RENEWAL_KIND||row.historicalWageSourceWithdrawal)
  .map(row=>({path,row})));
 if(candidates.length===0)return manifest;
 const receipt=readWageRenewalReceipt(read),eligible=new Set(receipt.methods),inventory=readWageRenewalInventory(read);
 const view=structuredClone(manifest);
 for(const {path,row}of candidates){
  const entry=inventory.methods.find(e=>e.path===path&&e.verb===row.name);assert.ok(entry,'Unreviewed renewal method');
  assert.ok(eligible.has(methodKey(entry)),'Incomplete proof family cannot restore a method');
  assert.deepEqual(row,wageRenewalRow(entry,receipt),'Renewed method metadata/provenance changed');
  const file=view.allApiRouteFiles[path];file.methods[file.methods.findIndex(x=>x.name===row.name)]=structuredClone(entry.held);
 }
 view.metrics.coveredAfter-=candidates.length;view.metrics.gap+=candidates.length;
 view.acceptanceStatus=view.acceptanceStatus.replace(/^NOT ACCEPTED: \d+ API methods/,'NOT ACCEPTED: '+view.metrics.gap+' API methods');
 return view;
}
export function verifyWageRenewalMethod(manifest,path,verb,read=readFileSync){
 const row=rowAt(manifest,{path,verb});if(row?.testedBy?.kind!==WAGE_RENEWAL_KIND)return 0;
 wageRenewalHoldView(manifest,read);return 1;
}
export function hasWageRenewalReceipt(){return existsSync(WAGE_RENEWAL_RECEIPT)&&/^[a-f0-9]{40}$/.test(WAGE_RENEWAL_RECEIPT_BLOB);}
