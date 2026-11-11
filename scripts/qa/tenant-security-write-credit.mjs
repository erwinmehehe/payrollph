/** Three complete method receipts, fictional PG16 only; never production acceptance. */
import {verifyNarrowStudioAutomationSource,HISTORIC_AUTOMATION_SHA} from './tenant-studio-automation-source-compat.mjs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {assertHistoricalNextConfigPreservedWithInvitationHeaders} from './tenant-invitation-header-source-compat.mjs';
export const SECURITY_RECEIPT='scripts/qa/tenant-security-write-receipt.json';
const SEALED_DIGEST='1631f96dca30437b852c7eb777b3d787fca5223fcc72800c68dcae0d1debe8b3';
const MANIFEST='scripts/qa/tenant-isolation-coverage-manifest.json';
export const SECURITY_TARGETS=Object.freeze(['documents','biometrics/sync','developer'].map(route=>({path:'src/app/api/'+route+'/route.ts',method:'POST'})));
const normalized=x=>x.toString().replaceAll('\r\n','\n');
const digest=x=>createHash('sha256').update(normalized(x)).digest('hex');
const blob=x=>{const b=Buffer.from(normalized(x));return createHash('sha1').update('blob '+b.length+'\0').update(b).digest('hex');};
export function readSecurityEvidence(read=readFileSync){
  const raw=read(SECURITY_RECEIPT,'utf8');assert.equal(digest(raw),SEALED_DIGEST,'Executed security receipt changed');
  const r=JSON.parse(raw);assert.equal(r.label,'SOLO_VERIFIED_DEV_RECOVERY');assert.equal(r.productionCertified,false);
  assert.equal(r.independentlyAccepted,false);assert.equal(r.execution,'local-production-http-pg16');
  assert.match(r.sourceHead,/^[a-f0-9]{40}$/);assert.deepEqual(r.targets.map(({path,method})=>({path,method})),SECURITY_TARGETS);
  assert.deepEqual(Object.keys(r.runs),['documents-legacy','documents-vault','biometrics','developer']);
  for(const run of Object.values(r.runs)){
    assert.equal(run.sourceHead,r.sourceHead);assert.equal(run.execution,r.execution);assert.equal(run.coverageCredits,0);
    assert.equal(run.productionCertified,false);assert.equal(run.label,r.label);
    for(const flag of Object.values(run.flags))assert.equal(flag,'false','Money/provider/history flags must remain OFF');
  }
  for(const [key,vault] of [['documents-legacy',false],['documents-vault',true]]){
    const run=r.runs[key],d=run.result;assert.equal(run.vaultProfile,vault);assert.equal(d.vaultProfile,vault);
    assert.equal(d.attackerEmployers,2);assert.equal(d.victimEmployers,1);assert.equal(d.ownPersistedUploads,6);
    assert.equal(d.ownerUploads,4);assert.equal(d.employeeUploads,2);assert.equal(d.tenantAndInputDenials,10);
    assert.equal(d.auditVetoRollbacks,2);assert.equal(d.documentDiscriminators,6);assert.equal(d.protectedFinalVetoes,vault?2:0);
  }
  const bio=r.runs.biometrics.result;assert.equal(bio.postgresMajor,16);assert.equal(bio.ownDeviceIngested,2);
  assert.equal(bio.ownSessionIngested,2);assert.equal(bio.biometricDiscriminators,4);assert.equal(bio.deniedChecks,9);
  for(const k of ['trueHigherIdVictimImmutable','payrollUnchanged','replayCreatesNoSecondPunch','crossTenantBadgeUnmatched'])assert.equal(bio[k],true);
  const dev=r.runs.developer.result;assert.equal(dev.result,'PASS');assert.equal(dev.independentAttackers,2);
  assert.equal(dev.ownedCreateAndRevoke,2);assert.equal(dev.webhookCreates,2);assert.equal(dev.webhookTests,2);
  assert.equal(dev.mutationDiscriminators,4);assert.equal(dev.auditRollbacks,6);assert.equal(dev.webhookDeliveryAttempted,true);
  for(const k of ['realHigherIdVictim','foreignExistingAndMissingParity','bodySelectorForgeryConfinedToOwnEmployer','actualEmployeeApiOwnDataBeforeRevocation','revokedKeyDeniedAtConsumerViaBothHeaders','victimSqlAndAuditUnchanged'])assert.equal(dev[k],true);
  assert.equal(r.mutation.result,'REJECTED');assert.equal(r.mutation.message,"document validator accepts another employer's data");
  assert.ok(Object.keys(r.pins).length>=100,'Transitive route, fixture, SQL and workflow pins required');
  for(const [file,sha] of Object.entries(r.pins)) {
    if(file==='next.config.ts') {
      try { assertHistoricalNextConfigPreservedWithInvitationHeaders(read(file),sha); }
      catch (cause) { throw new Error('Security source/proof drift: '+file, { cause }); }
    }
    else if(file==='src/lib/automation.ts'){
      try {
        assert.equal(sha,HISTORIC_AUTOMATION_SHA,'Original security-write receipt source seal changed');
        verifyNarrowStudioAutomationSource(read);
      } catch(cause){throw new Error('Security source/proof drift: '+file,{cause});}
    } else assert.equal(blob(read(file)),sha,'Security source/proof drift: '+file);
  }
  for(const t of r.targets){assert.equal(t.evidence.routeBlobSha,r.pins[t.path]);assert.equal(t.evidence.proofBlobSha,r.pins[t.evidence.file]);
    assert.equal(t.evidence.sourceHead,r.sourceHead);assert.equal(t.evidence.runLabel,r.runLabel);
    assert.equal(t.evidence.recoveryCredit,'security-three-writes');assert.equal(t.evidence.independentSecurityReview,'PENDING');
    assert.equal(t.evidence.productionTested,false);assert.equal(t.evidence.label,r.label);
    for(const a of t.anchors)assert.ok(normalized(read(t.evidence.file)).split('\n')[a.line-1]?.includes(a.text),'Security proof anchor moved: '+a.text);
  }return r;
}
export function verifySecurityCredits(manifest,read=readFileSync){
  const r=readSecurityEvidence(read);
  for(const t of r.targets){const entry=manifest.allApiRouteFiles[t.path],method=entry.methods.find(x=>x.name===t.method);
    assert.equal(entry.gitBlobSha,r.pins[t.path]);assert.equal(method.status,'COVERED');
    assert.equal(method.reviewedUncertified,undefined);assert.deepEqual(method.testedBy,t.evidence,'A partial proof is not full method credit');
  }return r.targets.length;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const m=JSON.parse(readFileSync(MANIFEST,'utf8')),mode=process.argv[2];
  if(mode==='--check'){assert.deepEqual(process.argv.slice(2),['--check']);console.log(JSON.stringify({verified:verifySecurityCredits(m),write:false}));}
  else if(mode==='--refresh-links'){
    const r=readSecurityEvidence();assert.deepEqual(process.argv.slice(2),['--refresh-links','--run-label',r.runLabel]);
    for(const t of r.targets){const method=m.allApiRouteFiles[t.path].methods.find(x=>x.name===t.method);
      assert.equal(method.status,'COVERED');assert.equal(method.testedBy.recoveryCredit,'security-three-writes');
      assert.equal(method.testedBy.file,t.evidence.file);assert.equal(method.testedBy.routeBlobSha,t.evidence.routeBlobSha);method.testedBy=t.evidence;
    }verifySecurityCredits(m);writeFileSync(MANIFEST,JSON.stringify(m,null,2)+'\n');console.log(JSON.stringify({refreshed:3,newCredits:0}));
  }
  else{
    const r=readSecurityEvidence();assert.deepEqual(process.argv.slice(2),['--credit','--run-label',r.runLabel]);const before={...m.metrics};
    for(const t of r.targets){const method=m.allApiRouteFiles[t.path].methods.find(x=>x.name===t.method);assert.equal(method.status,'GAP','Never double-credit');assert.equal(method.testedBy,null);
      method.status='COVERED';method.testedBy=t.evidence;delete method.reviewedUncertified;
      method.reason='SOLO_VERIFIED_DEV_RECOVERY: complete source-current two-attacker local PG16/production HTTP proof. '+t.evidence.boundary+' Independent security review PENDING; no production certification.';
    }
    const all=Object.values(m.allApiRouteFiles).flatMap(x=>x.methods);m.metrics.coveredAfter=all.filter(x=>x.status==='COVERED').length;m.metrics.gap=all.filter(x=>x.status==='GAP').length;
    assert.equal(m.metrics.coveredAfter,before.coveredAfter+3);assert.equal(m.metrics.gap,before.gap-3);
    m.acceptanceStatus=m.acceptanceStatus.replace(/^NOT ACCEPTED: \d+ API methods/,'NOT ACCEPTED: '+m.metrics.gap+' API methods');verifySecurityCredits(m);
    writeFileSync(MANIFEST,JSON.stringify(m,null,2)+'\n');
    for(const file of ['docs/engineering/tenant-isolation-coverage-inventory.md','docs/engineering/tenant-isolation-closure-plan.md']){
      let doc=readFileSync(file,'utf8').replace(`| coveredAfter | ${before.coveredAfter} |`,`| coveredAfter | ${m.metrics.coveredAfter} |`).replace(`| gap | ${before.gap} |`,`| gap | ${m.metrics.gap} |`);
      if(file.includes('coverage-inventory'))doc=doc.replace(/\*\*RELEASE BLOCKER:\*\* \d+ API methods/,'**RELEASE BLOCKER:** '+m.metrics.gap+' API methods').replace(/\*\*NOT ACCEPTED\*\*: \d+ method gaps/,'**NOT ACCEPTED**: '+m.metrics.gap+' method gaps');
      if(file.includes('closure-plan')){
        const start=doc.indexOf('### Current 406-method frozen batch queue'),end=doc.indexOf('### Three narrowly promoted API methods',start);
        assert.ok(start>=0&&end>start);const sections=('### Batch DL-01 —'+doc.split('### Batch DL-01 —')[1].split('## Page and server-action closure')[0]).split('### Batch ').slice(1),counts=new Map(),totals={COVERED:0,GAP:0,'PUBLIC-BY-DESIGN':0};
        for(const section of sections){const c={COVERED:0,GAP:0,'PUBLIC-BY-DESIGN':0};for(const line of section.split('\n').filter(x=>x.startsWith('- `')&&x.includes(' — [source](../../src/app/api/'))){const verb=line.split('`')[1].split(' ')[0],path=line.split(' — [source](../../')[1].split('#L')[0],status=m.allApiRouteFiles[path].methods.find(x=>x.name===verb).status;c[status]++;totals[status]++;}counts.set(section.split(' ')[0],c);}
        assert.equal(totals.COVERED+totals.GAP+totals['PUBLIC-BY-DESIGN'],406);
        let table=doc.slice(start,end).split('\n').map(line=>{for(const [id,c] of counts)if(line.startsWith('| ')&&line.includes('**'+id+'**')){const cells=line.split('|');cells[4]=' '+c.COVERED+' ';cells[5]=' '+c['PUBLIC-BY-DESIGN']+' ';cells[6]=' '+c.GAP+' ';cells[7]=c.GAP?' INCOMPLETE ':' PROVISIONAL — NOT ACCEPTED ';return cells.join('|');}return line;}).join('\n');
        table=table.replace(/\d+ COVERED \+ \d+ PUBLIC-BY-DESIGN \+ \d+ GAP = 406/,`${totals.COVERED} COVERED + ${totals['PUBLIC-BY-DESIGN']} PUBLIC-BY-DESIGN + ${totals.GAP} GAP = 406`);doc=doc.slice(0,start)+table+doc.slice(end);
      }
      doc=`> **Security write recovery — SOLO_VERIFIED_DEV_RECOVERY:** ${m.metrics.methods} methods = ${m.metrics.coveredAfter} COVERED + ${m.metrics.publicByDesign} PUBLIC-BY-DESIGN + ${m.metrics.gap} GAP. Three complete methods, four real local PG16 HTTP cases; independent review PENDING; NOT ACCEPTED for production.\n\n`+doc;writeFileSync(file,doc);
    }console.log(JSON.stringify({credited:3,before:{covered:before.coveredAfter,gap:before.gap},after:{covered:m.metrics.coveredAfter,gap:m.metrics.gap}}));
  }
}
