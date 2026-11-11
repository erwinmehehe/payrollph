/** Three bounded, source-current local PG16 method receipts; no live acceptance. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {assertHistoricalNextConfigPreservedWithInvitationHeaders} from './tenant-invitation-header-source-compat.mjs';
import {verifySessionSourceCompatibility} from './tenant-automation-session-source-compat.mjs';
export const RECOVERY_RECEIPT='scripts/qa/tenant-merged-recovery-receipt.json';
const SEALED_DIGEST='613f2c9046bb99233a0773857088812bf15b1879d2206155dd2c1d3dec596263';
const MANIFEST='scripts/qa/tenant-isolation-coverage-manifest.json';
export const RECOVERY_TARGETS=Object.freeze([
  {path:'src/app/api/auth/totp/setup/route.ts',method:'GET',family:'totp'},
  {path:'src/app/api/auth/totp/setup/route.ts',method:'POST',family:'totp'},
  {path:'src/app/api/workforce-planning/scenarios/route.ts',method:'POST',family:'scenarios'},
]);
const normalized=x=>x.toString().replaceAll('\r\n','\n');
const digest=x=>createHash('sha256').update(normalized(x)).digest('hex');
const blob=x=>{const b=Buffer.from(normalized(x));return createHash('sha1').update('blob '+b.length+'\0').update(b).digest('hex');};
export function readRecoveryEvidence(read=readFileSync){
  const raw=read(RECOVERY_RECEIPT,'utf8');assert.equal(digest(raw),SEALED_DIGEST,'Executed recovery receipt changed');
  const r=JSON.parse(raw);assert.equal(r.label,'SOLO_VERIFIED_DEV_RECOVERY');assert.equal(r.productionCertified,false);
  assert.equal(r.execution,'local-production-http-pg16');assert.match(r.sourceHead,/^[a-f0-9]{40}$/);
  assert.deepEqual(r.targets.map(x=>[x.path,x.method]),RECOVERY_TARGETS.map(x=>[x.path,x.method]));
  assert.equal(r.runs.totp.sourceHead,r.sourceHead);assert.equal(r.runs.scenarios.sourceHead,r.sourceHead);
  assert.deepEqual(r.runs.totp.result,{kind:'TOTP_SETUP_HTTP',result:'PASS',attackers:2,methods:['GET','POST'],coverageCredits:0,productionCertified:false});
  const scenario=r.runs.scenarios.result;
  assert.equal(scenario.realOwnedHttpWrites,7);assert.equal(scenario.realDeniedHttpCalls,12);
  assert.equal(scenario.auditVetoRollbacks,2);assert.equal(scenario.scenarioDiscriminators,7);
  assert.equal(scenario.allVictimRowsUnchanged,true);assert.equal(scenario.providerCalls,0);
  assert.equal(scenario.newCoverageCredits,0);assert.equal(scenario.productionTested,false);
  for(const run of Object.values(r.runs)){
    assert.equal(run.label,'SOLO_VERIFIED_DEV_RECOVERY');assert.equal(run.coverageCredits,0);
    assert.equal(run.productionCertified,false);assert.equal(run.independentlyAccepted,false);
    for(const value of Object.values(run.flags))assert.equal(value,'false','Money/provider/worker flag must stay off');
  }
  assert.ok(Object.keys(r.pins).length>30,'Transitive runtime and proof inputs required');
  for(const [file,sha] of Object.entries(r.pins)) {
    if(file==='next.config.ts') {
      try { assertHistoricalNextConfigPreservedWithInvitationHeaders(read(file),sha); }
      catch (cause) { throw new Error('Recovery source/proof drift: '+file, { cause }); }
    }
    else if(file==='src/lib/automation.ts') verifySessionSourceCompatibility(sha,blob(read(file)),read);
    else assert.equal(blob(read(file)),sha,'Recovery source/proof drift: '+file);
  }
  for(const target of r.targets){
    assert.equal(target.evidence.routeBlobSha,r.pins[target.path]);
    assert.equal(target.evidence.proofBlobSha,r.pins[target.evidence.file]);
    for(const anchor of target.anchors)assert.ok(normalized(read(target.evidence.file)).split('\n')[anchor.line-1]?.includes(anchor.text),
      'Recovery proof anchor moved: '+anchor.text);
  }
  return r;
}
export function verifyRecoveryCredits(manifest,read=readFileSync){
  const r=readRecoveryEvidence(read);
  for(const target of r.targets){const entry=manifest.allApiRouteFiles[target.path];const m=entry.methods.find(x=>x.name===target.method);
    assert.equal(entry.gitBlobSha,r.pins[target.path]);assert.equal(m.status,'COVERED');
    assert.equal(m.reviewedUncertified,undefined);assert.deepEqual(m.testedBy,target.evidence,'Do not borrow a partial receipt');
    assert.equal(m.testedBy.independentSecurityReview,'PENDING');assert.equal(m.testedBy.productionTested,false);
  }return r.targets.length;
}
function closure(doc,m){
  const start=doc.indexOf('### Current 406-method frozen batch queue — 2026-10-29'),end=doc.indexOf('### Three narrowly promoted API methods',start);
  assert.ok(start>=0&&end>start);const sections=('### Batch DL-01 —'+doc.split('### Batch DL-01 —')[1].split('## Page and server-action closure')[0]).split('### Batch ').slice(1);
  const counts=new Map(),total={COVERED:0,GAP:0,'PUBLIC-BY-DESIGN':0};
  for(const section of sections){const id=section.split(' ')[0],c={COVERED:0,GAP:0,'PUBLIC-BY-DESIGN':0};
    for(const line of section.split('\n').filter(x=>x.startsWith('- `')&&x.includes(' — [source](../../src/app/api/'))){
      const verb=line.split('`')[1].split(' ')[0],path=line.split(' — [source](../../')[1].split('#L')[0],status=m.allApiRouteFiles[path].methods.find(x=>x.name===verb).status;c[status]++;total[status]++;}
    counts.set(id,c);
  }assert.equal(total.COVERED+total.GAP+total['PUBLIC-BY-DESIGN'],406);
  let table=doc.slice(start,end).split('\n').map(line=>{
    for(const [id,c] of counts)if(line.startsWith('| ')&&line.includes('**'+id+'**')){const cells=line.split('|');cells[4]=' '+c.COVERED+' ';cells[5]=' '+c['PUBLIC-BY-DESIGN']+' ';cells[6]=' '+c.GAP+' ';cells[7]=c.GAP?' INCOMPLETE ':' PROVISIONAL — NOT ACCEPTED ';return cells.join('|');}return line;
  }).join('\n');
  table=table.replace(/\d+ COVERED \+ \d+ PUBLIC-BY-DESIGN \+ \d+ GAP = 406/,`${total.COVERED} COVERED + ${total['PUBLIC-BY-DESIGN']} PUBLIC-BY-DESIGN + ${total.GAP} GAP = 406`);
  const incomplete=[...counts.values()].filter(c=>c.GAP>0).length;
  const complete=[...counts].filter(([,c])=>!c.GAP).map(([id])=>id);
  table=table.replace(/Ten batches remain INCOMPLETE; DL-02 and WRK-01 remain PROVISIONAL — NOT ACCEPTED\./,
    `${incomplete} batches remain INCOMPLETE; ${complete.join(', ')} remain PROVISIONAL — NOT ACCEPTED.`);
  return doc.slice(0,start)+table+doc.slice(end);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const mode=process.argv[2];assert.ok(['--check','--credit','--refresh-links'].includes(mode));
  const m=JSON.parse(readFileSync(MANIFEST,'utf8'));
  if(mode==='--check'){assert.deepEqual(process.argv.slice(2),['--check']);console.log(JSON.stringify({verified:verifyRecoveryCredits(m),write:false}));}
  else if(mode==='--refresh-links'){
    const r=readRecoveryEvidence();assert.deepEqual(process.argv.slice(2),['--refresh-links','--run-label',r.runLabel]);
    for(const t of r.targets){const mth=m.allApiRouteFiles[t.path].methods.find(x=>x.name===t.method);
      assert.equal(mth.status,'COVERED');assert.equal(mth.testedBy.recoveryCredit,'merged-three-methods');
      assert.equal(mth.testedBy.file,t.evidence.file);assert.equal(mth.testedBy.routeBlobSha,t.evidence.routeBlobSha);
      mth.testedBy=t.evidence;
    }verifyRecoveryCredits(m);writeFileSync(MANIFEST,JSON.stringify(m,null,2)+'\n');
    console.log(JSON.stringify({refreshed:3,newCredits:0}));
  }else{
    const r=readRecoveryEvidence();assert.deepEqual(process.argv.slice(2),['--credit','--run-label',r.runLabel]);
    const before={...m.metrics};
    for(const t of r.targets){const method=m.allApiRouteFiles[t.path].methods.find(x=>x.name===t.method);assert.equal(method.status,'GAP','No double credit');assert.equal(method.testedBy,null);
      method.status='COVERED';method.testedBy=t.evidence;delete method.reviewedUncertified;
      method.reason='SOLO_VERIFIED_DEV_RECOVERY: fresh committed-source local PG16/production HTTP, two fictional actors, genuine victim boundary, forged selectors, discriminating own state and unchanged victim SQL. '+t.evidence.boundary+'. Independent review PENDING; no production certification.';
    }
    const all=Object.values(m.allApiRouteFiles).flatMap(x=>x.methods);m.metrics.coveredAfter=all.filter(x=>x.status==='COVERED').length;m.metrics.gap=all.filter(x=>x.status==='GAP').length;
    assert.equal(m.metrics.coveredAfter,before.coveredAfter+3);assert.equal(m.metrics.gap,before.gap-3);
    m.acceptanceStatus=m.acceptanceStatus.replace(/^NOT ACCEPTED: \d+ API methods/,'NOT ACCEPTED: '+m.metrics.gap+' API methods');verifyRecoveryCredits(m);
    writeFileSync(MANIFEST,JSON.stringify(m,null,2)+'\n');
    for(const file of ['docs/engineering/tenant-isolation-coverage-inventory.md','docs/engineering/tenant-isolation-closure-plan.md']){
      let doc=readFileSync(file,'utf8');
      if(file.includes('closure-plan'))doc=closure(doc,m);else doc=doc.replace(`| coveredAfter | ${before.coveredAfter} |`,`| coveredAfter | ${m.metrics.coveredAfter} |`).replace(`| gap | ${before.gap} |`,`| gap | ${m.metrics.gap} |`);
      doc=`> **Merged-proof recovery — SOLO_VERIFIED_DEV_RECOVERY:** ${m.metrics.methods} methods = ${m.metrics.coveredAfter} COVERED + ${m.metrics.publicByDesign} PUBLIC-BY-DESIGN + ${m.metrics.gap} GAP. Three distinct methods; independent security review PENDING; NOT ACCEPTED for production.\n\n`+doc;
      writeFileSync(file,doc);
    }
    console.log(JSON.stringify({credited:3,before:{covered:before.coveredAfter,gap:before.gap},after:{covered:m.metrics.coveredAfter,gap:m.metrics.gap}}));
  }
}
