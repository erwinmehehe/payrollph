import test from 'node:test';import assert from 'node:assert/strict';import {spawnSync} from 'node:child_process';import {readFileSync} from 'node:fs';
import {verifyDocumentCallerReproof} from '../scripts/qa/tenant-document-caller-reproof-verify.mjs';
test('executed caller renewal rejects input, receipt and provenance mutations',()=>{
 const m=JSON.parse(readFileSync('scripts/qa/tenant-isolation-coverage-manifest.json','utf8'));
 const ref=m.scopedPages.find(x=>x.path==='src/app/hcm/work-items/page.tsx').callerReproof;
 const r=verifyDocumentCallerReproof(ref);
 assert.equal(r.credits,0);
 assert.throws(()=>verifyDocumentCallerReproof({...ref,job:1}));
 for(const path of ['scripts/qa/tenant-document-caller-reproof-receipt.json','scripts/qa/tenant-hcm-lifecycle-caller-source-refresh.json','src/lib/auth.ts','src/app/api/benefits/hmo/route.ts','src/app/api/hcm/lifecycle-notifications/route.ts','scripts/qa/hcm-work-queue-http.mjs'])
  assert.throws(()=>verifyDocumentCallerReproof(ref,(file,encoding)=>file===path?readFileSync(file,encoding)+'\n':readFileSync(file,encoding)),path);
});
test('reproof refuses a local/non-CI target before importing DB modules',()=>{
 const r=spawnSync(process.execPath,['scripts/qa/tenant-document-caller-reproof-http.mjs'],{env:{...process.env,CI:'false',GITHUB_ACTIONS:'false'},encoding:'utf8'});
 assert.notEqual(r.status,0);assert.match(r.stderr,/APPROVAL_TASK_PROOF_REFUSED/);
});
test('existing full domain assertions and exact OFF-profile checks are preserved',()=>{
 const source=readFileSync('scripts/qa/tenant-document-caller-reproof-http.mjs','utf8');
 assert.ok(source.indexOf('requireDisposableApprovalTask();')<source.indexOf("import('../../src/db/index.ts')"));
 for(const token of ['verifyHmoIsolation(f,','verifyHcmWorkQueueIsolation(f,','credits:0','assert.equal(process.env[flag],\'false\''])assert.ok(source.includes(token),token);
 const queue=readFileSync('scripts/qa/hcm-work-queue-http.mjs','utf8');
 assert.ok(queue.includes('await verifyHcmWorkItemsPageTenantBoundary(f, { request, expectStatus });'));
 assert.ok(!source.includes('await queue.verifyHcmWorkItemsPageTenantBoundary('),'nested page proof must run once, not seed duplicate unique cases');
 const workflow=readFileSync('.github/workflows/tenant-document-caller-reproof.yml','utf8');assert.ok(workflow.includes('image: postgres:16'));assert.doesNotMatch(workflow,/secrets\./);
});
