const fs=require('fs');const assert=require('assert/strict');
const cfg={READINESS_TOKEN:process.env.FICTIONAL_QA_READINESS_TOKEN};
assert.ok(cfg.READINESS_TOKEN?.length>=32,'QA_READINESS_TOKEN_REQUIRED');
assert.match(process.env.EXPECTED_QA_SHA||'',/^[a-f0-9]{40}$/,'EXPECTED_QA_SHA_REQUIRED');
const base='https://payrollph-fictional-demo-qa-three.vercel.app';
(async()=>{
 const r=await fetch(base+'/api/readiness/database-target',{headers:{'x-readiness-token':cfg.READINESS_TOKEN},redirect:'manual'});assert.equal(r.status,200,'PRIVATE_IDENTITY_HTTP_'+r.status);const j=await r.json();
 for(const [k,v] of Object.entries({projectId:'silent-bonus-59912793',branchId:'br-sweet-shape-b7ow5v4c',endpointId:'ep-damp-star-b79zbhk4',databaseName:'neondb',roleName:'neondb_owner'}))assert.equal(j.database[k],v,'IDENTITY_MISMATCH_'+k);
 assert.equal(j.deploymentSha,process.env.EXPECTED_QA_SHA,'DEPLOYED_SHA_MISMATCH');
 const bad=await fetch(base+'/api/readiness/database-target',{headers:{'x-readiness-token':'invalid-qa-token'},redirect:'manual'});assert.equal(bad.status,404);
 const anonymous=await fetch(base+'/api/auth/me',{redirect:'manual'});assert.equal(anonymous.status,200);assert.equal((await anonymous.json()).user,null,'ANONYMOUS_USER_MUST_BE_NULL');
 const receipts=[];
 for(const role of ['owner','hr','payroll','checker','bookkeeper','employee']){
 const login=await fetch(base+'/api/auth/demo-switch',{method:'POST',headers:{'content-type':'application/json',origin:base},body:JSON.stringify({role}),redirect:'manual'});assert.equal(login.status,200,'DEMO_LOGIN_'+role+'_HTTP_'+login.status);const who=await login.json();assert.equal(who.user.role,role);assert.equal(who.organizationId,1);const cookie=login.headers.getSetCookie().map(x=>x.split(';')[0]).join('; ');assert.ok(cookie);
 const me=await fetch(base+'/api/auth/me',{headers:{cookie},redirect:'manual'});assert.equal(me.status,200,'AUTH_ME_'+role);const checks=[];for(const [route,expected] of [['/api/dashboard?organizationId=1',role==='employee'?403:200],['/api/payroll-runs?organizationId=1',['owner','payroll','bookkeeper'].includes(role)?200:403],['/api/self/payslips',role==='employee'?200:403]]){const response=await fetch(base+route,{headers:{cookie},redirect:'manual'});assert.equal(response.status,expected,'ROLE_ROUTE_'+role+'_'+route+'_HTTP_'+response.status);checks.push({route,status:expected});}receipts.push({role,login:200,authenticated:200,checks});
 }
 fs.writeFileSync('qa-demo-hosted-role-receipt.json',JSON.stringify({sha:process.env.EXPECTED_QA_SHA,targetIdentityVerified:true,wrongTokenDenied:true,anonymousDenied:true,roles:receipts},null,2));console.log('PASS: exact deployed SHA and QA identity; wrong token/anonymous denied; six authenticated role sessions.');
})().catch(e=>{console.error(String(e.message).slice(0,180));process.exitCode=1});
