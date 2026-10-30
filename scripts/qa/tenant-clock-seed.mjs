import assert from 'node:assert/strict';import{randomUUID}from'node:crypto';import{mkdirSync,writeFileSync}from'node:fs';import{guard}from'./tenant-clock-contract.mjs';
guard();
const{db,pool}=await import('../../src/db/index.ts'),s=await import('../../src/db/schema.ts'),{eq}=await import('drizzle-orm');
const{seedEmployer,standaloneMakeSession,addWorker}=await import('./tenant-table-http.mjs');
const{encryptPunchPhoto}=await import('../../src/lib/workforce-punch-photo-crypto.ts');
const sharp=(await import('sharp')).default;
try{
 assert.equal(Math.floor(Number((await pool.query('show server_version_num')).rows[0].server_version_num)/10000),16);
 assert.equal(Number((await pool.query('select count(*)::int as n from organizations')).rows[0].n),0,'fresh owned fixture database only');
 const nonce=randomUUID().slice(0,7);for(let i=0;i<6;i++)await seedEmployer('PAD'+i,nonce,standaloneMakeSession);
 const groups={legacy:[],enhanced:[]};
 for(const group of Object.keys(groups))for(const label of['ATTA','ATTB','VICTIM']){
  const e=await seedEmployer(label,nonce+'-'+group[0],standaloneMakeSession);
  async function ess(worker,suffix){const[u]=await db.insert(s.users).values({employeeId:worker.id,email:e.marker.toLowerCase()+'-'+suffix+'@example.invalid',name:e.marker+' '+suffix,role:'employee',passwordHash:'fictional-session-only',totpEnabled:true}).returning();await db.insert(s.userOrganizations).values({organizationId:e.org.id,userId:u.id,role:'employee',active:true});const session=await standaloneMakeSession(u.id);await db.update(s.sessions).set({mfaVerifiedAt:new Date()}).where(eq(s.sessions.id,session.id));return{user:u,cookie:session.cookie,worker};}
  e.ess=await ess(e.worker,'employee');e.second=await ess(await addWorker(e,'second'),'second');
  e.unverifiedOwnerCookie=(await standaloneMakeSession(e.owner.id)).cookie;
  const bytes=await sharp({create:{width:1,height:1,channels:3,background:{r:label==='ATTA'?30:label==='ATTB'?90:150,g:80,b:40}}}).jpeg().toBuffer();e.photoBytes=bytes.toString('base64');
  e.photoId=randomUUID();e.heldPhotoId=randomUUID();
  await db.insert(s.workforcePunchPhotoEvidence).values([{id:e.photoId,organizationId:e.org.id,employeeId:e.worker.id,sealedPhoto:encryptPunchPhoto(bytes),expiresAt:new Date(Date.now()+86400000)},{id:e.heldPhotoId,organizationId:e.org.id,employeeId:e.worker.id,sealedPhoto:encryptPunchPhoto(bytes),expiresAt:new Date(Date.now()+86400000),legalHold:true}]);
  // Actual, nonempty victim punch exists before adversarial HTTP; own clock workers remain unclocked.
  if(label==='VICTIM')await db.insert(s.timePunches).values({organizationId:e.org.id,employeeId:e.worker.id,workDate:new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila'}).format(new Date()),timeIn:new Date(Date.now()-3600000),source:'web_bundy',status:'Incomplete'});
  groups[group].push(e);
 }
 // Real victim-exclusive evidence IDs are higher than future attacker own IDs only if created last.
 // Reserve real seeded rows for all groups, then create victim records after both own records.
 for(const group of Object.values(groups))for(const e of group){const count=e.label==='VICTIM'?10:4;for(let i=0;i<count;i++)await db.insert(s.workforcePunchSubmissions).values({organizationId:e.org.id,employeeId:e.second.worker.id,clientPunchId:randomUUID(),actionType:'clock_in',workDate:'2026-01-05',deviceOccurredAt:new Date('2026-01-05T01:00:00Z'),receivedSource:'online',deviceDigest:'fictional-fixture-'+e.marker,requestedByUserId:e.second.user.id,status:'pending'});const[v]=await db.insert(s.workforcePunchSubmissions).values({organizationId:e.org.id,employeeId:e.second.worker.id,clientPunchId:randomUUID(),actionType:'clock_in',workDate:'2026-01-05',deviceOccurredAt:new Date('2026-01-05T01:00:00Z'),receivedSource:'online',deviceDigest:'fictional-fixture-'+e.marker,requestedByUserId:e.second.user.id,status:'pending'}).returning();e.seededSubmissionId=v.id;}
 const ids=groups.enhanced.map(e=>e.org.id);mkdirSync('outputs',{recursive:true});writeFileSync('outputs/clock-fixture.json',JSON.stringify(groups),{mode:0o600});writeFileSync('outputs/clock-allowlist.env','WFM_PUNCH_EVIDENCE_ORG_IDS='+ids.join(',')+'\n');console.log('Prepared fictional clock fixture; sessions remain in local private output');
}finally{await pool.end();}
