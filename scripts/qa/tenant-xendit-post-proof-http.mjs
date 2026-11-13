/** Full four-operation real HTTP / PG16 tenant candidate. Never a live payout. */
import assert from 'node:assert/strict';
import {readFileSync,statSync,writeFileSync} from 'node:fs';
import {assertXenditPostProofTarget} from './tenant-xendit-post-proof-target.mjs';
import {verifyXenditPostSourcePins,assertOwnedXenditPreflight,assertOwnedXenditLedger,
  assertXenditPostRefusal,assertXenditProtectedUnchanged,XENDIT_POST_ACTIONS} from './tenant-xendit-post-proof-contract.mjs';
import {startXenditProviderFixture} from './tenant-xendit-post-provider-fixture.mjs';
assertXenditPostProofTarget(process.env);
verifyXenditPostSourcePins();
const file='qa-artifacts/xendit-post-fixture.json',stat=statSync(file);
assert.ok(stat.isFile()&&(stat.mode&0o077)===0,'Private runner-owned fictional fixture required');
const {a,b,victim}=JSON.parse(readFileSync(file,'utf8')),employers=[a,b,victim];
assert.deepEqual(employers.map(e=>e.port),[3000,3001,3002]);
const [{db,pool},s,{and,eq}]=await Promise.all([
  import('../../src/db/index.ts'),import('../../src/db/schema.ts'),import('drizzle-orm'),
]);
const provider=await startXenditProviderFixture(employers);
const own=[],refusals=[],recoveries=[];
let missingComparisons=0;
const url=(run)=>'/api/payroll-runs/'+run.id+'/xendit-payout';
async function request(e,run,body,cookie=e.cookie,origin='https://payroll.example.test'){
  const response=await fetch('http://127.0.0.1:'+e.port+url(run),{method:'POST',
    headers:{...(cookie?{cookie}:{}),origin,'sec-fetch-site':origin==='https://payroll.example.test'?'same-origin':'cross-site',
      'content-type':'application/json'},body:JSON.stringify(body),redirect:'manual',cache:'no-store',
    signal:AbortSignal.timeout(30000)});
  const text=await response.text();let json=null;try{json=JSON.parse(text);}catch{}
  return{status:response.status,text,json};
}
const orgTables=(await pool.query("SELECT table_name FROM information_schema.columns WHERE table_schema='public' AND column_name='organization_id' ORDER BY table_name")).rows.map(r=>r.table_name);
async function snapshot(e){
  const out={};
  for(const name of orgTables){
    assert.match(name,/^[a-z_0-9]+$/);
    out[name]=(await pool.query('SELECT to_jsonb(t) AS row FROM "'+name+'" t WHERE organization_id=$1 ORDER BY to_jsonb(t)::text',[e.org.id])).rows;
  }
  out.organization=(await pool.query('SELECT to_jsonb(t) AS row FROM organizations t WHERE id=$1',[e.org.id])).rows;
  out.entries=(await pool.query('SELECT to_jsonb(e) AS row FROM payroll_entries e JOIN payroll_runs r ON r.id=e.payroll_run_id WHERE r.organization_id=$1 ORDER BY e.id',[e.org.id])).rows;
  return out;
}
async function dbLedger(e,r){
  const batches=await db.select().from(s.payoutBatches).where(and(
    eq(s.payoutBatches.organizationId,e.org.id),eq(s.payoutBatches.payrollRunId,r.run.id)));
  const rows=await db.select().from(s.payoutTransfers).where(and(
    eq(s.payoutTransfers.organizationId,e.org.id),eq(s.payoutTransfers.payrollRunId,r.run.id)));
  assert.equal(batches.length,1);assert.equal(rows.length,1);
  const links=await db.select().from(s.payoutBatchTransfers).where(and(
    eq(s.payoutBatchTransfers.organizationId,e.org.id),eq(s.payoutBatchTransfers.payoutBatchId,batches[0].id)));
  assert.equal(links.length,1);assert.equal(links[0].payoutTransferId,rows[0].id);
  assert.equal(rows[0].payrollEntryId,r.entry.id);assert.equal(rows[0].employeeId,e.worker.id);
  assert.equal(rows[0].amountCents,1800000);
  return{batchId:batches[0].id,transferId:rows[0].id,entryId:r.entry.id,employeeNo:e.worker.employeeNo,
    referenceNumber:r.referenceNumber,payoutId:links[0].providerTransferId,status:rows[0].status};
}
async function auditCount(e,action,runId){
  return(await db.select().from(s.auditEvents).where(and(eq(s.auditEvents.organizationId,e.org.id),
    eq(s.auditEvents.action,action)))).filter(row=>Number(row.metadata?.runId)===runId).length;
}
async function foreignSnapshots(e){
  return new Map(await Promise.all(employers.filter(x=>x.org.id!==e.org.id).map(async x=>[x,await snapshot(x)])));
}
async function assertForeignSnapshots(map,label){
  for(const[e,before]of map)assertXenditProtectedUnchanged(before,await snapshot(e),label);
}
const forged=(e)=>({organizationId:e.org.id,legalEntityId:e.entity.id,runId:e.runs.normal.run.id,
  employeeId:e.worker.id,userId:e.owner.id});
try{
  assert.equal(Math.floor(Number((await pool.query('show server_version_num')).rows[0].server_version_num)/10000),16);
  for(const e of [victim,a,b]){
    const before=await foreignSnapshots(e),other=e===victim?a:victim;
    const normal=e.runs.normal,ambiguous=e.runs.ambiguous;
    const calls=provider.calls.length;
    const preflight=await request(e,normal.run,{action:'preflight',...forged(other)});
    assertOwnedXenditPreflight(preflight);
    assert.equal(provider.calls.length,calls,'No provider request during owned preflight');
    assert.equal(await auditCount(e,'Xendit payroll preflight passed',normal.run.id),1);
    own.push({employerId:e.org.id,action:'preflight',ownSuccess:true,persistedAudit:true});
    const submitBefore=provider.calls.filter(c=>c.method==='POST').length;
    const submitted=await request(e,normal.run,{action:'submit',confirm:true,...forged(other)});
    assert.equal(submitted.status,200,submitted.text.slice(0,160));
    assert.deepEqual(submitted.json?.submitted,[normal.referenceNumber]);
    assert.equal(submitted.json.complete,true);
    const persisted=await dbLedger(e,normal);
    assert.equal(persisted.status,'submitted');assert.equal(persisted.payoutId,normal.payoutId);
    assertOwnedXenditLedger(submitted.json.ledger,persisted);
    assert.equal(provider.calls.filter(c=>c.method==='POST').length,submitBefore+1);
    own.push({employerId:e.org.id,action:'submit',ownSuccess:true,persistedTransfer:true});
    const repeated=await request(e,normal.run,{action:'submit',confirm:true});
    assert.equal(repeated.status,200,repeated.text.slice(0,160));
    assert.deepEqual(repeated.json?.submitted,[]);
    assert.equal(provider.calls.filter(c=>c.method==='POST').length,submitBefore+1,'Idempotent submit must not resend');
    const beforeReconcileGets=provider.calls.filter(c=>c.method==='GET').length;
    const reconcile=await request(e,normal.run,{action:'reconcile',cursor:0,...forged(other)});
    assert.equal(reconcile.status,200,reconcile.text.slice(0,160));
    assert.equal(reconcile.json?.checked,1);
    assert.equal(provider.calls.filter(c=>c.method==='GET').length,beforeReconcileGets+1);
    const settled=await dbLedger(e,normal);assert.equal(settled.status,'succeeded');
    assertOwnedXenditLedger(reconcile.json.ledger,settled);
    own.push({employerId:e.org.id,action:'reconcile',ownSuccess:true,persistedSettlement:true});
    assertOwnedXenditPreflight(await request(e,ambiguous.run,{action:'preflight'}));
    const unknownBefore=provider.calls.filter(c=>c.method==='POST').length;
    const unknown=await request(e,ambiguous.run,{action:'submit',confirm:true});
    assert.equal(unknown.status,409,'A real provider HTTP failure must leave an uncertain outcome');
    const unknownState=await dbLedger(e,ambiguous);
    assert.equal(unknownState.status,'reconciliation_required');assert.equal(unknownState.payoutId,null);
    assert.equal(provider.calls.filter(c=>c.method==='POST').length,unknownBefore+1);
    const noResend=await request(e,ambiguous.run,{action:'submit',confirm:true});
    assert.equal(noResend.status,409);
    assert.equal(provider.calls.filter(c=>c.method==='POST').length,unknownBefore+1,'Unknown outcome must never trigger another provider POST');
    const beforeForeignReferences=await foreignSnapshots(e);
    const beforeForgedCalls=provider.calls.length;
    const wrongReference=await request(e,ambiguous.run,{action:'resolve-unknown',confirm:true,
      referenceNumber:other.runs.ambiguous.referenceNumber,payoutId:other.runs.ambiguous.payoutId});
    assert.equal(wrongReference.status,409);
    assert.equal(provider.calls.length,beforeForgedCalls,'A foreign reference cannot cause any provider lookup');
    assert.deepEqual(await dbLedger(e,ambiguous),unknownState,'Foreign reference changed the unresolved own transfer');
    if(e!==victim){
      assert.ok(provider.records.has(victim.runs.ambiguous.payoutId),
        'The foreign provider payout must genuinely exist before the forged-ID test');
      const wrongPayout=await request(e,ambiguous.run,{action:'resolve-unknown',confirm:true,
        referenceNumber:ambiguous.referenceNumber,payoutId:victim.runs.ambiguous.payoutId});
      assert.equal(wrongPayout.status,409,'A real victim provider payout must not settle an own instruction');
      assert.equal(provider.calls.length,beforeForgedCalls+1);
      assert.deepEqual(await dbLedger(e,ambiguous),unknownState,'Foreign provider ID altered the unresolved own ledger');
    }
    await assertForeignSnapshots(beforeForeignReferences,'Forged provider references');
    const beforeResolveGets=provider.calls.filter(c=>c.method==='GET').length;
    const resolve=await request(e,ambiguous.run,{action:'resolve-unknown',confirm:true,
      referenceNumber:ambiguous.referenceNumber,payoutId:ambiguous.payoutId,...forged(other)});
    assert.equal(resolve.status,200,resolve.text.slice(0,160));
    assert.equal(provider.calls.filter(c=>c.method==='GET').length,beforeResolveGets+1);
    const recovered=await dbLedger(e,ambiguous);
    assert.equal(recovered.status,'succeeded');assert.equal(recovered.payoutId,ambiguous.payoutId);
    assertOwnedXenditLedger(resolve.json?.ledger,recovered);
    assert.equal(provider.calls.filter(c=>c.method==='POST').length,unknownBefore+1);
    own.push({employerId:e.org.id,action:'resolve-unknown',ownSuccess:true,persistedSameTransfer:true});
    recoveries.push({employerId:e.org.id,unknownWasPersisted:true,duplicateSendBlocked:true,readOnlyRecovery:true});
    assert.throws(()=>assertOwnedXenditLedger(resolve.json.ledger,{...recovered,employeeNo:other.worker.employeeNo}),
      "accepts another employer's data");
    await assertForeignSnapshots(before,'Foreign employers during own payout journey');
  }
  const forbidden=employers.flatMap(e=>[e.marker,e.worker.employeeNo]);
  async function denied(e,targetRun,body,status,label,cookie=e.cookie,origin){
    const before=new Map(await Promise.all(employers.map(async x=>[x,await snapshot(x)])));
    const providerBefore=provider.calls.length;
    const response=await request(e,targetRun,body,cookie,origin);
    assertXenditPostRefusal(response,status,forbidden);
    await assertForeignSnapshots(before,label);
    assert.equal(provider.calls.length,providerBefore,label+': refusal contacted provider');
    refusals.push({employerId:e.org.id,action:body.action,status,targetRunId:targetRun.id,
      unchangedProtectedSql:true,providerCalls:0,label});
    return response;
  }
  for(const e of [a,b])for(const action of XENDIT_POST_ACTIONS){
    const target=action==='resolve-unknown'?victim.runs.ambiguous:victim.runs.normal;
    const body={action,confirm:true,referenceNumber:target.referenceNumber,payoutId:target.payoutId,...forged(e)};
    const foreign=await denied(e,target.run,body,404,'genuine foreign '+action);
    const missing=await denied(e,{id:victim.runs.ambiguous.run.id+1000000},body,404,'missing run '+action);
    assert.equal(foreign.text,missing.text,'Foreign and missing runs must be indistinguishable');
    missingComparisons++;
    const ownBody={action,confirm:true,referenceNumber:e.runs.ambiguous.referenceNumber,payoutId:e.runs.ambiguous.payoutId};
    await denied(e,e.runs.normal.run,ownBody,401,'anonymous '+action,null);
    await denied(e,e.runs.normal.run,ownBody,403,'non-treasury role '+action,e.limited.cookie);
    await denied(e,e.runs.normal.run,ownBody,403,'missing recent MFA '+action,e.noMfaCookie);
    await denied(e,e.runs.normal.run,ownBody,403,'cross-site '+action,e.cookie,'https://attacker.example.invalid');
    if(['submit','resolve-unknown'].includes(action))
      await denied(e,e.runs.normal.run,ownBody,403,'release/treasury separation '+action,e.releaser.cookie);
  }
  // Configuration may move away from Xendit after a prior submission. OFF
  // must block new sends while retaining strictly read-only historical recovery.
  const changed=a.runs['provider-changed'],blocked={...a,port:3003};
  assertOwnedXenditPreflight(await request(a,changed.run,{action:'preflight'}));
  assert.equal((await request(a,changed.run,{action:'submit',confirm:true})).status,409);
  const unknownChanged=await dbLedger(a,changed);assert.equal(unknownChanged.status,'reconciliation_required');
  for(const action of ['preflight','submit'])await denied(blocked,changed.run,{action,confirm:true},409,'provider-OFF '+action);
  const beforeOff=await foreignSnapshots(a),beforeOffPosts=provider.calls.filter(c=>c.method==='POST').length;
  const offReconcile=await request(blocked,a.runs.normal.run,{action:'reconcile'});
  assert.equal(offReconcile.status,200);assert.equal(offReconcile.json?.checked,1);
  assertOwnedXenditLedger(offReconcile.json.ledger,await dbLedger(a,a.runs.normal));
  const offResolve=await request(blocked,changed.run,{action:'resolve-unknown',confirm:true,
    referenceNumber:changed.referenceNumber,payoutId:changed.payoutId});
  assert.equal(offResolve.status,200,offResolve.text.slice(0,160));
  const offSettled=await dbLedger(a,changed);assert.equal(offSettled.status,'succeeded');
  assertOwnedXenditLedger(offResolve.json?.ledger,offSettled);
  assert.equal(provider.calls.filter(c=>c.method==='POST').length,beforeOffPosts);
  await assertForeignSnapshots(beforeOff,'Historical recovery with payout provider OFF');
  const revoked=await db.update(s.userOrganizations).set({active:false}).where(and(
    eq(s.userOrganizations.organizationId,a.org.id),eq(s.userOrganizations.userId,a.owner.id)))
    .returning({id:s.userOrganizations.id});
  assert.equal(revoked.length,1);
  for(const action of XENDIT_POST_ACTIONS)await denied(a,a.runs.normal.run,
    {action,confirm:true,referenceNumber:a.runs.ambiguous.referenceNumber,payoutId:a.runs.ambiguous.payoutId},
    404,'revoked employer '+action);
  verifyXenditPostSourcePins();
  assert.equal(own.length,12);
  assert.equal(new Set(own.map(r=>r.employerId+':'+r.action)).size,12);
  for(const e of employers)assert.deepEqual(own.filter(r=>r.employerId===e.org.id).map(r=>r.action),XENDIT_POST_ACTIONS);
  assert.equal(recoveries.length,3);
  assert.equal(missingComparisons,8);
  assert.equal(provider.calls.filter(c=>c.method==='POST').length,7,
    'Three normal payouts, three ambiguous payouts and one provider-change control; never a duplicate');
  assert.equal(provider.calls.filter(c=>c.method==='GET').length,10,
    'Every reconciliation/recovery and the two forged victim payout lookups must use real TCP reads');
  const result={kind:'xendit-post-four-operation-real-http-pg16',sourceHead:process.env.PR_HEAD_SHA,
    actions:XENDIT_POST_ACTIONS,attackerEmployers:2,attackerOrganizationIds:[a.org.id,b.org.id],
    victimOrganizationId:victim.org.id,victimOwnPositive:true,own,refusals,recoveries,missingComparisons,
    providerOffSendsBlocked:true,providerOffHistoricalRecovery:true,
    syntheticProviderRequests:provider.calls,realProviderCalls:0,coverageCredits:0,
    evidenceLabel:'SOLO_VERIFIED_DEV_RECOVERY',independentlyAccepted:false,productionCertified:false};
  writeFileSync('qa-artifacts/xendit-post-result.json',JSON.stringify(result,null,2)+'\n');
  console.log('XENDIT_POST_HTTP_COMPLETE '+JSON.stringify(result));
}finally{await provider.close();await pool.end();}
