/** Real localhost HTTP + disposable PG16. No real identity/provider traffic. */
import assert from 'node:assert/strict';import {randomUUID,createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {requireEnterpriseProofEnvironment} from './tenant-enterprise-admin-contract.mjs';
import {createRows as enterpriseReadRows} from './tenant-table-rows/read/platform-controls.mjs';
requireEnterpriseProofEnvironment();
const sourceHead=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
execFileSync('git',['ls-files','--error-unmatch','scripts/qa/tenant-enterprise-admin-http.mjs'],{stdio:'pipe'});
execFileSync('git',['diff','--quiet','HEAD','--','src','scripts/qa/tenant-enterprise-admin-http.mjs','scripts/qa/tenant-enterprise-admin-contract.mjs','scripts/qa/tenant-enterprise-admin-preload.mjs','scripts/qa/tenant-enterprise-admin-local.mjs','fixtures/qa/enterprise-idp-public.pem'],{stdio:'pipe'});
const [{db,pool},s,{eq},f]=await Promise.all([import('../../src/db/index.ts'),import('../../src/db/schema.ts'),import('drizzle-orm'),import('./tenant-table-http.mjs')]);
const TABLES=['organization_security_policies','identity_providers','identity_domains','scim_tokens','permission_sets','user_permission_assignments','user_organizations','automation_rules','automation_executions','dynamic_worker_groups','employees','payroll_runs','audit_events'];
const same=(a,b,label)=>assert.ok(JSON.stringify(a)===JSON.stringify(b),label);
async function snapshot(org){const result={};for(const table of TABLES)result[table]=(await pool.query('SELECT to_jsonb(t) AS row FROM '+table+' t WHERE organization_id=$1 ORDER BY to_jsonb(t)::text',[org])).rows;
 result.head=(await pool.query('SELECT * FROM audit_chain_heads WHERE chain_key=$1',[org])).rows;
 result.sessions=(await pool.query('SELECT id,identity_provider_id,revoked_at FROM sessions WHERE user_id IN (SELECT user_id FROM user_organizations WHERE organization_id=$1) ORDER BY id',[org])).rows;return result;}
async function post(cookie,body,{crossSite=false}={}){const response=await fetch('http://127.0.0.1:3000/api/enterprise',{method:'POST',headers:{cookie,Origin:'http://127.0.0.1:3000','Sec-Fetch-Site':crossSite?'cross-site':'same-origin','Content-Type':'application/json'},body:JSON.stringify(body),redirect:'manual',signal:AbortSignal.timeout(20000)});let json=null;try{json=await response.json();}catch{}return {status:response.status,json};}
const status=(r,n,label)=>{assert.equal(r.status,n,label+' status');return r.json;};
async function admin(org,label){const [u]=await db.insert(s.users).values({email:label+'-'+randomUUID()+'@example.invalid',name:'Fictional '+label,passwordHash:'fictional-session-only',role:'owner',totpEnabled:true}).returning();await db.insert(s.userOrganizations).values({organizationId:org,userId:u.id,role:'owner',active:true});const session=await f.standaloneMakeSession(u.id);await db.update(s.sessions).set({mfaVerifiedAt:new Date()}).where(eq(s.sessions.id,session.id));return {user:u,...session};}
const dnsMap={};mkdirSync('outputs',{recursive:true});writeFileSync('outputs/tenant-enterprise-dns.json','{}');
const certificate=readFileSync('fixtures/qa/enterprise-idp-public.pem','utf8');
const auditActions={policy:'Enterprise security policy updated',oidc:'OIDC provider configured',saml:'SAML provider configured',verify:'SSO domain verified',enable:'OIDC provider enabled',disable:'OIDC provider disabled',token:'SCIM token created',revoke:'SCIM token revoked',permission:'Permission set created',permissionUpdate:'Permission set updated',link:'Workspace worker identity link updated',assign:'Custom permission set assigned',clear:'Custom permission set cleared',rule:'Lifecycle automation created',ruleUpdate:'Lifecycle automation updated',inactive:'Lifecycle automation disabled',active:'Lifecycle automation enabled'};
let own=0,foreign=0,forged=0,vetoes=0;
let readPairs=0,readDiscriminating=0;
try{
 const version=(await pool.query('SHOW server_version_num')).rows[0].server_version_num;assert.ok(Number(version)>=160000&&Number(version)<170000,'real PG16 required');
 assert.equal((await pool.query('SELECT count(*)::int AS n FROM organizations')).rows[0].n,0,'fresh empty fictional database required');
 const nonce=randomUUID().slice(0,8),a=await f.seedEmployer('ATTA',nonce,f.standaloneMakeSession),b=await f.seedEmployer('ATTB',nonce,f.standaloneMakeSession);
 for(let i=0;i<7;i++)await f.seedEmployer('PAD',nonce+i,f.standaloneMakeSession);
 const victim=await f.seedEmployer('VICTIM',nonce,f.standaloneMakeSession);assert.ok(victim.org.id>Math.max(a.org.id,b.org.id,6));
 // Real victim resources, inserted after both attackers' comparator rows.
 for(const actor of [a,b,victim]){
  const [set]=await db.insert(s.permissionSets).values({organizationId:actor.org.id,name:'Fictional seed '+nonce,permissions:['people.admin'],active:true}).returning();actor.seedSet=set;
  const [token]=await db.insert(s.scimTokens).values({organizationId:actor.org.id,name:'Fictional seed',prefix:'fixture',tokenHash:createHash('sha256').update(randomUUID()).digest('hex')}).returning();actor.seedToken=token;
  const [rule]=await db.insert(s.automationRules).values({organizationId:actor.org.id,name:'Fictional seed '+nonce,trigger:'employee.hired',conditions:{},actions:[{type:'create_task',title:'Fictional only'}],active:true}).returning();actor.seedRule=rule;
  const [membership]=await db.select().from(s.userOrganizations).where(eq(s.userOrganizations.userId,actor.owner.id));actor.membership=membership;
  const [provider]=await db.insert(s.identityProviders).values({organizationId:actor.org.id,name:'Fictional seed IdP',protocol:'oidc',issuer:'https://idp-'+actor.org.id+'.enterprise.example.test',clientId:'fictional',enabled:false}).returning();actor.seedProvider=provider;
  const [domain]=await db.insert(s.identityDomains).values({organizationId:actor.org.id,providerId:provider.id,domain:'seed-'+actor.org.id+'.example.test',verificationTokenHash:createHash('sha256').update('fictional-seed').digest('hex'),verified:false}).returning();actor.seedDomain=domain;
  const [group]=await db.insert(s.dynamicWorkerGroups).values({organizationId:actor.org.id,code:'fixture-'+actor.org.id,name:'Fictional active workers',conditions:{all:[{field:'employeeStatus',operator:'eq',value:'Active'}]},active:true,version:1}).returning();actor.seedGroup=group;
 }
 const [readRow]=enterpriseReadRows({assert,db,permissionSets:s.permissionSets});
 for(const actor of [a,b,victim])actor.readSeed=await readRow.seed(actor);
 async function get(actor,org){const r=await fetch('http://127.0.0.1:3000/api/enterprise?organizationId='+org,{headers:{cookie:actor.cookie},redirect:'manual',signal:AbortSignal.timeout(15000)});return {status:r.status,json:await r.json()};}
 const victimRead=await get(victim,victim.org.id);status(victimRead,200,'real victim GET fixture');
 assert.ok(victim.seedSet.id>b.seedSet.id&&victim.seedToken.id>b.seedToken.id&&victim.seedRule.id>b.seedRule.id);
 await pool.query(`CREATE TABLE qa_enterprise_audit_fault (organization_id integer, action text);
 CREATE SEQUENCE qa_enterprise_audit_attempt;
 CREATE FUNCTION qa_enterprise_reject_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF EXISTS (SELECT 1 FROM qa_enterprise_audit_fault f WHERE f.organization_id=NEW.organization_id AND f.action=NEW.action) THEN
 PERFORM nextval('qa_enterprise_audit_attempt'); RAISE EXCEPTION 'fictional enterprise audit veto'; END IF; RETURN NEW; END $$;
 CREATE TRIGGER qa_enterprise_audit_veto BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION qa_enterprise_reject_audit();`);
 const victimBefore=await snapshot(victim.org.id);
 for(const actor of [a,b]){
  const org=actor.org.id,fault=await admin(org,'audit-veto'),target=await admin(org,'worker-target');
  await db.update(s.userOrganizations).set({role:'hr'}).where(eq(s.userOrganizations.userId,target.user.id));
  const [targetMembership]=await db.select().from(s.userOrganizations).where(eq(s.userOrganizations.userId,target.user.id));
  const ctx={};
  const ownRead=await get(actor,org);status(ownRead,200,'own enterprise GET');
  const readContext={orgId:org,seeded:actor.readSeed,marker:actor.marker};
  readRow.prove(ownRead,readContext);
  assert.throws(()=>readRow.prove(victimRead,readContext),'GET validator must reject another employer response');readDiscriminating++;
  status(await get(actor,victim.org.id),403,'foreign enterprise GET');readPairs++;
  same(await snapshot(victim.org.id),victimBefore,'victim unchanged after GET');
  async function run(key,body,expected,check){
   const payload={organizationId:org,...body};
   const before=await snapshot(org),beforeSeq=Number((await pool.query("SELECT CASE WHEN is_called THEN last_value ELSE 0 END AS n FROM qa_enterprise_audit_attempt")).rows[0].n);
   await pool.query('INSERT INTO qa_enterprise_audit_fault VALUES ($1,$2)',[org,auditActions[key]]);
   const rejected=await post(fault.cookie,payload);
   assert.ok(rejected.status>=400,'audit veto must refuse '+key);
   const afterSeq=Number((await pool.query("SELECT last_value AS n FROM qa_enterprise_audit_attempt")).rows[0].n);
   assert.equal(afterSeq,beforeSeq+1,'audit insert must actually be reached for '+key);
   same(await snapshot(org),before,'audit failure must roll back all business state, sessions and chain head: '+key);vetoes++;
   await pool.query('DELETE FROM qa_enterprise_audit_fault WHERE organization_id=$1',[org]);
   const response=await post(actor.cookie,payload),value=status(response,expected,key);
   const after=await snapshot(org);assert.ok(JSON.stringify(after)!==JSON.stringify(before),'own write must persist '+key);
   const audits=await pool.query('SELECT actor,action FROM audit_events WHERE organization_id=$1 ORDER BY id DESC LIMIT 1',[org]);
   assert.equal(audits.rows[0].action,auditActions[key]);assert.equal(audits.rows[0].actor,actor.owner.name);
   if(check)await check(value);own++;
   status(await post(actor.cookie,{...payload,organizationId:victim.org.id}),403,'real victim '+key);foreign++;
   same(await snapshot(victim.org.id),victimBefore,'victim SQL/audit/chain unchanged after '+key);
   console.log(JSON.stringify({kind:'ENTERPRISE_ACTION',key,attacker:actor.label,own:expected,auditVeto:'rollback',foreign:403}));
   return value;
  }
  await run('policy',{action:'save-security-policy',sessionIdleMinutes:90,sessionMaxHours:24,maxActiveSessions:10,requireMfa:true,ssoMode:'optional'},200,x=>assert.equal(x.organizationId,org));
  const oidc=await run('oidc',{action:'create-oidc-provider',name:'Fictional OIDC '+nonce,issuer:'https://idp-'+org+'.enterprise.example.test',clientId:'fictional-client',clientSecret:'fictional-secret-only',domain:'employer-'+org+'.enterprise.example.test'},201,async x=>{
   assert.equal(x.provider.organizationId,org);assert.ok(!Object.hasOwn(x.provider,'clientSecretEncrypted'));
   const row=(await db.select().from(s.identityProviders).where(eq(s.identityProviders.id,x.provider.id)))[0];assert.ok(row.clientSecretEncrypted.startsWith('enc:v1:')&&!row.clientSecretEncrypted.includes('fictional-secret-only'));
  });ctx.provider=oidc.provider.id;
  dnsMap[oidc.domain.domain]=oidc.dnsTxtRecord;writeFileSync('outputs/tenant-enterprise-dns.json',JSON.stringify(dnsMap));
  await run('saml',{action:'create-saml-provider',name:'Fictional SAML '+nonce,entityId:'urn:fictional:'+org,ssoUrl:'https://idp-'+org+'.enterprise.example.test/saml',x509Certificate:certificate,emailAttribute:'email',domain:'saml-'+org+'.example.test'},201,x=>{assert.equal(x.runtimeReady,false);assert.equal(x.provider.enabled,false);ctx.saml=x.provider.id;});
  await run('verify',{action:'verify-domain',domainId:oidc.domain.id},200,x=>assert.equal(x.verified,true));
  await run('enable',{action:'set-provider-enabled',providerId:ctx.provider,enabled:true},200,x=>assert.equal(x.enabled,true));
  const passwordCookies={actor:actor.cookie,fault:fault.cookie};
  for(const principal of [{id:actor.owner.id,target:actor},{id:fault.user.id,target:fault}]){
   const session=await f.standaloneMakeSession(principal.id);
   await db.update(s.sessions).set({identityProviderId:ctx.provider,authMethod:'oidc',mfaVerifiedAt:new Date()}).where(eq(s.sessions.id,session.id));principal.target.cookie=session.cookie;
  }
  // Persisted fictional OIDC session context tests policy administration, not an SSO login/exchange.
  await run('policy',{action:'save-security-policy',sessionIdleMinutes:90,sessionMaxHours:24,maxActiveSessions:10,requireMfa:true,ssoMode:'required'},200,x=>assert.equal(x.ssoMode,'required'));
  status(await post(actor.cookie,{organizationId:org,action:'set-provider-enabled',providerId:ctx.provider,enabled:false}),409,'last verified provider cannot be disabled while SSO required');
  await run('policy',{action:'save-security-policy',sessionIdleMinutes:90,sessionMaxHours:24,maxActiveSessions:10,requireMfa:true,ssoMode:'optional'},200,x=>assert.equal(x.ssoMode,'optional'));
  const boundSession=await f.standaloneMakeSession(target.user.id);await db.update(s.sessions).set({identityProviderId:ctx.provider,authMethod:'oidc'}).where(eq(s.sessions.id,boundSession.id));
  await run('disable',{action:'set-provider-enabled',providerId:ctx.provider,enabled:false},200,x=>{
   assert.equal(x.enabled,false);assert.ok(x.revokedSessions>=3);
   // This successful action revokes the presented OIDC sessions too. Continue
   // foreign-tenant tests with each actor's still-valid local device, rather
   // than counting a generic 401 as genuine employer-membership denial.
   actor.cookie=passwordCookies.actor;fault.cookie=passwordCookies.fault;
  });
  actor.cookie=passwordCookies.actor;fault.cookie=passwordCookies.fault;
  status(await post(actor.cookie,{organizationId:org,action:'set-provider-enabled',providerId:ctx.saml,enabled:true}),409,'SAML runtime remains blocked');
  const token=await run('token',{action:'create-scim-token',name:'Fictional token '+nonce},201,async x=>{const row=(await db.select().from(s.scimTokens).where(eq(s.scimTokens.id,x.id)))[0];assert.equal(row.tokenHash,createHash('sha256').update(x.token).digest('hex'));assert.notEqual(row.tokenHash,x.token);});
  await run('revoke',{action:'revoke-scim-token',tokenId:token.id},200,async()=>assert.ok((await db.select().from(s.scimTokens).where(eq(s.scimTokens.id,token.id)))[0].revokedAt));
  const set=await run('permission',{action:'save-permission-set',name:'Fictional set '+nonce,permissions:['people.admin']},201,x=>assert.equal(x.organizationId,org));
  await run('permissionUpdate',{action:'save-permission-set',id:set.id,name:'Fictional updated '+nonce,permissions:['people.admin','workforce.manage'],active:true},200,x=>assert.equal(x.permissions.length,2));
  await run('link',{action:'link-membership-worker',membershipId:targetMembership.id,employeeId:actor.worker.id},200,x=>assert.equal(x.workerEmployeeId,actor.worker.id));
  await run('assign',{action:'assign-permission-set',membershipId:targetMembership.id,permissionSetId:set.id},200,x=>assert.equal(x.permissionSetId,set.id));
  await run('assign',{action:'assign-permission-set',membershipId:targetMembership.id,permissionSetId:set.id,dynamicGroupId:actor.seedGroup.id},200,x=>{assert.equal(x.dynamicGroupId,actor.seedGroup.id);assert.equal(x.dynamicGroupVersion,1);});
  await run('clear',{action:'assign-permission-set',membershipId:targetMembership.id,permissionSetId:null},200,x=>assert.equal(x.permissionSetId,null));
  await run('link',{action:'link-membership-worker',membershipId:targetMembership.id,employeeId:null},200,x=>assert.equal(x.workerEmployeeId,null));
  const rule=await run('rule',{action:'save-automation-rule',name:'Fictional rule '+nonce,trigger:'employee.hired',conditions:{},actions:[{type:'create_task',title:'Fictional task'}]},201,x=>assert.equal(x.organizationId,org));
  await run('ruleUpdate',{action:'save-automation-rule',id:rule.id,name:'Fictional revised '+nonce,trigger:'employee.moved',conditions:{},actions:[{type:'create_task',title:'Fictional revised task'}]},200,x=>assert.equal(x.trigger,'employee.moved'));
  await run('inactive',{action:'set-automation-active',ruleId:rule.id,active:false},200,x=>assert.equal(x.active,false));
  await run('active',{action:'set-automation-active',ruleId:rule.id,active:true},200,x=>assert.equal(x.active,true));
  // Forged selectors retain own employer while naming real higher-ID victim objects.
  for(const body of [
   {action:'verify-domain',domainId:victim.seedDomain.id},
   {action:'set-provider-enabled',providerId:victim.seedProvider.id,enabled:false},
   {action:'revoke-scim-token',tokenId:victim.seedToken.id},
   {action:'save-permission-set',id:victim.seedSet.id,name:'forged',permissions:['people.admin']},
   {action:'assign-permission-set',membershipId:victim.membership.id,permissionSetId:set.id},
   {action:'assign-permission-set',membershipId:targetMembership.id,permissionSetId:victim.seedSet.id},
   {action:'link-membership-worker',membershipId:victim.membership.id,employeeId:actor.worker.id},
   {action:'set-automation-active',ruleId:victim.seedRule.id,active:false},
   {action:'save-automation-rule',id:victim.seedRule.id,name:'forged',trigger:'employee.hired',conditions:{},actions:[{type:'create_task',title:'forged'}]},
  ]){status(await post(actor.cookie,{organizationId:org,...body}),404,'forged '+body.action);forged++;same(await snapshot(victim.org.id),victimBefore,'forged reference must leave victim unchanged');}
  for(const body of [
   {action:'assign-permission-set',membershipId:targetMembership.id,permissionSetId:set.id,dynamicGroupId:victim.seedGroup.id},
   {action:'link-membership-worker',membershipId:targetMembership.id,employeeId:victim.worker.id},
  ]){status(await post(actor.cookie,{organizationId:org,...body}),409,'foreign group/worker rejected');forged++;same(await snapshot(victim.org.id),victimBefore,'foreign worker/group must not change victim');}
  const noMfa=await f.standaloneMakeSession(actor.owner.id);
  status(await post(noMfa.cookie,{organizationId:org,action:'create-scim-token',name:'must not mint'}),401,'workspace MFA policy must reject an unverified session');
  assert.ok((await db.select().from(s.sessions).where(eq(s.sessions.id,noMfa.id)))[0].revokedAt,'unverified session is revoked, not accepted as a tenant denial');
  status(await post(target.cookie,{organizationId:org,action:'create-scim-token',name:'must not mint'}),403,'non-admin must not mint');
  status(await post(actor.cookie,{organizationId:org,action:'save-security-policy',sessionIdleMinutes:90,sessionMaxHours:24,maxActiveSessions:10,requireMfa:true,ssoMode:'optional'},{crossSite:true}),403,'cross-site mutation');
 }
 same(await snapshot(victim.org.id),victimBefore,'final victim unchanged');
 const blob=file=>{const b=Buffer.from(readFileSync(file,'utf8').replaceAll('\r\n','\n'));return createHash('sha1').update('blob '+b.length+'\0').update(b).digest('hex');};
 const receipt={kind:'ENTERPRISE_ADMIN_HTTP',label:'SOLO_VERIFIED_DEV_RECOVERY',result:'PASS',sourceHead,routeBlobSha:blob('src/app/api/enterprise/route.ts'),proofBlobSha:blob('scripts/qa/tenant-enterprise-admin-http.mjs'),attackers:2,ownTransitions:own,auditVetoRollbacks:vetoes,foreignDenials:foreign,forgedDenials:forged,readPairs,readDiscriminating,coverageCredits:0,actualProviderTraffic:false,productionCertified:false};
 writeFileSync('outputs/tenant-enterprise-admin-receipt.json',JSON.stringify(receipt,null,2)+'\n');
 console.log(JSON.stringify(receipt));
}finally{
 await pool.query('DROP TRIGGER IF EXISTS qa_enterprise_audit_veto ON audit_events; DROP FUNCTION IF EXISTS qa_enterprise_reject_audit(); DROP TABLE IF EXISTS qa_enterprise_audit_fault; DROP SEQUENCE IF EXISTS qa_enterprise_audit_attempt;').catch(()=>{});
 await pool.end();
}
