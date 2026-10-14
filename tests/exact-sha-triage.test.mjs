import test from 'node:test';
import assert from 'node:assert/strict';
import {summarize,render,CHECKS} from '../scripts/qa/exact-sha-triage.mjs';
const sha='a'.repeat(40);
const run=(id,file,conclusion,source=sha)=>({id,path:'.github/workflows/'+file,
 head_sha:source,status:'completed',conclusion,created_at:'2026-10-15T00:00:00Z'});
test('mismatched SHA never passes',()=>{
 assert.equal(summarize(sha,[run(1,'ci.yml','success','b'.repeat(40))]).entries[0].status,'NOT_TRIGGERED');
});
test('pass failure skipped running and not triggered stay separate',()=>{
 const runs=[run(1,'ci.yml','success'),run(2,'codeql.yml','failure'),
 run(3,'security-http-smoke.yml','skipped'),{...run(4,'payout-payroll-isolation.yml',null),status:'in_progress'}];
 assert.deepEqual(summarize(sha,runs).entries.slice(0,5).map(x=>x.status),
 ['PASS','FAILED','SKIPPED','RUNNING','NOT_TRIGGERED']);
});
test('exact-sha rerun wins over failed earlier run',()=>{
 const a=run(1,'ci.yml','failure');
 const b={...run(2,'ci.yml','success'),created_at:'2026-10-15T01:00:00Z'};
 assert.equal(summarize(sha,[a,b]).entries[0].status,'PASS');
});
test('failure has link but not invented root cause or UAT',()=>{
 const s=summarize(sha,[run(7,'ci.yml','failure')],{7:42});
 assert.match(render(s),/actions\/runs\/7\/job\/42/);
 assert.match(render(s),/unverified/);
 assert.equal(s.humanAcceptance,'NOT_RUN_EXTERNAL');
 assert.equal(s.entries.length,CHECKS.length);
});
test('invalid target rejected',()=>assert.throws(()=>summarize('main',[])));
