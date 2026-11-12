/** One source-sealed merged-proof credit; never awards credit for a status-only or rejected-only receipt. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {assertAcceptedReceipt} from './tenant-filing-patch-method-contract.mjs';
import {assertReviewedReadinessHeaderOnInvitationConfig} from './tenant-invitation-header-source-compat.mjs';
export const FILING_PATH='src/app/api/compliance/filing-validations/[id]/route.ts';
const MANIFEST='scripts/qa/tenant-isolation-coverage-manifest.json';
const INVENTORY='docs/engineering/tenant-isolation-coverage-inventory.md';
const PLAN='docs/engineering/tenant-isolation-closure-plan.md';
export const RECEIPT_FILE='scripts/qa/tenant-filing-patch-credit-receipt.json';
const FILING_BANNER_PREFIX='> **SOLO_VERIFIED_DEV_RECOVERY — filing PATCH proposal, NOT production acceptance:** ';
export function withFilingStatusBanner(text,metrics,pageGaps){
 // Replace only this writer's leading checkpoint(s); retain other proof history.
 // A wording/count update must not prepend another copy on each reconciliation.
 let rest=text;
 while(rest.startsWith(FILING_BANNER_PREFIX)){
  const end=rest.indexOf('\n');rest=end<0?'':rest.slice(end+1).replace(/^\n+/,'');
 }
 return FILING_BANNER_PREFIX+metrics.methods+' methods = '+metrics.coveredAfter+' COVERED + '+metrics.publicByDesign+' PUBLIC-BY-DESIGN + '+metrics.privilegedOperationsTokenOnly+' PRIVILEGED-OPERATIONS-TOKEN-ONLY + '+metrics.gap+' GAP. [Fresh main three-leg receipt](../../scripts/qa/tenant-filing-patch-credit-receipt.json). Both the filing PATCH and the separately merged BIR candidate POST have distinct provisional evidence; '+pageGaps+' page/action gaps remain. Independent security/tax review and production acceptance are pending.\n\n'+rest;
}
const RECEIPT_BLOB='419d98c290b205a1722d2356fa279f4b7b78a45b';
const blob=b=>{const bytes=Buffer.from(b);return createHash('sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex');};
export function filingEvidence(read=readFileSync){
 const bytes=read(RECEIPT_FILE);assert.equal(blob(bytes),RECEIPT_BLOB,'Unreviewed or fabricated filing execution receipt');
 const r=JSON.parse(bytes);assert.equal(r.label,'SOLO_VERIFIED_DEV_RECOVERY');assert.equal(r.workflowRunId,42728601391);assert.equal(r.sourceHead,'75becb095ee209c88145c237a53afcb5b1e570e3');
 assert.deepEqual(r.jobs,{accepted:129540561266,rejected:129540561557,guards:129540561580,allLegs:129545232437});
 assertAcceptedReceipt(r.accepted);assert.equal(r.guards.boundedDenials,20);assert.equal(r.guards.noDeniedSqlOrAuditMutations,true);
 for(const leg of [r.acceptedLeg,r.rejectedLeg]){assert.equal(leg.realHttpPostgres16,true);assert.equal(leg.actualOwnWrites,2);assert.equal(leg.actualVictimDenied,true);assert.equal(leg.auditVetoRollback,true);assert.equal(leg.protectedOtherEmployersUnchanged,true);}
 for(const [path,sha]of Object.entries(r.inputBlobs)){
  // Only this manifest-status guard changes during promotion: its twelve
  // runtime/proof pins and every HTTP oracle remain intact. Seal its reviewed
  // replacement rather than rewriting the historical execution receipt.
  const guardPins={'tests/tenant-filing-patch-method-contract.test.mjs':'b67012c6a029083473b00edb5c7bf2679c6201c7','tests/tenant-filing-outcome-contract.test.mjs':'c9d101e7c9ac5aeb1a46b38f61bb335d2dd89ea3'};
  const current=guardPins[path]??sha;
  if(path==='next.config.ts') assertReviewedReadinessHeaderOnInvitationConfig(read(path),current);
  else assert.equal(blob(read(path)),current,'Fresh PG16 reproof required after input drift: '+path);
 }
 return r;
}
export function expectedFilingReceipt(read=readFileSync){const r=filingEvidence(read);return {
 file:'scripts/qa/tenant-compliance-accepted-http.mjs',line:218,ownPositiveLine:218,foreignDenialLine:180,forgedSelectorLine:180,unchangedDbLine:259,
 rejectedFile:'scripts/qa/tenant-filing-outcome-http.mjs',rejectedOwnLine:167,rejectedUnchangedLine:193,
 proofBlobSha:r.inputBlobs['scripts/qa/tenant-compliance-accepted-http.mjs'],routeBlobSha:r.inputBlobs[FILING_PATH],
 workflowFile:'.github/workflows/tenant-filing-patch-method-qa.yml',workflowBlobSha:r.inputBlobs['.github/workflows/tenant-filing-patch-method-qa.yml'],
 receiptFile:RECEIPT_FILE,receiptBlobSha:RECEIPT_BLOB,sourceHead:r.sourceHead,workflowRunId:r.workflowRunId,workflowJobs:r.jobs,
 evidence:'https://github.com/erwinmehehe/payrollph/actions/runs/42728601391',proofPullRequest:1885,
 evidenceLabel:'SOLO_VERIFIED_DEV_RECOVERY',postgresMajor:16,methodActions:['accepted:manual_entry','accepted:file_upload','rejected','RBAC/MFA/revocation guards'],
 providerCalled:false,agencyCalled:false,independentlyAccepted:false,productionCertified:false,
 scope:'Source-matched production HTTP / disposable PG16 on current main: two fictional employers, populated victim IDs >6, two accepted and two rejected persisted outcomes, 34 input/tenant denials, 20 authenticated role/MFA denials, four actual audit-veto rollbacks and unchanged protected foreign SQL. Multi-entity and money/provider release flags OFF. Synthetic agency references are not official acknowledgements; not production acceptance.'
 };}
export function verifyFilingPatchCredit(manifest,read=readFileSync){
 const route=manifest.allApiRouteFiles[FILING_PATH],method=route?.methods.find(m=>m.name==='PATCH'),expected=expectedFilingReceipt(read);
 assert.equal(route.gitBlobSha,expected.routeBlobSha);assert.equal(method?.status,'COVERED');assert.equal(method.reviewedUncertified,undefined);
 assert.deepEqual(method.testedBy,expected,'Only the complete, source-sealed three-leg receipt may replace the historical rejected-only hold');
 for(const [file,line,fragment]of [[expected.file,218,'response.status, 200'],[expected.file,180,'forged victim employer selection'],[expected.file,259,'snapshot(victim.org.id)'],[expected.rejectedFile,167,'assertOwnFilingRejection'],[expected.rejectedFile,193,'snapshot(victim.org.id)']])assert.ok(read(file).toString().split('\n')[line-1]?.includes(fragment),'Changed filing proof anchor: '+file+':'+line);
 return 1;
}
export function reconcileFilingCredit({write=false}={}){
 const m=JSON.parse(readFileSync(MANIFEST,'utf8')),before={covered:m.metrics.coveredAfter,gap:m.metrics.gap};
 const row=m.allApiRouteFiles[FILING_PATH].methods.find(x=>x.name==='PATCH');
 if(row.status==='GAP'){assert.equal(row.testedBy,null);row.status='COVERED';delete row.reviewedUncertified;row.testedBy=expectedFilingReceipt();row.reason='SOLO_VERIFIED_DEV_RECOVERY: all three fresh main PG16 HTTP filing PATCH legs passed (accepted, rejected, role/MFA controls); exact-source receipt and pins, no provider/agency or production acceptance.';}
 verifyFilingPatchCredit(m);
 const methods=Object.values(m.allApiRouteFiles).flatMap(r=>r.methods);
 for(const [field,status]of [['coveredAfter','COVERED'],['gap','GAP'],['publicByDesign','PUBLIC-BY-DESIGN'],['privilegedOperationsTokenOnly','PRIVILEGED-OPERATIONS-TOKEN-ONLY']])m.metrics[field]=methods.filter(x=>x.status===status).length;
 m.acceptanceStatus=m.acceptanceStatus.replace(/^NOT ACCEPTED: \d+ API methods/,'NOT ACCEPTED: '+m.metrics.gap+' API methods');
 const note='SOLO_VERIFIED_DEV_RECOVERY filing PATCH credit: '+m.metrics.coveredAfter+' COVERED / '+m.metrics.gap+' GAP; source-sealed three-leg PG16 proof, no production acceptance.';
 if(!m.acceptanceStatus.includes(note))m.acceptanceStatus+=' '+note;
 let overview=readFileSync(INVENTORY,'utf8');const pageGaps=m.scopedPages.filter(p=>p.status==='GAP').length;
 overview=overview.replace(/\*\*RELEASE BLOCKER:\*\* \d+ API methods and \d+ business-ID page entries/,'**RELEASE BLOCKER:** '+m.metrics.gap+' API methods and '+pageGaps+' business-ID page entries').replace(/\*\*NOT ACCEPTED\*\*: \d+ method gaps and \d+ page\/action gaps/,'**NOT ACCEPTED**: '+m.metrics.gap+' method gaps and '+pageGaps+' page/action gaps');
 for(const key of ['coveredAfter','gap'])overview=overview.replace(new RegExp('^\\| '+key+' \\| \\d+ \\|$','m'),'| '+key+' | '+m.metrics[key]+' |');
 const lines=overview.split('\n'),i=lines.findIndex(x=>x.startsWith('| [`compliance/filing-validations/[id]` PATCH]('));assert.ok(i>=0);
 const cells=lines[i].split(' | ');cells[cells.length-2]='[filing PATCH complete-method PG16 receipt](../../scripts/qa/tenant-filing-patch-credit-receipt.json) — accepted + rejected + guards';cells[cells.length-1]='**COVERED** |';lines[i]=cells.join(' | ');overview=lines.join('\n');
 overview=withFilingStatusBanner(overview,m.metrics,pageGaps);
 let plan=withFilingStatusBanner(readFileSync(PLAN,'utf8'),m.metrics,pageGaps);
 // Derive the live frozen-batch table from its immutable method/source links.
 const frozen=plan.split('### Batch DL-01 —')[1]?.split('## Page and server-action closure')[0];assert.ok(frozen);
 const total={COVERED:0,'PUBLIC-BY-DESIGN':0,'PRIVILEGED-OPERATIONS-TOKEN-ONLY':0,GAP:0};
 for(const section of ('### Batch DL-01 —'+frozen).split('### Batch ').slice(1)){
  const id=section.split(' ')[0],counts={COVERED:0,'PUBLIC-BY-DESIGN':0,'PRIVILEGED-OPERATIONS-TOKEN-ONLY':0,GAP:0};
  for(const line of section.split('\n').filter(x=>x.startsWith('- `')&&x.includes(' — [source](../../src/app/api/'))){const [verb]=line.split('`')[1].split(' '),path=line.split(' — [source](../../')[1].split('#L')[0],status=m.allApiRouteFiles[path].methods.find(x=>x.name===verb).status;counts[status]++;total[status]++;}
  plan=plan.split('\n').map(line=>{const cells=line.split('|');if(cells.length!==10||cells[2].trim()!=='**'+id+'**')return line;cells[4]=' '+counts.COVERED+' ';cells[5]=' '+counts['PUBLIC-BY-DESIGN']+' ';cells[6]=' '+counts['PRIVILEGED-OPERATIONS-TOKEN-ONLY']+' ';cells[7]=' '+counts.GAP+' ';return cells.join('|');}).join('\n');
 }
 plan=plan.replace(/^Frozen subtotal[^\n]+/m,line=>line.replace(/\*\*\d+ COVERED \+ \d+ PUBLIC-BY-DESIGN \+ \d+ PRIVILEGED-OPERATIONS-TOKEN-ONLY \+ \d+ GAP = 406\*\*/,'**'+total.COVERED+' COVERED + '+total['PUBLIC-BY-DESIGN']+' PUBLIC-BY-DESIGN + '+total['PRIVILEGED-OPERATIONS-TOKEN-ONLY']+' PRIVILEGED-OPERATIONS-TOKEN-ONLY + '+total.GAP+' GAP = 406**'));
 if(write){writeFileSync(MANIFEST,JSON.stringify(m,null,2)+'\n');writeFileSync(INVENTORY,overview);writeFileSync(PLAN,plan);}
 else {assert.equal(row.status,'COVERED');assert.deepEqual(JSON.parse(readFileSync(MANIFEST,'utf8')),m,'Run this reviewed credit writer with --write first');assert.equal(readFileSync(INVENTORY,'utf8'),overview,'Inventory must be generated from the same credit');assert.equal(readFileSync(PLAN,'utf8'),plan,'Frozen queue must reconcile with the credited method');}
 return {methodsCredited:before.gap-m.metrics.gap,before,after:{covered:m.metrics.coveredAfter,gap:m.metrics.gap},write};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const args=process.argv.slice(2);assert.ok(args.length===1&&['--write','--check'].includes(args[0]));
 execFileSync('git',['merge-base','--is-ancestor','75becb095ee209c88145c237a53afcb5b1e570e3','HEAD']);
 console.log(JSON.stringify(reconcileFilingCredit({write:args[0]==='--write'})));
}
