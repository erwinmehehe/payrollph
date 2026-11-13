import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {load} from 'js-yaml';
import {assertOwnedXenditPreflight,assertOwnedXenditLedger,assertXenditPostRefusal,
  assertXenditProtectedUnchanged,verifyXenditPostSourcePins,XENDIT_POST_SOURCE_PINS} from '../scripts/qa/tenant-xendit-post-proof-contract.mjs';
const expected={batchId:7,transferId:8,entryId:9,employeeNo:'OWN-1',referenceNumber:'PAY-7-OWN-1',
  payoutId:'po-fictional-00000007',status:'succeeded'};
const ledger=()=>({batchId:7,provider:'xendit',totals:{amountCents:1800000,transferCount:1},
  counts:{prepared:0,submitted:0,succeeded:1,failed:0,reversed:0,unknown:0},
  rows:[{transferId:8,payrollEntryId:9,employeeNo:'OWN-1',referenceNumber:'PAY-7-OWN-1',
    amountCents:1800000,providerPayoutId:'po-fictional-00000007',status:'succeeded'}]});
test('preflight must be genuinely ready without sending money',()=>{
  const good={status:200,json:{ready:true,provider:'xendit',transferCount:1,
    totalAmountCents:1800000,blockers:[],moneyMoved:false}};
  assertOwnedXenditPreflight(good);
  for(const mutate of[r=>{r.json.ready=false;},r=>{r.json.transferCount=0;},
    r=>{r.json.moneyMoved=true;},r=>{r.status=409;}]){
    const r=structuredClone(good);mutate(r);assert.throws(()=>assertOwnedXenditPreflight(r));
  }
});
test('empty, extra, foreign, wrong-amount and unpersisted payout ledgers fail discrimination',()=>{
  assertOwnedXenditLedger(ledger(),expected);
  for(const mutate of[r=>{r.rows=[];},r=>{r.rows.push({...r.rows[0]});},
    r=>{r.rows[0].employeeNo='FOREIGN-1';},r=>{r.rows[0].amountCents++;},
    r=>{r.rows[0].payrollEntryId++;},r=>{r.batchId++;},r=>{r.rows[0].providerPayoutId='po-victim-0001';}]){
    const r=ledger();mutate(r);assert.throws(()=>assertOwnedXenditLedger(r,expected));
  }
});
test('fake denials and any protected audit/ledger mutation are rejected',()=>{
  assertXenditPostRefusal({status:404,text:'not found',json:{}},404,['VICTIM']);
  assert.throws(()=>assertXenditPostRefusal({status:200,text:'not found',json:{}},404,['VICTIM']));
  assert.throws(()=>assertXenditPostRefusal({status:404,text:'VICTIM',json:{}},404,['VICTIM']));
  assert.throws(()=>assertXenditProtectedUnchanged({audit:[1],ledger:[2]},{audit:[1,3],ledger:[2]},'victim'));
});
test('every selected handler, payout guard and fixture input rejects source drift',()=>{
  verifyXenditPostSourcePins();
  for(const file of Object.keys(XENDIT_POST_SOURCE_PINS))
    assert.throws(()=>verifyXenditPostSourcePins(p=>p===file?
      Buffer.concat([readFileSync(p),Buffer.from('\n// unexecuted')]):readFileSync(p)),/SOURCE_DRIFT/);
});
test('CI precreates real fixture identities with gates OFF, scopes three servers and uploads no session file',()=>{
  const runner=readFileSync('scripts/qa/tenant-xendit-post-proof-http.mjs','utf8');
  const seed=readFileSync('scripts/qa/tenant-xendit-post-proof-seed.mjs','utf8');
  assert.ok(!runner.includes('readFileSync')&&!runner.includes('statSync'),'No file-to-network session handoff or check/read race');
  assert.ok(!seed.includes('xendit-post-fixture.json'),'Never persist session credentials in the seed handoff');
  assert.ok(runner.includes('loadXenditPostFixtures(db,s,eq,fixture)'));
  const workflow=load(readFileSync('.github/workflows/tenant-xendit-post-proof.yml','utf8'));
  assert.deepEqual(workflow.permissions,{contents:'read'});
  const job=workflow.jobs['four-operation-pg16'];
  assert.equal(job.services.postgres.image,'postgres:16');
  for(const flag of ['XENDIT_PAYOUTS_ENABLED','XENDIT_PAYOUTS_LIVE_APPROVED','PAYMONGO_DISBURSEMENTS_ENABLED',
    'XENDIT_BILLING_ENABLED','FINAL_PAY_SIGNED_REVIEW_ENABLED','EXACT_THIRTEENTH_CENTAVOS_ENABLED',
    'PAYROLL_CALCULATION_HISTORY_ENABLED','NEXT_CSP_ENABLED','WORKER_ENABLED','CENTRAL_SCHEDULER_ENABLED'])
    assert.equal(job.env[flag],'false','Job-wide gates must remain OFF: '+flag);
  assert.equal(job.steps[0].with.ref,'${{ github.event.pull_request.head.sha }}');
  assert.equal(job.steps[0].with['persist-credentials'],false);
  const commands=job.steps.map(s=>s.run??'').join('\n');
  assert.ok(commands.indexOf('tenant-xendit-post-proof-seed.mjs')<commands.indexOf('npm run build'));
  assert.match(commands,/export NODE_ENV=production/);
  assert.match(commands,/node --import \.\/scripts\/qa\/tenant-xendit-post-proof-preload\.mjs/);
  assert.match(commands,/node --import tsx scripts\/qa\/tenant-xendit-post-proof-http\.mjs/);
  const upload=job.steps.find(s=>s.uses?.startsWith('actions/upload-artifact'));
  assert.equal(upload.with.path,'qa-artifacts/xendit-post-result.json');
  assert.equal(upload.with['if-no-files-found'],'error');
});
