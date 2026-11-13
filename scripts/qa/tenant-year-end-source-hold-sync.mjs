/** Carry the exact merged annualization source withdrawal into another PR.
 * No credit is granted; unrelated methods/receipts are never copied or changed.
 */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {isYearEndHeld,verifyYearEndHold,verifyYearEndCredits,yearEndHoldRecord,YEAR_END_HOLD_REASON} from './tenant-year-end-credit.mjs';
const path='scripts/qa/tenant-isolation-coverage-manifest.json';
const m=JSON.parse(readFileSync(path,'utf8'));
const old={covered:m.metrics.coveredAfter,gap:m.metrics.gap};
assert.equal(process.argv[2],'--write');
if(!isYearEndHeld(m)){
  // HEAD is the pre-merge branch. Verify the exact existing credited receipt
  // against its old source rather than pretending it ran the revised source.
  verifyYearEndCredits(m,(p,encoding)=>{
    const bytes=execFileSync('git',['show','HEAD:'+p],{maxBuffer:32<<20});
    return encoding?bytes.toString(encoding):bytes;
  });
  const route=m.allApiRouteFiles['src/app/api/year-end/route.ts'];
  const bytes=readFileSync('src/lib/year-end.ts');
  const sha=createHash('sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex');
  for(const row of route.methods){
    assert.equal(row.status,'COVERED');row.status='GAP';row.testedBy=null;
    row.reason=YEAR_END_HOLD_REASON;row.reviewedUncertified=yearEndHoldRecord(route.gitBlobSha,sha);
  }
  verifyYearEndHold(m);
}
const all=Object.values(m.allApiRouteFiles).flatMap(f=>f.methods);
m.metrics.coveredAfter=all.filter(r=>r.status==='COVERED').length;
m.metrics.gap=all.filter(r=>r.status==='GAP').length;
assert.ok(old.covered-m.metrics.coveredAfter===0||old.covered-m.metrics.coveredAfter===2);
assert.equal(old.covered-m.metrics.coveredAfter,m.metrics.gap-old.gap);
m.acceptanceStatus=m.acceptanceStatus.replace(/^NOT ACCEPTED: \d+ API methods/,'NOT ACCEPTED: '+m.metrics.gap+' API methods');
writeFileSync(path,JSON.stringify(m,null,2)+'\n');
const file='docs/engineering/tenant-isolation-coverage-inventory.md';let doc=readFileSync(file,'utf8');
for(const [key,before,after]of [['coveredAfter',old.covered,m.metrics.coveredAfter],['gap',old.gap,m.metrics.gap]]){
  const marker='| '+key+' | '+before+' |';assert.equal(doc.split(marker).length,2);
  doc=doc.replace(marker,'| '+key+' | '+after+' |');
}
doc=doc.split('\n').map(line=>line.startsWith('| [`year-end` GET]')||line.startsWith('| [`year-end` POST]')?
  line.replace('**COVERED**','**GAP**'):line).join('\n');
writeFileSync(file,doc);
console.log(JSON.stringify({before:old,after:{covered:m.metrics.coveredAfter,gap:m.metrics.gap},newCredits:0}));
