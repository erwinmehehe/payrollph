/** Restricted nineteen-method renewal. Runtime routes are never edited here. */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {ORACLE_HELD_METHODS,verifyOracleSourceHolds} from './payroll-run-oracle-hold.mjs';
import {payrollRenewalProofBuilder} from './payroll-run-credit-renewal-verify.mjs';
const MANIFEST='scripts/qa/tenant-isolation-coverage-manifest.json';
const INVENTORY='docs/engineering/tenant-isolation-coverage-inventory.md';
const PLAN='docs/engineering/tenant-isolation-closure-plan.md';
const statuses=['COVERED','PUBLIC-BY-DESIGN','PRIVILEGED-OPERATIONS-TOKEN-ONLY','GAP'];

export function applyPayrollRenewal(input){
  const m=structuredClone(input),remaining=verifyOracleSourceHolds(m),proof=payrollRenewalProofBuilder();
  let credited=0;
  for(const key of ORACLE_HELD_METHODS){
    const at=key.indexOf(' '),verb=key.slice(0,at),route=key.slice(at+1),path='src/app/api/'+route+'/route.ts';
    const row=m.allApiRouteFiles[path].methods.find(r=>r.name===verb);
    if(row.status==='COVERED'){assert.deepEqual(row.testedBy,proof(key));continue;}
    assert.ok(remaining.has(verb+' '+path),'Only a verified source withdrawal may be renewed');
    assert.equal(row.testedBy,null);
    row.historicalOracleSourceWithdrawal=structuredClone(row.reviewedUncertified);
    delete row.reviewedUncertified;
    row.status='COVERED';row.testedBy=proof(key);
    row.reason='Provisional current-source real-HTTP/disposable-PG16 renewal after the membership-oracle fix: two attacker employers, populated genuine victim, successful own action/read, forged selectors, uniform foreign/missing refusals and unchanged victim SQL/audit. '+
      'Executed cohorts: '+row.testedBy.cohorts.map(c=>c.evidence).join(' ; ')+
      '. SOLO_VERIFIED_DEV_RECOVERY; independent security review PENDING; no production/provider acceptance.';
    credited++;
  }
  const all=Object.values(m.allApiRouteFiles).flatMap(f=>f.methods);
  m.metrics.coveredAfter=all.filter(r=>r.status==='COVERED').length;
  m.metrics.gap=all.filter(r=>r.status==='GAP').length;
  assert.equal(m.metrics.coveredAfter-input.metrics.coveredAfter,credited);
  assert.equal(input.metrics.gap-m.metrics.gap,credited);
  assert.equal(verifyOracleSourceHolds(m).size,0);
  m.acceptanceStatus=m.acceptanceStatus.replace(/^NOT ACCEPTED: \d+ API methods/,'NOT ACCEPTED: '+m.metrics.gap+' API methods');
  const note=' Nineteen payroll-run source withdrawals are now provisionally renewed from sealed real-HTTP PG16 cohorts; their original source-withdrawal receipts stay historical. SOLO_VERIFIED_DEV_RECOVERY; independent and production acceptance remain PENDING.';
  if(!m.acceptanceStatus.includes(note))m.acceptanceStatus+=note;
  return {manifest:m,credited};
}

function reconcilePlan(doc,m){
  const section=doc.split('### Batch DL-01 —')[1]?.split('## Page and server-action closure')[0];assert.ok(section);
  const totals=Object.fromEntries(statuses.map(s=>[s,0]));
  for(const block of ('### Batch DL-01 —'+section).split('### Batch ').slice(1)){
    const id=block.split(' ')[0],counts=Object.fromEntries(statuses.map(s=>[s,0]));
    for(const line of block.split('\n').filter(l=>l.startsWith('- `')&&l.includes(' — [source](../../src/app/api/'))){
      const verb=line.split('`')[1].split(' ')[0],file=line.split(' — [source](../../')[1].split('#L')[0];
      const status=m.allApiRouteFiles[file].methods.find(r=>r.name===verb).status;
      assert.ok(Object.hasOwn(counts,status));counts[status]++;totals[status]++;
    }
    doc=doc.split('\n').map(line=>{
      const cells=line.split('|');if(cells.length!==10||cells[2].trim()!=='**'+id+'**')return line;
      for(const[i,status]of statuses.entries())cells[i+4]=' '+counts[status]+' ';
      cells[8]=counts.GAP?' INCOMPLETE ':' PROVISIONAL — NOT ACCEPTED ';return cells.join('|');
    }).join('\n');
  }
  assert.equal(Object.values(totals).reduce((a,b)=>a+b,0),406);
  const outside=statuses.map(s=>[s==='COVERED'?m.metrics.coveredAfter:s==='GAP'?m.metrics.gap:
    s==='PUBLIC-BY-DESIGN'?m.metrics.publicByDesign:m.metrics.privilegedOperationsTokenOnly,s])
    .map(([n,s])=>[n-totals[s],s]);
  assert.ok(outside.every(([n])=>Number.isSafeInteger(n)&&n>=0));
  doc=doc.replace(/^Frozen subtotal[^\n]+/m,line=>line
    .replace(/\*\*\d+ COVERED \+ \d+ PUBLIC-BY-DESIGN \+ \d+ PRIVILEGED-OPERATIONS-TOKEN-ONLY \+ \d+ GAP = 406\*\*/,
      '**'+statuses.map(s=>totals[s]+' '+s).join(' + ')+' = 406**')
    .replace(/Relative to the live \d+-method ledger, the other \*\*\d+ methods\*\* are \*\*[^*]+\*\*\./,
      'Relative to the live '+m.metrics.methods+'-method ledger, the other **'+(m.metrics.methods-406)+' methods** are **'+outside.filter(([n])=>n>0).map(([n,s])=>n+' '+s).join(' + ')+'**.'));
  const supplemental=doc.indexOf('## Supplemental payroll-run source-withdrawal renewals');
  if(supplemental>=0){const end=doc.indexOf('\n## ',supplemental+4),stop=end<0?doc.length:end;
    const replacement=doc.slice(supplemental,stop).replace('Each stays GAP until its own renewed proof; no frozen link is changed.',
      'All seven supplemental methods are provisionally renewed by the same source-sealed nineteen-method receipt; no frozen link is changed.')
      .replace(/^- HELD `(GET|POST) \/api\/([^`]+)` — fresh exact-source PG16 HTTP required$/gm,
        '- RENEWED `$1 /api/$2` — source-sealed nineteen-method real HTTP/PG16 receipt; independent acceptance PENDING');
    doc=doc.slice(0,supplemental)+replacement+doc.slice(stop);
  }
  return doc;
}

function documents(m){
  let inventory=readFileSync(INVENTORY,'utf8'),plan=readFileSync(PLAN,'utf8');
  for(const[field,status]of [['coveredAfter','COVERED'],['gap','GAP']]){
    const pattern=new RegExp('^\\| '+field+' \\| \\d+ \\|$','m');assert.match(inventory,pattern);
    inventory=inventory.replace(pattern,'| '+field+' | '+(status==='COVERED'?m.metrics.coveredAfter:m.metrics.gap)+' |');
  }
  const rows=inventory.split('\n');
  for(const key of ORACLE_HELD_METHODS){
    const at=key.indexOf(' '),verb=key.slice(0,at),route=key.slice(at+1);
    const row=m.allApiRouteFiles['src/app/api/'+route+'/route.ts'].methods.find(r=>r.name===verb);
    const i=rows.findIndex(l=>l.startsWith('| [`'+route+'` '+verb+']'));assert.ok(i>=0);
    const cells=rows[i].split(' | ');
    cells[cells.length-2]=row.testedBy.cohorts.map(c=>'['+c.name+' PG16]('+c.evidence+')').join(' + ');
    cells[cells.length-1]='**COVERED** |';rows[i]=cells.join(' | ');
  }
  inventory=rows.join('\n');
  plan=reconcilePlan(plan,m);
  const banner='> **PAYROLL RUN ORACLE — RENEWED:** 19 source-sealed provisional method renewals; '+m.metrics.coveredAfter+' COVERED / '+m.metrics.gap+' GAP. SOLO_VERIFIED_DEV_RECOVERY; independent and production acceptance PENDING.';
  for(const key of ['inventory','plan']){
    let text=key==='inventory'?inventory:plan;
    // Keep the separate, zero-credit SSO hold before this accounting banner.
    // Removing/reinserting only our banner must remain idempotent with Studio.
    let preceding='';
    const ssoPrefix='> **SSO DEFAULT-OFF INTEGRATION HOLD (PR #1954, pending review):** ';
    if(text.startsWith(ssoPrefix)){
      const end=text.indexOf('\n\n');assert.ok(end>=0);
      preceding=text.slice(0,end+2);text=text.slice(end+2);
    }
    text=text.replace(/^> \*\*PAYROLL RUN ORACLE — (?:SOURCE HOLD|RENEWED):\*\*[^\n]*\n\n/,'');
    text=preceding+banner+'\n\n'+text;
    text=text.replace(/^(> \*\*(?:RELEASE BLOCKER|NOT ACCEPTED)\*\*:? )\d+ (?:API )?(?:methods|method gaps)/gm,
      '$1'+m.metrics.gap+' API methods');
    // Only the first, live Studio banner is current. Later repeats are
    // historical source-evidence snapshots and must never be rewritten.
    text=text.replace(/^(> \*\*SOLO_VERIFIED_DEV_RECOVERY — complete Studio POST proposal:\*\* )\d+ methods = \d+ COVERED \+ \d+ PUBLIC-BY-DESIGN \+ \d+ PRIVILEGED-OPERATIONS-TOKEN-ONLY \+ \d+ GAP\./m,
      '$1'+m.metrics.methods+' methods = '+m.metrics.coveredAfter+' COVERED + '+m.metrics.publicByDesign+' PUBLIC-BY-DESIGN + '+m.metrics.privilegedOperationsTokenOnly+' PRIVILEGED-OPERATIONS-TOKEN-ONLY + '+m.metrics.gap+' GAP.');
    if(key==='inventory')inventory=text;else plan=text;
  }
  return {inventory,plan};
}

export function reconcilePayrollRenewal({write=false}={}){
  const current=JSON.parse(readFileSync(MANIFEST,'utf8')),{manifest,credited}=applyPayrollRenewal(current);
  const {inventory,plan}=documents(manifest);
  if(write){writeFileSync(MANIFEST,JSON.stringify(manifest,null,2)+'\n');writeFileSync(INVENTORY,inventory);writeFileSync(PLAN,plan);}
  else{
    assert.deepEqual(current,manifest,'Run the restricted renewal writer first');
    assert.equal(readFileSync(INVENTORY,'utf8'),inventory,'Inventory renewal is not reconciled');
    assert.equal(readFileSync(PLAN,'utf8'),plan,'Frozen/supplemental queue renewal is not reconciled');
  }
  return {write,credited,before:{covered:current.metrics.coveredAfter,gap:current.metrics.gap},
    after:{covered:manifest.metrics.coveredAfter,gap:manifest.metrics.gap}};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  assert.ok(['--write','--check'].includes(process.argv[2]));console.log(JSON.stringify(reconcilePayrollRenewal({write:process.argv[2]==='--write'})));
}
