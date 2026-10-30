import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {guard,ACTIONS,verifyOwnChange,rejectOtherEmployer} from '../scripts/qa/tenant-performance-core-contract.mjs';
import {verifyReceipt,verifyCredit} from '../scripts/qa/tenant-performance-core-credit.mjs';
const read=p=>readFileSync(p,'utf8');
test('complete method evidence fails when a new meaningful action is added to a handler',()=>{
 const route=read('src/app/api/performance/route.ts');
 const portions={'POST performance':route.slice(route.indexOf('export async function POST'),route.indexOf('export async function PATCH')),
 'PATCH performance':route.slice(route.indexOf('export async function PATCH')),
 'PATCH performance/calibration':read('src/app/api/performance/calibration/route.ts').split('export async function PATCH')[1],
 'PATCH performance/follow-through-governance':read('src/app/api/performance/follow-through-governance/route.ts').split('export async function PATCH')[1]};
 const normalize=action=>action.split('-')[0];
 for(const [key,source] of Object.entries(portions)){
   const field=key.includes('/')?'action':'entityType';
   const actions=[...source.matchAll(new RegExp('if \\('+field+' === "([^"]+)"','g'))].map(m=>m[1]);
   assert.deepEqual([...new Set(ACTIONS[key].map(normalize))].sort(),[...new Set(actions)].sort(),key);
 }
});
test('guard refuses hosted/production/provider targets and ambiguous selectors',()=>{
 const good={TENANT_PERFORMANCE_CORE_MODE:'fictional-disposable-only',SECURITY_SMOKE_URL:'http://127.0.0.1:3013',DATABASE_URL:'postgresql://postgres@127.0.0.1:5433/app_db'};
 assert.doesNotThrow(()=>guard(good));
 for(const change of [{DATABASE_URL:'postgresql://postgres@db.example.invalid/app_db'},
 {DATABASE_URL:good.DATABASE_URL+'?host=db.example.invalid'}, {NODE_ENV:'production'},
 {SECURITY_SMOKE_URL:'https://payroll.example.invalid'},{TENANT_PERFORMANCE_CORE_MODE:''},
 {PAYMONGO_SECRET_KEY:'fictional-secret'}, {WORKER_ENABLED:'true'}])assert.throws(()=>guard({...good,...change}));
});
test('own persisted effect and audit validators discriminate; a no-op validator cannot pass',()=>{
 const a={org:{id:3},owner:{name:'Fictional A'}},b={org:{id:4},owner:{name:'Fictional B'}};
 const before={items:[],auditEvents:[],payrollRuns:[],employeePayProfiles:[]};
 const after={...before,items:[{id:11,organizationId:3,title:'Owned'}],auditEvents:[{id:1,organizationId:3,actor:'Fictional A',action:'Performance goal created'}]};
 const claim={table:'items',id:11,created:true,fields:{title:'Owned'}};
 assert.equal(verifyOwnChange(before,after,a,claim).id,11);
 assert.throws(()=>verifyOwnChange(before,after,b,claim));
 assert.throws(()=>verifyOwnChange(before,{...after,items:[]},a,claim));
 assert.throws(()=>verifyOwnChange(before,{...after,auditEvents:[]},a,claim));
 rejectOtherEmployer(verifyOwnChange,{before,after,claim},b);
 assert.throws(()=>rejectOtherEmployer(()=>{}, {before,after,claim},b),/proof accepts another employer's data/);
});
test('team-goal employer check precedes scope and INSERT; existing GET is unchanged',()=>{
 const source=read('src/app/api/performance/route.ts'),team=source.indexOf('} else if (scope === "team")');
 const scope=source.indexOf('const scoped = assertScope(access, orgUnitId);',team);
 assert.ok(team>=0&&scope>team);
 const guard=source.slice(team,scope);
 assert.ok(guard.includes('eq(orgUnits.organizationId, organizationId)'));
 assert.ok(guard.includes('if (!team) return Response.json'));
 const get=source.slice(source.indexOf('export async function GET'),source.indexOf('export async function POST')).replaceAll('\r\n','\n');
 assert.equal(createHash('sha256').update(get).digest('hex'),'bf53f527030f4a5cb4a07c711b3890c345b908591365334e1e34afa4e6c3af08',
   'Retain the independent GET proof without changing its handler');
});
test('executed receipt and every promoted method fail closed on source or action drift',()=>{
 const r=verifyReceipt();assert.equal(r.run.own,54);
 for(const tamper of [v=>v.run.own--,v=>v.run.actions.pop(),v=>v.sources[0].sha256='0'.repeat(64),v=>v.mutation.rejected=false]){
   const bad=structuredClone(r);tamper(bad);assert.throws(()=>verifyReceipt(bad));
 }
 const m=JSON.parse(read('scripts/qa/tenant-isolation-coverage-manifest.json'));
 for(const key of r.run.methods){const [verb,route]=key.split(' ');const method=m.allApiRouteFiles['src/app/api/'+route+'/route.ts'].methods.find(v=>v.name===verb);verifyCredit(key,method);}
});
