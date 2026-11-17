/** One bounded promotion pass. No arbitrary run labels, method lists or metric edits. */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {readWageRenewalInventory} from './wage-registry-renewal-plan.mjs';
import {reconcilePlan} from './payroll-run-credit-renewal.mjs';
import {regeneratedOverview,regeneratedClosure} from './tenant-mkt01-marketing-credit.mjs';
import {blob,readWageRenewalReceipt,wageRenewalRow,wageRenewalHoldView,WAGE_RENEWAL_KIND} from './wage-registry-renewal-verify.mjs';
const MANIFEST='scripts/qa/tenant-isolation-coverage-manifest.json';
const DOCS=['docs/engineering/tenant-isolation-coverage-inventory.md','docs/engineering/tenant-isolation-closure-plan.md'];
export function reconcileWageRenewal({write=false}={}){
 const receipt=readWageRenewalReceipt(),inventory=readWageRenewalInventory();
 const input=JSON.parse(readFileSync(MANIFEST,'utf8')),manifest=structuredClone(input);
 const historical=wageRenewalHoldView(input),eligible=new Set(receipt.methods);
 const count=m=>Object.values(m.allApiRouteFiles).flatMap(x=>x.methods).reduce((a,r)=>(a[r.status]=(a[r.status]||0)+1,a),{});
 const before=count(input);let newlyCredited=0;
 for(const entry of inventory.methods){
  const key=entry.verb+' '+entry.path,route=manifest.allApiRouteFiles[entry.path];
  assert.equal(route.gitBlobSha,entry.routeBlobSha,'Never modify route identity to obtain a credit');
  const index=route.methods.findIndex(x=>x.name===entry.verb);
  assert.deepEqual(historical.allApiRouteFiles[entry.path].methods[index],entry.held,'Only the exact captured withdrawal may be reconciled');
  if(!eligible.has(key))continue;
  const row=wageRenewalRow(entry,receipt);
  if(route.methods[index].status==='GAP')newlyCredited++;
  else assert.equal(route.methods[index].testedBy?.kind,WAGE_RENEWAL_KIND,'Do not overwrite another proof owner');
  route.methods[index]=row;
 }
 const after=count(manifest);manifest.metrics.coveredAfter=after.COVERED||0;manifest.metrics.gap=after.GAP||0;
 assert.equal(manifest.metrics.methods,Object.values(after).reduce((a,n)=>a+n,0));
 manifest.acceptanceStatus=manifest.acceptanceStatus.replace(/^NOT ACCEPTED: \d+ API methods/,'NOT ACCEPTED: '+manifest.metrics.gap+' API methods');
 wageRenewalHoldView(manifest);
 const summary=manifest.metrics.methods+' API methods = **'+manifest.metrics.coveredAfter+' COVERED + '+manifest.metrics.publicByDesign+' PUBLIC-BY-DESIGN + '+manifest.metrics.privilegedOperationsTokenOnly+' PRIVILEGED-OPERATIONS-TOKEN-ONLY + '+manifest.metrics.gap+' GAP**';
 const banner='> **CURRENT / WAGE-SOURCE API RENEWAL — SOLO_VERIFIED_DEV_RECOVERY:** '+summary+'. '+receipt.methods.length+' exact-source method renewals; original withdrawals and receipts remain immutable history. Independent/security/payroll and production acceptance remain PENDING. No live release, provider or money activation.';
 const updates=DOCS.map(file=>{
  const old=readFileSync(file,'utf8').replace(/^> \*\*CURRENT MKT-01 OPERATOR-ONLY GET[^\n]*\n\n/,'');
  assert.match(old,/^> \*\*CURRENT \/ (?:PR #1989 WAGE-ORDER DEPENDENCY PROOF HOLD|WAGE-SOURCE API RENEWAL)/,'Unexpected current ledger banner');
  let text=old.replace(/^>[^\r\n]*/,banner);
  if(file.endsWith('closure-plan.md')){
   text=reconcilePlan(text,manifest);
   text=text.split('\n').map(line=>{
    if(!line.startsWith('- HELD `'))return line;
    const key=line.split('`')[1],at=key.indexOf(' '),verb=key.slice(0,at),path='src/app'+key.slice(at+1)+'/route.ts';
    if(manifest.allApiRouteFiles[path]?.methods.find(r=>r.name===verb)?.testedBy?.kind!==WAGE_RENEWAL_KIND)return line;
    return '- RENEWED `'+key+'` — [fresh source-sealed PG16 renewal](../../scripts/qa/wage-registry-renewal-receipt.json); independent acceptance PENDING';
   }).join('\n');
   const section=text.split('### Current 406-method frozen batch queue — 2026-10-29')[1]?.split('### Three narrowly promoted API methods')[0];
   const batches=section.split('\n').filter(l=>/^\| \d+ \| \*\*/.test(l)).map(l=>l.split('|').slice(1,-1).map(c=>c.trim()));
   const provisional=batches.filter(c=>Number(c[6])===0).map(c=>c[1].replaceAll('**',''));
   text=text.replace(/^(Frozen subtotal[^\n]+\*\*\.) \d+ batches remain INCOMPLETE;[^\n]+/m,'$1 '+(batches.length-provisional.length)+' batches remain INCOMPLETE; '+provisional.join(', ')+' remain PROVISIONAL — NOT ACCEPTED.');
  }
  else{
   for(const field of ['coveredAfter','gap'])text=text.replace(new RegExp('^\\| '+field+' \\| \\d+ \\|$','m'),'| '+field+' | '+manifest.metrics[field]+' |');
   const lines=text.split('\n'),rawAnchors=readFileSync('scripts/qa/wage-registry-renewal-doc-anchors.json');
   assert.equal(blob(rawAnchors),'c1c303bc5e02e7f9a3ce751f5fae0a548577d1ba','Historical documentation anchors changed');
   const original=JSON.parse(rawAnchors);
   for(const entry of inventory.methods){
    const route=entry.path.slice('src/app/api/'.length,-'/route.ts'.length);
    const index=lines.findIndex(line=>line.startsWith('| [`'+route+'` '+entry.verb+']'));
    assert.ok(index>=0,'Missing inventory row '+route);
    const row=manifest.allApiRouteFiles[entry.path].methods.find(r=>r.name===entry.verb),cells=lines[index].split(' | ');
    const oldAnchors=original[entry.verb+' '+entry.path];assert.equal(typeof oldAnchors,'string');
    cells[cells.length-2]=oldAnchors+' + [Fresh source-sealed PG16 renewal](../../scripts/qa/wage-registry-renewal-receipt.json)';
    cells[cells.length-1]='**'+row.status+'** |';lines[index]=cells.join(' | ');
   }
   text=lines.join('\n');
  }
  text=file.endsWith('closure-plan.md')?regeneratedClosure(text,manifest):regeneratedOverview(text,manifest);
  return [file,text];
 });
 const report=['# Fresh wage-source API credit renewals','',
  'SOLO_VERIFIED_DEV_RECOVERY. Before: 386 COVERED / 75 GAP. After: '+manifest.metrics.coveredAfter+' COVERED / '+manifest.metrics.gap+' GAP; '+manifest.metrics.methods+' methods total, including '+manifest.metrics.publicByDesign+' public and '+manifest.metrics.privilegedOperationsTokenOnly+' privileged-token methods.','',
  'Execution: [42 successful jobs, run 43982852756](https://github.com/erwinmehehe/payrollph/actions/runs/43982852756), exact source head `756934135ead375f9b9346844adf732764b407c5`. The later accounting commit is not represented as that execution head. Every runtime and HTTP proof input remains source-pinned; original withdrawals and receipts remain historical.','',
  'Existing synthetic CI profiles retain their actual flag settings and loopback providers. Local runs kept protected flags OFF. This is developer recovery evidence, not independent review or production/payroll/provider acceptance.','',
  '| Method | Result | Fresh executed evidence |','| --- | --- | --- |'];
 for(const entry of inventory.methods){
  const row=manifest.allApiRouteFiles[entry.path].methods.find(r=>r.name===entry.verb);
  const links=[...new Set(row.testedBy.renewedWorkflowJobs.filter(j=>j.role==='real-http-pg16').map(j=>j.evidence))];
  report.push('| `'+entry.verb+' /api/'+entry.path.slice('src/app/api/'.length,-'/route.ts'.length)+'` | CREDITED | '+links.map((url,i)=>'[PG16 '+(i+1)+']('+url+')').join(' + ')+' |');
 }
 updates.push(['docs/qa/wage-registry-75-method-renewal.md',report.join('\n')+'\n']);
 const text=JSON.stringify(manifest,null,2)+'\n';
 const changed=readFileSync(MANIFEST,'utf8')!==text||updates.some(([file,t])=>{try{return readFileSync(file,'utf8')!==t;}catch(error){if(error.code==='ENOENT')return true;throw error;}});
 if(write){writeFileSync(MANIFEST,text);for(const [file,t]of updates)writeFileSync(file,t);}
 return {before,after,newlyCredited,credited:receipt.methods.length,held:inventory.methods.length-receipt.methods.length,changed,wrote:write};
}
if(process.argv[1]?.replaceAll('\\','/').endsWith('/wage-registry-renewal-credit.mjs')){
 assert.ok(process.argv.includes('--write')||process.argv.includes('--check'),'Use --check or --write');
 const result=reconcileWageRenewal({write:process.argv.includes('--write')});console.log(JSON.stringify(result));
 if(process.argv.includes('--check')&&result.changed)process.exitCode=1;
}
