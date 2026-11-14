/** Exact one-method public relabel, requiring both explicit owner approval and real execution. */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {verifyFreshSamlExecution,FRESH_SAML_EVIDENCE} from './tenant-saml-metadata-fresh-execution-verify.mjs';
import {SAML_PUBLIC_PATH,expectedSamlPublicMethod,historicalSamlMetadataView} from './tenant-saml-metadata-public-policy.mjs';
import {verifySamlPublicClassification} from './tenant-saml-metadata-public-classification-verify.mjs';
export {verifySamlPublicClassification,samlPublicClassificationDelta} from './tenant-saml-metadata-public-classification-verify.mjs';
const MANIFEST='scripts/qa/tenant-isolation-coverage-manifest.json';
const INVENTORY='docs/engineering/tenant-isolation-coverage-inventory.md';
const PLAN='docs/engineering/tenant-isolation-closure-plan.md';
async function reconcileDocs(write){
 const {reconcilePayrollRenewal}=await import('./payroll-run-credit-renewal.mjs');
 const {reconcileStudioPostCredit}=await import('./tenant-studio-post-credit.mjs');
 reconcilePayrollRenewal({write});reconcileStudioPostCredit({write});
 if(write)execFileSync(process.execPath,['scripts/qa/tenant-mkt01-marketing-credit.mjs','--write'],{stdio:'pipe'});
 else{const {verifyMkt01Credit}=await import('./tenant-mkt01-marketing-credit.mjs');verifyMkt01Credit();}
}
export async function classifySamlMetadata({write=false}={}){
 const m=JSON.parse(readFileSync(MANIFEST)),before=structuredClone(m.metrics),row=m.allApiRouteFiles[SAML_PUBLIC_PATH].methods[0];
 let changed=false;
 if(row.status==='GAP'){
  assert.ok(write,'Run the approved classification writer');verifyFreshSamlExecution();historicalSamlMetadataView(m);
  const old=structuredClone(m.allApiRouteFiles);
  m.allApiRouteFiles[SAML_PUBLIC_PATH].methods=[expectedSamlPublicMethod()];
  for(const[path,entry]of Object.entries(old))if(path!==SAML_PUBLIC_PATH)assert.deepEqual(m.allApiRouteFiles[path],entry);
  const rows=Object.values(m.allApiRouteFiles).flatMap(e=>e.methods);
  m.metrics.coveredAfter=rows.filter(r=>r.status==='COVERED').length;
  m.metrics.publicByDesign=rows.filter(r=>r.status==='PUBLIC-BY-DESIGN').length;
  m.metrics.gap=rows.filter(r=>r.status==='GAP').length;
  assert.equal(m.metrics.coveredAfter,before.coveredAfter);assert.equal(m.metrics.publicByDesign,before.publicByDesign+1);
  assert.equal(m.metrics.gap,before.gap-1);
  m.acceptanceStatus=m.acceptanceStatus.replace(/^NOT ACCEPTED: \d+ API methods/,'NOT ACCEPTED: '+m.metrics.gap+' API methods')+
   ' Owner-approved SAML metadata public XML classification (#1981): one GAP relabelled PUBLIC-BY-DESIGN after real PG16 HTTP proof, zero new COVERED credits. Anonymous OIDC resolve remains GAP; no SAML login or production activation.';
  verifySamlPublicClassification(m);writeFileSync(MANIFEST,JSON.stringify(m,null,2)+'\n');changed=true;
 }
 assert.equal(verifySamlPublicClassification(m),1);
 if(write){
  let inventory=readFileSync(INVENTORY,'utf8');const lines=inventory.split('\n');
  const at=lines.findIndex(l=>l.startsWith('| [`auth/saml/metadata/[providerId]` GET]'));assert.ok(at>=0);
  lines[at]=lines[at].replace('| NO VALID METHOD PROOF | **GAP** |','| [owner-approved public XML + PG16]('+FRESH_SAML_EVIDENCE+') | **PUBLIC-BY-DESIGN** |');
  assert.ok(lines[at].includes('**PUBLIC-BY-DESIGN**'));inventory=lines.join('\n');writeFileSync(INVENTORY,inventory);
  for(const file of [INVENTORY,PLAN]){
   const text=readFileSync(file,'utf8'),lines=text.split('\n');assert.ok(lines[0].startsWith('> **SSO DEFAULT-OFF'));
   lines[0]=lines[0].replace(/\*\*498 methods = \d+ COVERED \/ \d+ PUBLIC-BY-DESIGN \/ 12 TOKEN-ONLY \/ \d+ GAP\*\*/,
    '**498 methods = '+m.metrics.coveredAfter+' COVERED / '+m.metrics.publicByDesign+' PUBLIC-BY-DESIGN / 12 TOKEN-ONLY / '+m.metrics.gap+' GAP**');
   writeFileSync(file,lines.join('\n'));
  }
 }
 await reconcileDocs(write);
 if(write){
  for(const file of [INVENTORY,PLAN]){
   const text=readFileSync(file,'utf8').replace(/^\| publicByDesign \| \d+ \|$/m,'| publicByDesign | '+m.metrics.publicByDesign+' |');
   writeFileSync(file,text);
  }
 }
 const inventory=readFileSync(INVENTORY,'utf8');
 assert.ok(inventory.split('\n').some(l=>l.startsWith('| [`auth/saml/metadata/[providerId]` GET]')&&l.includes('**PUBLIC-BY-DESIGN**')));
 assert.ok(inventory.split('\n').includes('| publicByDesign | '+m.metrics.publicByDesign+' |'),'Live public-label count must match the classified ledger');
 return{write,relabelled:changed?1:0,newCoveredCredits:0,before,after:m.metrics,resolveHeld:true};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 assert.ok(['--write','--check'].includes(process.argv[2]));
 classifySamlMetadata({write:process.argv[2]==='--write'}).then(r=>console.log(JSON.stringify(r))).catch(e=>{console.error(e);process.exitCode=1;});
}
