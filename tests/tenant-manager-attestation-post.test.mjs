import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createRows} from '../scripts/qa/tenant-table-rows/write/hcm-manager-attestation-post.mjs';
import {tenantFamilyCatalog} from '../scripts/qa/tenant-table-catalog.mjs';
const [row]=createRows({assert,db:{},addWorker(){},auditBusinessSnapshot:x=>x});
const c={orgId:1,owner:{id:2,name:'Fictional Manager'},marker:'A',seeded:{id:3,workerId:4,managerId:5,assignmentId:6,positionId:7,reportingLineSnapshot:{managerEmployeeId:5}}};
const before={attestations:[],events:[],audits:[],decisions:[{id:3,status:'pending_approval'}],terms:[{id:8}]};
const attestation={id:9,organizationId:1,decisionId:3,employeeId:4,managerEmployeeId:5,managerUserId:2,managerName:'Fictional Manager',
 workerPositionAssignmentId:6,workerPositionId:7,recommendation:'support',statement:'A fictional manager evidence support',reportingLineSnapshot:{managerEmployeeId:5}};
const after={...before,attestations:[attestation],events:[{id:10,organizationId:1,decisionId:3,employeeId:4,eventType:'manager_attested',actorName:'Fictional Manager',actorUserId:2,
 metadata:{managerAttestationId:9,managerEmployeeId:5,workerPositionAssignmentId:6,workerPositionId:7,recommendation:'support'}}],audits:[{id:11,organizationId:1,
 actor:'Fictional Manager',action:'Employment decision manager attestation submitted',resource:'Decision #3',metadata:{employeeId:4,managerAttestationId:9,recommendation:'support',workerPositionAssignmentId:6}}]};
const response={status:201,json:{attestation}};
test('exact own SQL attestation, actor event and business audit pass',()=>row.expect(before,after,c,response));
test('no-op, other employer, forged manager and extra source mutation cannot pass',()=>{
 assert.throws(()=>row.expect(before,before,c,response));
 assert.throws(()=>row.expect(before,after,{...c,orgId:99},response));
 for(const change of [x=>x.attestations[0].managerEmployeeId++,x=>x.attestations[0].workerPositionAssignmentId++,x=>x.events[0].actorUserId++,
  x=>x.audits[0].metadata.employeeId++,x=>x.decisions[0].status='approved']){
  const changed=structuredClone(after);change(changed);assert.throws(()=>row.expect(before,changed,c,response));
 }
});
test('exact unclaimed POST identity, real path IDs and foreign request shape are catalogued',()=>{
 const entries=tenantFamilyCatalog('write').filter(x=>x.file.endsWith('/hcm-manager-attestation-post.mjs'));
 assert.deepEqual(entries.map(x=>x.key),['POST hcm/employment-term-decisions/[id]/manager-attestation']);
 assert.deepEqual(row.pathIds,{id:'id'});assert.equal(row.status,201);assert.equal(row.deny,403);assert.equal(row.forged.status,404);
 assert.equal(row.foreignBody({...c,victim:{org:{id:99}}}).organizationId,99);assert.equal(row.forged.body(c).organizationId,1);
});
test('all supported recommendation values and sealed/reporting-line denials remain explicit',()=>{
 const source=readFileSync('scripts/qa/tenant-table-rows/write/hcm-manager-attestation-post.mjs','utf8');
 for(const text of ["recommendation='support'","['do_not_support','needs_more_review']",'sealed decision refused','People admin without current-manager identity',
  'changed reporting line refused','assert.deepEqual(await state(c.victim.org.id),victimBefore)'])assert.ok(source.includes(text),text);
 assert.ok(source.includes("assert.equal(mfa.json.code,'MFA_REQUIRED')"));
 const workflow=readFileSync('.github/workflows/tenant-table-proof.yml','utf8');
 assert.ok(workflow.includes("'scripts/qa/tenant-table-rows/**'"));assert.ok(workflow.includes('image: postgres:16'));
});
test('the sanitized local receipt stays bound to executed source and failed no-op mutation',()=>{
 const r=JSON.parse(readFileSync('docs/qa/tenant-manager-attestation-post-receipt.json','utf8'));
 assert.equal(r.schema,'manager-attestation-post-local-http-v1');assert.equal(r.postgresMajor,18);assert.equal(r.serverVersionNum,180006);
 assert.equal(r.ci,'NOT_RUN');assert.equal(r.productionTested,false);assert.equal(r.mutation.rejected,true);
 assert.match(r.mutation.message,/expect accepts another employer's data/);
 assert.deepEqual([r.run.rows,r.run.ownAndForeignPairs,r.run.discriminatingProofs,r.run.forgedReferenceProofs],[1,2,1,2]);
 assert.equal(r.run.victimDatabaseUnchanged,true);assert.equal(r.run.additionalActionProofs.length,2);
 for(const proof of r.run.additionalActionProofs){assert.deepEqual(proof.recommendations,['support','do_not_support','needs_more_review']);
  for(const key of ['sealedDecisionDenied','unassignedAdminDenied','changedManagerDenied','mfaDenied'])assert.equal(proof[key],true);}
 assert.deepEqual(r.sources.map(x=>x.file),['scripts/qa/tenant-table-rows/write/hcm-manager-attestation-post.mjs','scripts/qa/tenant-table-rows/read/hcm-manager-attestation.mjs',
  'scripts/qa/tenant-write-table-http.mjs','src/app/api/hcm/employment-term-decisions/[id]/manager-attestation/route.ts','src/lib/hcm-manager-attestation.ts']);
 for(const pin of r.sources)assert.equal(createHash('sha256').update(readFileSync(pin.file,'utf8').replaceAll('\r\n','\n')).digest('hex'),pin.sha256,'renew real HTTP evidence on source drift');
});
