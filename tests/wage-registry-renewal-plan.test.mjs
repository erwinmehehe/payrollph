import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import yaml from 'js-yaml';
import {readWageRenewalInventory,INVENTORY,captureWageRenewalInventory} from '../scripts/qa/wage-registry-renewal-plan.mjs';

test('the renewal starts from exactly 75 immutable current-main withdrawals, not earlier credit guesses',()=>{
 const inv=readWageRenewalInventory();
 assert.equal(inv.baseMainCommit,'5646f6c99c9ef025e40ad0a9a070aa4b596a3a4f');
 const counts={};for(const e of inv.methods)counts[e.held.reviewedUncertified.kind]=(counts[e.held.reviewedUncertified.kind]||0)+1;
 assert.deepEqual(Object.values(counts).sort((a,b)=>a-b),[5,23,47]);
 assert.throws(()=>captureWageRenewalInventory(),/Never overwrite/);
 assert.throws(()=>readWageRenewalInventory(p=>p===INVENTORY?Buffer.concat([readFileSync(p),Buffer.from('\n')]):readFileSync(p)),/immutable/);
});

test('adding a renewal trigger preserves every original proof job, environment, assertion and permission',()=>{
 const {baseMainCommit}=readWageRenewalInventory();
 const files=execFileSync('git',['diff','--name-only',baseMainCommit,'--','.github/workflows'],{encoding:'utf8'}).trim().split('\n').filter(Boolean);
 assert.ok(files.length>0);
 for(const file of files){
  const before=yaml.load(execFileSync('git',['show',baseMainCommit+':'+file],{encoding:'utf8'}));
  const after=yaml.load(readFileSync(file,'utf8'));
  assert.deepEqual(after.jobs,before.jobs,'Do not alter any executed proof instruction: '+file);
  assert.deepEqual(after.permissions,before.permissions);
  assert.ok(after.on.pull_request.paths.includes('scripts/qa/wage-registry-renewal-*'));
  after.on.pull_request.paths=after.on.pull_request.paths.filter(p=>p!=='scripts/qa/wage-registry-renewal-*');
  assert.deepEqual(after,before,'Only the opt-in renewal trigger may be added: '+file);
 }
});
