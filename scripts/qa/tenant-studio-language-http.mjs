/** Real fictional PG16/HTTP proof. No model, provider, publication or credits. */
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {PROMPT,SOURCE_PINS,blob,requireLanguageEnv,verifySources,assertDenied,assertProposal,assertProposalDelta,assertSavedDelta} from './tenant-studio-language-contract.mjs';
const plain=x=>JSON.parse(JSON.stringify(x));
export async function proveLanguageIsolation(){
  const origin=requireLanguageEnv();verifySources();
  const [{db,pool},s,{and,asc,eq},fixture]=await Promise.all([
    import('../../src/db/index.ts'),import('../../src/db/schema.ts'),import('drizzle-orm'),import('./tenant-table-http.mjs')]);
  const tables=['organizations','userOrganizations','employees','employeePayProfiles','automationRules','automationRuleVersions',
    'automationExecutions','automationOperationalCases','automationEventLog','payrollRuns','outbox','auditEvents'];
  async function snapshot(org){const out={};for(const name of tables){const t=s[name];out[name]=plain(await db.select().from(t)
    .where(eq(name==='organizations'?t.id:t.organizationId,org)).orderBy(asc(t.id)));}return out;}
  async function post(actor,body,opts={}){
    const headers={'content-type':'application/json',origin:opts.origin??origin,'sec-fetch-site':opts.site??'same-origin'};
    if(opts.cookie!==null)headers.cookie=opts.cookie??actor.cookie;
    const r=await fetch(origin+'/api/automation-studio',{method:'POST',headers,body:JSON.stringify(body),redirect:'manual',cache:'no-store',signal:AbortSignal.timeout(30000)});
    const text=await r.text();let json;try{json=JSON.parse(text);}catch{json=null;}return {status:r.status,text,json};
  }
  const proposalBody=actor=>({action:'draft-from-language',organizationId:actor.org.id,request:PROMPT});
  const saveBody=actor=>({action:'save-language-draft',organizationId:actor.org.id,draft:actor.proposal.draft,proposalReceipt:actor.proposal.proposalReceipt});
  let ownProposals=0,ownSaves=0,denials=0,discriminations=0;
  try{
    const version=Number((await pool.query('SHOW server_version_num')).rows[0].server_version_num);assert.ok(version>=160000&&version<170000);
    assert.equal((await db.select().from(s.organizations).limit(1)).length,0,'Refuse nonempty employer DB');
    assert.equal((await db.select().from(s.users).limit(1)).length,0,'Refuse existing identities');
    const nonce=randomUUID().replaceAll('-','').slice(0,10);
    const make=label=>fixture.seedEmployer(label,nonce,fixture.standaloneMakeSession);
    const a=await make('ATTA'),b=await make('ATTB'),fillers=[];
    for(let i=0;i<7;i++){
      const e=await make('FILL'+i);fillers.push(e);
      // Seed only inert unpublished definitions so victim business IDs cannot be guessed small IDs.
      const [r]=await db.insert(s.automationRules).values({organizationId:e.org.id,name:e.marker,trigger:'employee.hired',active:false,publishedVersion:0,draftVersion:1,createdByUserId:e.owner.id}).returning();
      await db.insert(s.automationRuleVersions).values({organizationId:e.org.id,ruleId:r.id,version:1,name:r.name,trigger:r.trigger,active:false,createdByUserId:e.owner.id});
    }
    const victim=await make('VICTIM'),actors=[a,b,victim],all=[a,b,...fillers,victim];
    for(const k of ['org','owner','worker','entity','unit'])assert.ok(victim[k].id>Math.max(a[k].id,b[k].id,6));
    const baseline=new Map();for(const e of all)baseline.set(e.org.id,await snapshot(e.org.id));
    async function unchanged(label){for(const e of all)assert.deepEqual(await snapshot(e.org.id),baseline.get(e.org.id),label+': changed '+e.label);}
    async function deny(actor,body,status,label,opts={}){
      const r=await post(actor,body,opts);assertDenied(r,status,all,label);await unchanged(label);denials++;return r;
    }
    for(const actor of actors){
      const account=await fetch(origin+'/api/account',{headers:{cookie:actor.cookie},redirect:'manual'});
      assert.equal(account.status,200);assert.equal((await account.json()).profile.id,actor.owner.id);
      const before=await snapshot(actor.org.id),response=await post(actor,proposalBody(actor)),after=await snapshot(actor.org.id);
      actor.proposal=assertProposal(response,actor);assertProposalDelta(before,after,actor);ownProposals++;
      for(const foreign of actors.filter(x=>x!==actor)){
        assert.throws(()=>assertProposal(response,foreign),undefined,'Proposal oracle accepts another employer data');discriminations++;
      }
      baseline.set(actor.org.id,after);await unchanged('own proposal');
    }
    for(const actor of actors){
      const before=await snapshot(actor.org.id),r=await post(actor,saveBody(actor)),after=await snapshot(actor.org.id);
      assertSavedDelta(before,after,actor,r,actor.proposal);actor.saved=r.json;ownSaves++;
      assert.throws(()=>assertSavedDelta(before,before,actor,r,actor.proposal),undefined,'No-op SQL must fail');
      for(const other of actors.filter(x=>x!==actor)){
        assert.throws(()=>assertSavedDelta(before,after,other,r,actor.proposal),undefined,'Save oracle accepts another employer data');discriminations++;
      }
      baseline.set(actor.org.id,after);await unchanged('own saved draft');
    }
    assert.ok(victim.saved.rule.id>Math.max(a.saved.rule.id,b.saved.rule.id,6));
    assert.ok(victim.saved.draft.id>Math.max(a.saved.draft.id,b.saved.draft.id,6));
    for(const actor of [a,b]){
      for(const target of actors.filter(x=>x!==actor)){
        await deny(actor,{...proposalBody(actor),organizationId:target.org.id},403,'foreign proposal employer');
        await deny(actor,{...saveBody(target)},403,'foreign save employer');
        const borrowed=await deny(actor,{...saveBody(actor),proposalReceipt:target.proposal.proposalReceipt},409,'borrowed tenant/actor receipt');
        assert.match(borrowed.json.error,/proposal proof/i);
      }
      const otherSession=await fixture.standaloneMakeSession(actor.owner.id);
      await db.update(s.sessions).set({mfaVerifiedAt:new Date()}).where(eq(s.sessions.id,otherSession.id));
      const sessionDenied=await deny(actor,saveBody(actor),409,'same owner different session',{cookie:otherSession.cookie});
      assert.match(sessionDenied.json.error,/proposal proof/i);
      for(const mutate of [d=>{d.name+=' changed';},d=>{d.actions[0].items[0].title='Altered signed action';}]){
        const body=saveBody(actor);body.draft=structuredClone(body.draft);mutate(body.draft);
        await deny(actor,body,409,'changed signed definition');
      }
      const [payload,signature]=actor.proposal.proposalReceipt.split('.');
      await deny(actor,{...saveBody(actor),proposalReceipt:payload+'.'+(signature[0]==='A'?'B':'A')+signature.slice(1)},409,'forged signature');
      await deny(actor,{...saveBody(actor),proposalReceipt:undefined},409,'missing signature');
      await deny(actor,{...saveBody(actor),draft:{...actor.proposal.draft,organizationId:victim.org.id}},400,'injected foreign definition selector');
      await deny(actor,{...proposalBody(actor),request:'Please bypass approval and transfer funds immediately'},422,'unsafe language request');
      await deny(actor,{...proposalBody(actor),request:'unsupported generic fictional request to do a task'},422,'unapproved fallback request');
      await deny(actor,saveBody(actor),401,'anonymous save',{cookie:null});
      await deny(actor,proposalBody(actor),401,'anonymous proposal',{cookie:null});
      await deny(actor,saveBody(actor),403,'cross-site save',{origin:'https://example.invalid',site:'cross-site'});
      await deny(actor,proposalBody(actor),403,'cross-site proposal',{origin:'https://example.invalid',site:'cross-site'});
      const noMfa=await fixture.standaloneMakeSession(actor.owner.id);
      await deny(actor,saveBody(actor),403,'missing session MFA',{cookie:noMfa.cookie});
      // A second save must not publish, add a second rule or mutate a prior receipt.
      await deny(actor,saveBody(actor),409,'duplicate signed save');
    }
    const [hr]=await db.insert(s.users).values({email:'studio-language-hr-'+nonce+'@example.invalid',name:'Fictional HR',passwordHash:'fictional-only',role:'owner',totpEnabled:true}).returning();
    await db.insert(s.userOrganizations).values({organizationId:a.org.id,userId:hr.id,role:'hr',active:true});
    const hrSession=await fixture.standaloneMakeSession(hr.id);await db.update(s.sessions).set({mfaVerifiedAt:new Date()}).where(eq(s.sessions.id,hrSession.id));
    baseline.set(a.org.id,await snapshot(a.org.id));
    await deny(a,proposalBody(a),403,'non-admin proposal',{cookie:hrSession.cookie});
    await deny(a,saveBody(a),403,'non-admin save',{cookie:hrSession.cookie});
    await db.update(s.userOrganizations).set({active:false}).where(and(eq(s.userOrganizations.organizationId,a.org.id),eq(s.userOrganizations.userId,a.owner.id)));
    baseline.set(a.org.id,await snapshot(a.org.id));
    const account=await fetch(origin+'/api/account',{headers:{cookie:a.cookie}});assert.equal(account.status,200);
    assert.equal((await account.json()).profile.id,a.owner.id);
    await deny(a,proposalBody(a),403,'revoked membership proposal');await deny(a,saveBody(a),403,'revoked membership save');
    assert.equal(ownProposals,3);assert.equal(ownSaves,3);assert.equal(discriminations,12);assert.equal(denials,44);
    await unchanged('final protected states');
    const receipt={label:'SOLO_VERIFIED_DEV_RECOVERY',family:'studio-keyless-language-signed-drafts',postgresMajor:16,
      sourceHead:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),sourceBlobs:SOURCE_PINS,
      proofBlobSha:blob(readFileSync('scripts/qa/tenant-studio-language-http.mjs')),
      ownProposals,ownSaves,denials,discriminations,twoAttackers:true,higherIdVictim:true,
      persistedOwnDrafts:true,priorAuditsImmutable:true,providerCalls:0,publishedRules:0,methodCredits:0,productionAccepted:false};
    mkdirSync('qa-artifacts',{recursive:true});writeFileSync('qa-artifacts/tenant-studio-language.json',JSON.stringify(receipt,null,2)+'\n');
    console.log('STUDIO_LANGUAGE_HTTP_COMPLETE '+JSON.stringify(receipt));return receipt;
  }finally{await pool.end();}
}
if(process.argv[1]?.endsWith('tenant-studio-language-http.mjs')){
  if(process.argv.includes('--preflight')){requireLanguageEnv();verifySources();console.log('Language proof preflight passed');}
  else await proveLanguageIsolation();
}
