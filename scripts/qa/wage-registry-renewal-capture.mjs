/** Sealable candidate from inspected native Actions job packets; grants ZERO credits. */
import assert from 'node:assert/strict';
import {readFileSync,readdirSync,existsSync,statSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {readWageRenewalInventory,INVENTORY_BLOB} from './wage-registry-renewal-plan.mjs';
import {methodKey,requiredWageFamilies} from './wage-registry-renewal-methods.mjs';
import {RECIPES} from './wage-registry-renewal-workflow.mjs';
import {collectRenewalInputs} from './payroll-run-renewal-inputs.mjs';
import {ACCOUNTING_ONLY,expectedWageJobs,qualifiedWageMethods,validateWageReceiptResults,WAGE_RENEWAL_RECEIPT,WAGE_RENEWAL_RECEIPT_BLOB} from './wage-registry-renewal-verify.mjs';
import {verifyWageFamilyResults} from './wage-registry-renewal-results.mjs';

export function renewalInputRoots(inventory,read=readFileSync){
 const roots=new Set(['.github/workflows/wage-registry-renewal.yml','src/proxy.ts','package.json','package-lock.json','tsconfig.json','next.config.ts','drizzle.config.ts',
  'scripts/qa/apply-isolated-baseline.mjs','scripts/qa/tenant-table-env.mjs','scripts/qa/prepare-hcm-work-item-fixture.mjs',
  'docs/sql/source-baseline-supplement.sql','drizzle/0109_tamper_evident_audit_chain.sql','drizzle/0104_hcm_work_item_sla.sql']);
 for(const [file]of Object.values(RECIPES))roots.add('.github/workflows/'+file);
 const receipts=new Set();
 for(const e of inventory.methods){roots.add(e.path);const p=e.held.reviewedUncertified.priorProof;if(p.file)roots.add(p.file);if(p.receiptFile)receipts.add(p.receiptFile);}
 function visit(value){
  if(Array.isArray(value)){for(const x of value)visit(x);return;}
  if(!value||typeof value!=='object')return;
  for(const [key,x]of Object.entries(value)){
   if(/^(src\/|scripts\/|tests\/|assets\/|fixtures\/|docs\/sql\/|drizzle\/|\.github\/workflows\/|package|next\.config|tsconfig|drizzle\.config)/.test(key)&&/^[a-f0-9]{40}$/.test(x)&&existsSync(key)&&statSync(key).isFile())roots.add(key);
   if(typeof x==='string'&&/^(src\/|scripts\/|tests\/|assets\/|fixtures\/|docs\/sql\/|drizzle\/|\.github\/workflows\/)/.test(x)&&existsSync(x)&&statSync(x).isFile())roots.add(x);
   else visit(x);
  }
 }
 for(const file of receipts){roots.add(file);visit(JSON.parse(read(file,'utf8')));}
 return [...roots].filter(x=>!ACCOUNTING_ONLY.includes(x)).sort();
}
function treeAt(head){
 const text=execFileSync('git',['ls-tree','-r',head],{encoding:'utf8',maxBuffer:32*1024*1024});
 return new Map(text.trimEnd().split('\n').map(line=>{const [meta,file]=line.split('\t');return [file,meta.split(' ')[2]];}));
}
export function captureRenewalCandidate(directory='outputs/wage-renewal-jobs'){
 const inventory=readWageRenewalInventory(),packets=readdirSync(directory).filter(x=>x.endsWith('.json')).map(x=>JSON.parse(readFileSync(directory+'/'+x)));
 const families={},heldFamilies={};
 for(const family of Object.keys(RECIPES)){
  const jobs=packets.filter(j=>j.jobKey.startsWith(family+'__'));
  const expected=expectedWageJobs(family);
  if(jobs.length!==expected.length){heldFamilies[family]='Missing completed jobs/matrix legs: '+jobs.length+'/'+expected.length;continue;}
  try{verifyWageFamilyResults(family,jobs);families[family]=jobs;}
  catch(error){heldFamilies[family]=error.message.split('\n')[0];}
 }
 const {methods,heldMethods}=qualifiedWageMethods(families,inventory);
 assert.ok(methods.length>0,'No complete source-current method proofs; no receipt or credit');
 const roots=renewalInputRoots(inventory),allPins=collectRenewalInputs(roots);
 const sourcePins=Object.fromEntries(Object.entries(allPins).filter(([file])=>!ACCOUNTING_ONLY.includes(file)));
 const heads=[...new Set(Object.values(families).flatMap(jobs=>jobs.map(j=>j.sourceHead)))];
 const trees=new Map(heads.map(head=>[head,treeAt(head)]));
 for(const head of heads)for(const [file,sha]of Object.entries(sourcePins))assert.equal(trees.get(head).get(file),sha,'Fresh executed checkout does not match runtime/HTTP input '+head+': '+file);
 const executedAccountingInputs=Object.fromEntries(heads.map(head=>[head,Object.fromEntries(ACCOUNTING_ONLY.map(file=>[file,trees.get(head).get(file)??null]))]));
 const receipt={schema:'payrollph-wage-source-pg16-renewal-v1',label:'SOLO_VERIFIED_DEV_RECOVERY',inventoryBlobSha:INVENTORY_BLOB,
  productionAccepted:false,independentlyAccepted:false,liveActivation:false,creditsAtExecution:0,
  methods,families,sourceRoots:roots,sourcePins,
  accountingScope:{excludedInputs:ACCOUNTING_ONLY,executedAccountingInputs,
   boundary:'Only ledger validation/generation is separated. Every runtime, HTTP assertion, fixture, package and executing workflow input remains pinned. Final accounting CI is still required; later metadata edits are not claimed as executed by these jobs.'}};
 validateWageReceiptResults(receipt);
 return {receipt,heldFamilies,heldMethods};
}
if(process.argv[1]?.replaceAll('\\','/').endsWith('/wage-registry-renewal-capture.mjs')&&(process.argv.includes('--write')||process.argv.includes('--check'))){
 const {receipt,heldFamilies,heldMethods}=captureRenewalCandidate();
 if(process.argv.includes('--write')){
  assert.equal(WAGE_RENEWAL_RECEIPT_BLOB,'PENDING_REAL_PG16_HTTP','Never overwrite a sealed execution receipt');
  writeFileSync(WAGE_RENEWAL_RECEIPT,JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});
 }
 console.log(JSON.stringify({eligibleMethods:receipt.methods.length,completedFamilies:Object.keys(receipt.families),heldFamilies,heldMethods,inputPins:Object.keys(receipt.sourcePins).length,creditsWritten:0}));
}
