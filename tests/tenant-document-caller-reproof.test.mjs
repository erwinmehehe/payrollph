import test from 'node:test';import assert from 'node:assert/strict';import {spawnSync} from 'node:child_process';import {readFileSync} from 'node:fs';
test('reproof refuses a local/non-CI target before importing DB modules',()=>{
 const r=spawnSync(process.execPath,['scripts/qa/tenant-document-caller-reproof-http.mjs'],{env:{...process.env,CI:'false',GITHUB_ACTIONS:'false'},encoding:'utf8'});
 assert.notEqual(r.status,0);assert.match(r.stderr,/APPROVAL_TASK_PROOF_REFUSED/);
});
test('existing full domain assertions and exact OFF-profile checks are preserved',()=>{
 const source=readFileSync('scripts/qa/tenant-document-caller-reproof-http.mjs','utf8');
 assert.ok(source.indexOf('requireDisposableApprovalTask();')<source.indexOf("import('../../src/db/index.ts')"));
 for(const token of ['verifyHmoIsolation(f,','verifyHcmWorkQueueIsolation(f,','verifyHcmWorkItemsPageTenantBoundary(f,','credits:0','assert.equal(process.env[flag],\'false\''])assert.ok(source.includes(token),token);
 const workflow=readFileSync('.github/workflows/tenant-document-caller-reproof.yml','utf8');assert.ok(workflow.includes('image: postgres:16'));assert.doesNotMatch(workflow,/secrets\./);
});
