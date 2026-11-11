import assert from 'node:assert/strict';import test from 'node:test';import {readFileSync} from 'node:fs';
import yaml from 'js-yaml';
import {REQUIRED_ENV,FORBIDDEN_ENV,SOURCE_PINS,requireLanguageEnv,verifySources,assertDenied,assertProposal,assertProposalDelta,assertSavedDelta} from '../scripts/qa/tenant-studio-language-contract.mjs';
const actor={org:{id:8},owner:{id:12,name:'Fictional own owner'},marker:'FICTIONAL-OWN'};
const victim={org:{id:19},owner:{id:29,name:'Fictional victim'},marker:'FICTIONAL-VICTIM'};
const safe={...REQUIRED_ENV,APP_BASE_URL:'http://127.0.0.1:3319',SECURITY_SMOKE_URL:'http://127.0.0.1:3319',TRUSTED_APP_ORIGINS:'http://127.0.0.1:3319',DATABASE_URL:'postgresql://postgres:postgres@127.0.0.1:55439/app_db'};
const draft={name:'New hire core onboarding',trigger:'employee.hired',conditions:{version:1,all:[],any:[]},actions:[{type:'create_task',title:'Fictional verification',owner:'People Ops',kind:'automation'}]};
const payload={org:8,actor:12,session:51,source:'approved-template',purpose:'language-draft-save'};
const response=()=>({status:200,json:{draft:structuredClone(draft),validation:{valid:true},source:'approved-template',proposalReceipt:Buffer.from(JSON.stringify(payload)).toString('base64url')+'.fictionalSignature'},text:'fictional local proposal'});
const before=()=>({automationRules:[],automationRuleVersions:[],auditEvents:[{id:1,organizationId:8,action:'prior immutable audit'}],outbox:[],automationExecutions:[],employees:[{id:4,organizationId:8}]});
function saved(){const b=before(),proposal=response().json;
 const rule={id:16,organizationId:8,createdByUserId:12,active:false,publishedVersion:0,draftVersion:1,...structuredClone(draft)};
 const version={...structuredClone(rule),id:21,ruleId:16,version:1,status:'draft'};
 const r={status:201,json:{created:true,rule,draft:version}};
 const a={...structuredClone(b),automationRules:[rule],automationRuleVersions:[version],auditEvents:[...b.auditEvents,{id:2,organizationId:8,actor:actor.owner.name,action:'Automation Studio signed language draft saved',metadata:{ruleId:16,source:'approved-template',active:false}}]};
 return {b,a,r,proposal};
}
test('only explicit disposable loopback targets with model/provider and money locks off are accepted',()=>{
 assert.equal(requireLanguageEnv(safe),safe.APP_BASE_URL);
 for(const key of Object.keys(REQUIRED_ENV)){const e={...safe};delete e[key];assert.throws(()=>requireLanguageEnv(e),undefined,key);}
 for(const key of FORBIDDEN_ENV)assert.throws(()=>requireLanguageEnv({...safe,[key]:'fictional-not-a-secret'}),undefined,key);
 for(const patch of [{DATABASE_URL:'postgresql://postgres:postgres@production.invalid:5432/app_db'},{DATABASE_URL:'postgresql://postgres:postgres@127.0.0.1:5432/existing'},{APP_BASE_URL:'https://example.invalid'},{APP_BASE_URL:'http://127.0.0.1:3319/extra'},{TRUSTED_APP_ORIGINS:'https://example.invalid'}])assert.throws(()=>requireLanguageEnv({...safe,...patch}));
});
test('every current source blob is sealed and any source drift blocks the proof',()=>{
 assert.doesNotThrow(()=>verifySources());
 for(const path of Object.keys(SOURCE_PINS))assert.throws(()=>verifySources(p=>p===path?Buffer.concat([readFileSync(p),Buffer.from(' changed')]):readFileSync(p)),/source drift/,path);
});
test('proposal oracle requires a real template, typed draft and own actor/employer-bound receipt',()=>{
 assert.doesNotThrow(()=>assertProposal(response(),actor));
 assert.throws(()=>assertProposal(response(),victim),undefined,'accepts another employer data');
 for(const mutate of [r=>r.status=403,r=>r.json.source='model',r=>r.json.validation.valid=false,r=>r.json.draft.actions=[],r=>delete r.json.proposalReceipt]){
  const r=response();mutate(r);assert.throws(()=>assertProposal(r,actor));
 }
});
test('proposal success permits exactly one attributed metadata-only audit and no persisted workflow',()=>{
 const b=before(),a=structuredClone(b);a.auditEvents.push({organizationId:8,actor:actor.owner.name,action:'Automation Studio language draft proposed',metadata:{actionTypes:['create_task'],source:'approved-template',trigger:'employee.hired'}});
 assert.doesNotThrow(()=>assertProposalDelta(b,a,actor));
 for(const mutate of [a=>a.auditEvents.at(-1).metadata.prompt='fictional raw request',a=>a.outbox.push({id:1}),a=>a.auditEvents[0].action='changed',a=>a.auditEvents.at(-1).organizationId=19]){const bad=structuredClone(a);mutate(bad);assert.throws(()=>assertProposalDelta(b,bad,actor));}
});
test('a signed save must equal persisted own SQL, preserve historical audit and remain unpublished',()=>{
 const {b,a,r,proposal}=saved();assert.doesNotThrow(()=>assertSavedDelta(b,a,actor,r,proposal));
 assert.throws(()=>assertSavedDelta(b,a,victim,r,proposal),undefined,'accepts another employer data');
 assert.throws(()=>assertSavedDelta(b,b,actor,r,proposal),undefined,'no-op SQL success must fail');
 for(const mutate of [a=>a.automationRules[0].active=true,a=>a.automationRuleVersions[0].organizationId=19,a=>a.automationRules[0].createdByUserId=29,a=>a.outbox.push({id:1}),a=>a.auditEvents[0].action='rewritten',a=>a.auditEvents.at(-1).metadata.source='model']){
  const bad=structuredClone(a);mutate(bad);assert.throws(()=>assertSavedDelta(b,bad,actor,r,proposal));
 }
});
test('exact refusal must not disclose a result or escaped employer markers',()=>{
 const ok={status:409,json:{error:'Proposal proof does not match'},text:'Proposal proof does not match'};
 assert.doesNotThrow(()=>assertDenied(ok,409,[actor,victim],'denied'));
 for(const r of [{...ok,status:200},{...ok,json:{draft:{}}},{...ok,text:'FICTIONAL-\\u0056ICTIM'}])assert.throws(()=>assertDenied(r,409,[actor,victim],'denied'));
});
test('dedicated workflow executes guarded real HTTP and retains a sanitized receipt; no fabricated credits',()=>{
 const w=yaml.load(readFileSync('.github/workflows/tenant-studio-language-qa.yml','utf8'));
 const job=w.jobs['signed-language-drafts'];assert.equal(job.services.postgres.image,'postgres:16');
 const checkout=job.steps.find(x=>x.uses?.startsWith('actions/checkout@'));assert.equal(checkout.with.ref,'${{ github.event.pull_request.head.sha || github.sha }}');
 const setup=job.steps.findIndex(x=>x.run?.includes('--preflight')),db=job.steps.findIndex(x=>x.run==='npm run db:push');assert.ok(setup>=0&&db>setup);
 for(const [key,value]of Object.entries(REQUIRED_ENV))assert.equal(job.env[key],value,key);
 assert.ok(job.steps.some(x=>x.run==='node --import tsx scripts/qa/tenant-studio-language-http.mjs'));
 const artifact=job.steps.find(x=>x.uses?.startsWith('actions/upload-artifact@'));assert.equal(artifact.with['if-no-files-found'],'error');
 const runner=readFileSync('scripts/qa/tenant-studio-language-http.mjs','utf8');
 for(const token of ['assertProposalDelta(before,after,actor)','assertSavedDelta(before,after,actor,r,actor.proposal)','assert.equal(denials,44)','assert.equal(discriminations,12)','methodCredits:0','providerCalls:0','victim.saved.draft.id','same owner different session','revoked membership save'])assert.ok(runner.includes(token),token);
 assert.doesNotMatch(JSON.stringify(w),/secrets\.|continue-on-error/);
});
