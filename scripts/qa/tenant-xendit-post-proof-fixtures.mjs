/** Load only the preseeded disposable PG16 rows; never read session files. */
import assert from 'node:assert/strict';
export async function loadXenditPostFixtures(db,s,eq,fixture){
 const one=async(query,label)=>{const rows=await query;assert.equal(rows.length,1,label);return rows[0];};
 const organizations=await db.select().from(s.organizations);
 assert.equal(organizations.length,10,'Exactly the empty-database fictional seed cohort is required');
 let nonce;
 async function employer(label,port){
  const matches=organizations.filter(org=>new RegExp('^TTBL-'+label+'-[a-f0-9]{8} employer$').test(org.name));
  assert.equal(matches.length,1,'Unique fictional employer required: '+label);
  const org=matches[0],marker=org.name.slice(0,-' employer'.length);
  const suffix=marker.slice(-8);if(nonce)assert.equal(suffix,nonce);else nonce=suffix;
  const entity=await one(db.select().from(s.legalEntities).where(eq(s.legalEntities.organizationId,org.id)),'one legal employer');
  const worker=await one(db.select().from(s.employees).where(eq(s.employees.organizationId,org.id)),'one persisted worker');
  assert.equal(worker.employeeNo,marker);assert.equal(worker.legalEntityId,entity.id);
  const owner=await one(db.select().from(s.users).where(eq(s.users.email,marker.toLowerCase()+'@example.invalid')),'one owner');
  const releaserUser=await one(db.select().from(s.users).where(eq(s.users.email,marker+'-separate-releaser@example.invalid')),'one separate releaser');
  const limitedUser=await one(db.select().from(s.users).where(eq(s.users.email,marker+'-read-only-worker@example.invalid')),'one restricted worker');
  async function session(user,mfa=true){
   const created=await fixture.standaloneMakeSession(user.id);
   if(mfa)await db.update(s.sessions).set({mfaVerifiedAt:new Date()}).where(eq(s.sessions.id,created.id));
   return created.cookie;
  }
  const cookie=await session(owner),noMfaCookie=await session(owner,false);
  const releaser={user:releaserUser,cookie:await session(releaserUser)};
  const limited={user:limitedUser,cookie:await session(limitedUser)};
  const rows=await db.select().from(s.payrollRuns).where(eq(s.payrollRuns.organizationId,org.id));
  assert.equal(rows.length,3);const runs={};
  for(const name of ['normal','ambiguous','provider-changed']){
   const matching=rows.filter(row=>row.periodLabel===marker+' '+name);assert.equal(matching.length,1);
   const run=matching[0];assert.equal(run.legalEntityId,entity.id);assert.equal(run.status,'Released');
   const entry=await one(db.select().from(s.payrollEntries).where(eq(s.payrollEntries.payrollRunId,run.id)),'one frozen payout entry');
   assert.equal(entry.employeeId,worker.id);assert.equal(entry.netPay,'18000.00');
   runs[name]={run,entry,referenceNumber:'PAY-'+run.id+'-'+worker.employeeNo,
    payoutId:'po-fictional-'+String(run.id).padStart(8,'0')};
  }
  return{org,entity,worker,owner,marker,cookie,noMfaCookie,releaser,limited,runs,port};
 }
 const a=await employer('ATTA',3000),b=await employer('ATTB',3001),victim=await employer('VICTIM',3002);
 for(const key of ['org','entity','worker','owner'])assert.ok(victim[key].id>Math.max(a[key].id,b[key].id,6));
 for(const name of ['normal','ambiguous','provider-changed'])assert.ok(victim.runs[name].run.id>Math.max(a.runs[name].run.id,b.runs[name].run.id,6));
 assert.equal(String(a.org.id),process.env.XENDIT_PAYOUT_ALLOWED_ORGANIZATION_ID);
 assert.equal(String(a.entity.id),process.env.XENDIT_PAYOUT_ALLOWED_LEGAL_ENTITY_ID);
 return{a,b,victim};
}
