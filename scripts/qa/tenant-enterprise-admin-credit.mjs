import assert from 'node:assert/strict';import {createHash} from 'node:crypto';import {readFileSync,writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import { assertHistoricalNextConfigPreservedWithInvitationHeaders } from "./tenant-invitation-header-source-compat.mjs";
export const ENTERPRISE_POST_PATH='src/app/api/enterprise/route.ts';
const RECEIPT='scripts/qa/tenant-enterprise-admin-credit-receipt.json';
const RECEIPT_DIGEST='769e27deb13047cd65cfe055f6bf2e8678f41866082d5bb94a931e62abf137b2';
const blob=value=>{const b=Buffer.from(value.toString().replaceAll('\r\n','\n'));return createHash('sha1').update('blob '+b.length+'\0').update(b).digest('hex');};
function evidence(read=readFileSync){const raw=read(RECEIPT,'utf8').toString().replaceAll('\r\n','\n');assert.equal(createHash('sha256').update(raw).digest('hex'),RECEIPT_DIGEST,'Executed enterprise receipt changed');const r=JSON.parse(raw);
 assert.equal(r.execution,'github-actions-http-pg16');assert.equal(r.result.label,'SOLO_VERIFIED_DEV_RECOVERY');assert.equal(r.result.result,'PASS');
 assert.deepEqual([r.result.attackers,r.result.ownTransitions,r.result.auditVetoRollbacks,r.result.foreignDenials,r.result.forgedDenials,r.result.readPairs,r.result.readDiscriminating,r.result.writeDiscriminating],[2,42,42,42,22,2,2,42]);
 assert.equal(r.result.coverageCredits,0);assert.equal(r.result.actualProviderTraffic,false);assert.equal(r.result.productionCertified,false);
 const renewal={"workflow":".github/workflows/tenant-enterprise-admin-http.yml","workflowRunId":42489689534,"workflowJobId":128759143344,"jobConclusion":"success","proofArtifactId":13621561030,"prBranchHeadSha":"5d5d93b7ebb925d01ec93d73727c89fb9a3ba631","executedSourceHead":"79bc9cd062e76af102c63fe0263a7b75ffad9e65","mergeParents":["0cc01240b6f4000df8a4ddd6e6d11fbe6bdbf890","5d5d93b7ebb925d01ec93d73727c89fb9a3ba631"],"independentSecurityReview":"PENDING","productionCertified":false};
 assert.deepEqual(r.renewal,renewal,'Exact executed PG16 workflow receipt provenance must remain sealed');
 assert.equal(r.result.sourceHead,renewal.executedSourceHead);
 assert.equal(r.result.routeBlobSha,r.pins[ENTERPRISE_POST_PATH]);
 assert.equal(r.result.proofBlobSha,r.pins[r.method.file]);
 assert.equal(r.result.stateBlobSha,r.pins['scripts/qa/tenant-enterprise-admin-state.mjs']);
 assert.equal(Object.keys(r.pins).length,199,'All original sealed 199 proof/runtime inputs remain mandatory');
 assert.equal(r.method.verifiedPrHeadSha,renewal.executedSourceHead);
 assert.equal(r.method.prBranchHeadSha,renewal.prBranchHeadSha);
 assert.equal(r.method.workflowRunId,renewal.workflowRunId);
 assert.equal(r.method.workflowJobId,renewal.workflowJobId);
 assert.equal(r.method.execution,'github-actions-http-pg16');
 assert.equal(r.method.evidence,'https://github.com/erwinmehehe/payrollph/actions/runs/42489689534/job/128759143344');
 assert.equal(r.method.runLabel,'GitHub Actions 42489689534/128759143344 PG16 enterprise-admin PASS');
 assert.equal(r.method.independentSecurityReview,'PENDING');
 assert.equal(r.method.productionTested,false);

 for(const [file,sha] of Object.entries(r.pins)){
   if(file==='next.config.ts') assertHistoricalNextConfigPreservedWithInvitationHeaders(read(file),sha);
   else assert.equal(blob(read(file)),sha,'Enterprise proof/runtime drift: '+file);
 }
 assert.equal(r.result.routeBlobSha,r.pins[ENTERPRISE_POST_PATH]);assert.equal(r.result.proofBlobSha,r.pins[r.method.file]);assert.equal(r.result.stateBlobSha,r.pins['scripts/qa/tenant-enterprise-admin-state.mjs']);
 for(const [field,fragment] of Object.entries({ownPositiveLine:'const response=await post(actor.cookie,payload)',foreignDenialLine:'organizationId:victim.org.id}),403',unchangedDbLine:"'final victim unchanged'",forgedSelectorLine:"404,'forged '",writeDiscriminationLine:"write validator accepts another employer",persistedStateLine:'assertEnterpriseMutation(before,after,payload,value,actor.owner.id)',victimIdOrderingLine:'victim.org.id>Math.max(a.org.id,b.org.id,6)'}))assert.ok(read(r.method.file,'utf8').split('\n')[r.method[field]-1]?.includes(fragment),'Lost enterprise proof anchor: '+field);
 return r;
}
export function verifyEnterprisePostCredit(manifest,read=readFileSync){const r=evidence(read),entry=manifest.allApiRouteFiles[ENTERPRISE_POST_PATH],method=entry?.methods.find(x=>x.name==='POST');
 assert.equal(entry.gitBlobSha,r.pins[ENTERPRISE_POST_PATH]);assert.equal(method.status,'COVERED');assert.equal(method.reviewedUncertified,undefined);assert.deepEqual(method.testedBy,r.method,'Enterprise credit may not borrow another receipt');
 assert.equal(method.testedBy.independentSecurityReview,'PENDING');assert.equal(method.testedBy.productionTested,false);
 return 1;
}
function reconcileClosure(doc,m){const cut=doc.indexOf('### Current 406-method frozen batch queue — 2026-10-29'),end=doc.indexOf('### Three narrowly promoted API methods',cut);assert.ok(cut>=0&&end>cut);
 const section=doc.split('### Batch DL-01 —')[1]?.split('## Page and server-action closure')[0];assert.ok(section);const counts=new Map(),total={COVERED:0,GAP:0,'PUBLIC-BY-DESIGN':0};
 for(const block of ('### Batch DL-01 —'+section).split('### Batch ').slice(1)){const id=block.split(' ')[0],c={COVERED:0,GAP:0,'PUBLIC-BY-DESIGN':0};for(const line of block.split('\n').filter(l=>l.startsWith('- `')&&l.includes(' — [source](../../src/app/api/'))){const verb=line.split('`')[1].split(' ')[0],p=line.split(' — [source](../../')[1].split('#L')[0],status=m.allApiRouteFiles[p].methods.find(x=>x.name===verb).status;c[status]++;total[status]++;}counts.set(id,c);}
 assert.equal(total.COVERED+total.GAP+total['PUBLIC-BY-DESIGN'],406);
 let table=doc.slice(cut,end).split('\n').map(line=>{if(!line.startsWith('| '))return line;for(const [id,c] of counts)if(line.includes('**'+id+'**')){const cells=line.split('|');cells[4]=' '+c.COVERED+' ';cells[5]=' '+c['PUBLIC-BY-DESIGN']+' ';cells[6]=' '+c.GAP+' ';cells[7]=c.GAP?' INCOMPLETE ':' PROVISIONAL — NOT ACCEPTED ';return cells.join('|');}return line;}).join('\n');
 table=table.replace(/(Frozen subtotal[^\n]*?\*\*)\d+ COVERED \+ \d+ PUBLIC-BY-DESIGN \+ \d+ GAP = 406/,`$1${total.COVERED} COVERED + ${total['PUBLIC-BY-DESIGN']} PUBLIC-BY-DESIGN + ${total.GAP} GAP = 406`);
 return doc.slice(0,cut)+table+doc.slice(end);
}
const direct=process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href;
if(direct&&!['--credit','--check'].includes(process.argv[2]))throw Error('Usage: --check | --credit --run-label <executed receipt label>');
if(direct&&process.argv[2]==='--check'){
 assert.deepEqual(process.argv.slice(2),['--check']);assert.equal(verifyEnterprisePostCredit(JSON.parse(readFileSync('scripts/qa/tenant-isolation-coverage-manifest.json','utf8'))),1);console.log(JSON.stringify({verified:1,write:false}));
}
if(direct&&process.argv[2]==='--credit'){
 const r=evidence();assert.deepEqual(process.argv.slice(2),['--credit','--run-label',r.method.runLabel]);
 const p='scripts/qa/tenant-isolation-coverage-manifest.json',m=JSON.parse(readFileSync(p,'utf8')),before={...m.metrics},target=m.allApiRouteFiles[ENTERPRISE_POST_PATH].methods.find(x=>x.name==='POST');assert.equal(target.status,'GAP','Never double credit enterprise POST');assert.equal(target.testedBy,null);
 target.status='COVERED';target.testedBy=r.method;delete target.reviewedUncertified;target.reason='Provisional full POST enterprise Owner method proof: twelve action names and all fifteen audited mutation paths, two fictional attacker employers, persisted own state, victim/forged denial, discriminator and audit-veto rollback. '+r.method.runLabel+'. SOLO_VERIFIED_DEV_RECOVERY; independent security review PENDING; no production certification.';
 const all=Object.values(m.allApiRouteFiles).flatMap(x=>x.methods);m.metrics.coveredAfter=all.filter(x=>x.status==='COVERED').length;m.metrics.gap=all.filter(x=>x.status==='GAP').length;assert.equal(m.metrics.coveredAfter,before.coveredAfter+1);assert.equal(m.metrics.gap,before.gap-1);m.acceptanceStatus=m.acceptanceStatus.replace(/^NOT ACCEPTED: \d+ API methods/,'NOT ACCEPTED: '+m.metrics.gap+' API methods');verifyEnterprisePostCredit(m);writeFileSync(p,JSON.stringify(m,null,2)+'\n');
 for(const file of ['docs/engineering/tenant-isolation-coverage-inventory.md','docs/engineering/tenant-isolation-closure-plan.md']){let doc=readFileSync(file,'utf8');doc=doc.replace('> **Combined current proposal','> **Prior combined proposal');doc=`> **Enterprise POST provisional credit — SOLO_VERIFIED_DEV_RECOVERY:** ${m.metrics.coveredAfter} COVERED / ${m.metrics.gap} GAP / ${m.metrics.publicByDesign} PUBLIC. One method, twelve action names; no production or global acceptance.\n\n`+doc;
  if(file.includes('closure-plan'))doc=reconcileClosure(doc,m);else doc=doc.replace(`| coveredAfter | ${before.coveredAfter} |`,`| coveredAfter | ${m.metrics.coveredAfter} |`).replace(`| gap | ${before.gap} |`,`| gap | ${m.metrics.gap} |`).replace(`**RELEASE BLOCKER:** ${before.gap} API methods`,`**RELEASE BLOCKER:** ${m.metrics.gap} API methods`).replace(`**NOT ACCEPTED**: ${before.gap} method gaps`,`**NOT ACCEPTED**: ${m.metrics.gap} method gaps`);
  writeFileSync(file,doc);
 }
 console.log(JSON.stringify({credited:1,before:{covered:before.coveredAfter,gap:before.gap},after:{covered:m.metrics.coveredAfter,gap:m.metrics.gap},label:'SOLO_VERIFIED_DEV_RECOVERY'}));
}
