import test from 'node:test';
import assert from 'node:assert/strict';
import {createOfflineFailurePacket} from '../scripts/qa/issue-1088-offline-failure-packet.mjs';

const sha='a'.repeat(40);
const runUrl='https://github.com/erwinmehehe/payrollph/actions/runs/123';
const jobUrl=runUrl+'/job/456';
const triage={schema:'payrollph-qa-triage-v1',sourceSha:sha,
 entries:[{name:'CI',status:'FAILED',runUrl,jobUrl}]};
const choice={sourceSha:sha,workflow:'CI',runUrl,jobUrl,
 testPath:'tests/exact-sha-triage.test.mjs',
 reproduction:'node --test tests/exact-sha-triage.test.mjs',
 errorCode:'ASSERTION_MISMATCH',evidenceBoundary:'fictional-only-sanitized'};
const attempt=(patch,report=triage)=>createOfflineFailurePacket(report,{...choice,...patch});

test('accepts only exact recorded failed job; makes no root-cause or patch claim',()=>{
 const x=attempt({});
 assert.equal(x.rootCause,'UNVERIFIED');
 assert.equal(x.reproductionObserved,'NOT_RUN');
 assert.equal(x.hypothesis,'test-failure-suspected');
 assert.equal(x.branchMutation,false);
 assert.equal(x.modelCalled,false);
 assert.equal(x.releaseAuthorization,'NO_GO_NOT_EVALUATED');
 assert.equal(x.jobUrl,jobUrl);
});
test('stale SHA and mismatched report are rejected',()=>{
 assert.throws(()=>attempt({sourceSha:'b'.repeat(40)}));
 assert.throws(()=>attempt({}, {...triage,sourceSha:'b'.repeat(40)}));
 assert.throws(()=>attempt({}, {...triage,schema:'garbage'}));
});
test('missing, queued, passing, and mismatched jobs are rejected',()=>{
 for(const status of ['PASS','RUNNING','NOT_TRIGGERED','SKIPPED'])
  assert.throws(()=>attempt({}, {...triage,entries:[{...triage.entries[0],status}]}));
 assert.throws(()=>attempt({}, {...triage,entries:[]}));
 assert.throws(()=>attempt({jobUrl:runUrl+'/job/457'}));
 assert.throws(()=>attempt({workflow:'Someone with PII'}));
 assert.throws(()=>attempt({runUrl:'https://github.com/erwinmehehe/payrollph/actions/runs/999'}));
});
test('rejects shell injection, ambiguous paths, and non-sanitized fields',()=>{
 assert.throws(()=>attempt({testPath:'tests/../secret.test.mjs'}));
 assert.throws(()=>attempt({testPath:'tests/payroll.test.mjs; cat /etc/passwd'}));
 assert.throws(()=>attempt({reproduction:choice.reproduction+' && echo leak'}));
 assert.throws(()=>attempt({evidenceBoundary:'production'}));
 assert.throws(()=>attempt({errorCode:'secret employee 123'}));
 assert.throws(()=>createOfflineFailurePacket(triage,{...choice,rawLog:'no'}));
});
test('typescript exact command and unknown cause remain advisory',()=>{
 const x=attempt({testPath:'tests/sample.test.ts',reproduction:'npx --no-install tsx --test tests/sample.test.ts',errorCode:'UNKNOWN'});
 assert.equal(x.hypothesis,'cause-unverified');
 assert.equal(x.proposedPatch,'NONE');
 assert.equal(x.humanAcceptance,'NOT_RUN_EXTERNAL');
});
