import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';import ts from 'typescript';
import {spawnSync} from 'node:child_process';import {runInNewContext} from 'node:vm';
import {ENTERPRISE_OFF_FLAGS,ENTERPRISE_PROOF_MODE,requireEnterpriseProofEnvironment} from '../scripts/qa/tenant-enterprise-admin-contract.mjs';
import {verifyEnterprisePostAuditSource} from '../scripts/qa/tenant-family-reconciliation.mjs';
const source=readFileSync('src/app/api/enterprise/route.ts','utf8').replaceAll('\r\n','\n'),ast=ts.createSourceFile('route.ts',source,ts.ScriptTarget.Latest,true);
test('enterprise create failure handling distinguishes real named unique constraints from audit/database errors',()=>{
 const first=source.indexOf('function enterpriseCreateFailure(');
 const last=source.indexOf('export async function GET(',first);
 assert.ok(first>0&&last>first,'create error guard must exist outside GET and POST');
 const helper=ts.transpileModule(source.slice(first,last),{
   compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None},
 }).outputText;
 const log=[];
 const Response={json:(body,init)=>({body,status:init?.status,headers:init?.headers})};
 const classify=runInNewContext(helper+'\nenterpriseCreateFailure;',{
   Response,console:{error:(...args)=>log.push(args)},
 });
 const constraints=['permission_sets_org_name_unique'];
 const message='Permission set already exists';
 const valid=classify({code:'23505',constraint:constraints[0]},'permission',constraints,message);
 assert.equal(valid.status,409);
 assert.equal(valid.body.error,message);
 const wrapped=classify({cause:{code:'23505',constraint:constraints[0]}},'permission',constraints,message);
 assert.equal(wrapped.status,409,'Drizzle-wrapped 23505 must remain a conflict');
 for(const err of [
   {code:'P0001',message:'fictional enterprise audit veto'},
   {code:'23505',constraint:'audit_events_row_unique'},
   {code:'23503',constraint:constraints[0]},
   {cause:{code:'P0001',message:'sensitive SQL error'}},
 ]) {
   const failed=classify(err,'permission',constraints,message);
   assert.equal(failed.status,500,'audit, foreign-key and unknown errors are not name conflicts');
   assert.ok(!JSON.stringify(failed.body).includes('audit veto'));
   assert.equal(failed.headers['Cache-Control'],'no-store');
 }
 assert.equal(log.length,4);
 assert.ok(log.every(([label,metadata])=>label==='enterprise administration persistence failure'&&
   metadata.operation==='permission'&&metadata.kind==='transaction_or_audit'));
 for(const [action,constraint] of [
   ['create-oidc-provider','identity_providers_org_name_unique'],
   ['create-saml-provider','identity_domains_domain_unique'],
   ['save-permission-set','permission_sets_org_name_unique'],
   ['save-automation-rule','automation_rules_org_name_unique'],
 ]) {
   assert.ok(source.includes('enterpriseCreateFailure(error, "'+action+'"'), 'missing expected error classification for '+action);
   assert.ok(source.includes('"'+constraint+'"'),'expected named unique constraint '+constraint);
 }
});

test('fictional OIDC fixture rejects untrusted response values and audit veto is a true 500',()=>{
 const proof=readFileSync('scripts/qa/tenant-enterprise-admin-http.mjs','utf8');
 assert.ok(proof.includes("assert.equal(oidc.domain?.domain,expectedDomain"));
 assert.ok(proof.includes("assert.match(oidc.dnsTxtRecord,/^linaw-sso-verification=[a-f0-9]{48}$/"));
 assert.ok(proof.includes("dnsMap[expectedDomain]=oidc.dnsTxtRecord"));
 assert.ok(!proof.includes("dnsMap[oidc.domain.domain]="));
 assert.ok(proof.includes("status(rejected,500,'audit failure must not masquerade as "));
});

test('all enterprise mutation writes and audit receipts share a transaction',()=>{
 let audits=0,writes=0;
 function visit(node){if(ts.isCallExpression(node)){
  const call=node.expression.getText(ast);
  if(call==='recordAuditEvent'){
   audits++;assert.equal(node.arguments[1]?.getText(ast),'tx','audit writer must be the mutation transaction');
   let parent=node.parent,transaction=false;while(parent){if(ts.isCallExpression(parent)&&parent.expression.getText(ast)==='db.transaction')transaction=true;parent=parent.parent;}
   assert.ok(transaction,'audit must execute before the outer transaction commits');
  }
  if(ts.isPropertyAccessExpression(node.expression)&&['insert','update','delete'].includes(node.expression.name.text)){
   writes++;assert.equal(node.expression.expression.getText(ast),'tx','no direct db write may commit before audit');
  }
 }ts.forEachChild(node,visit);}visit(ast);assert.equal(audits,15);assert.ok(writes>=18);
});
test('existing GET and pre-action authorization remain intact',()=>{
 const workflow=readFileSync('.github/workflows/tenant-enterprise-admin-http.yml','utf8');
 assert.ok(workflow.includes('--health-cmd "pg_isready -U postgres -d app_db"'),'Docker health command must stay one double-quoted argument');
 const historical='3f282ea06dbf33e087b650a7adfdf4b70f91724e4bcdbb496bbe0cdcd937d9b3';
 verifyEnterprisePostAuditSource(source,historical);
 for(const mutated of [source.replace('requireSensitiveActionMfa(user)','null'),source.replace('}, tx);','});'),source.replace('eq(identityDomains.organizationId, organizationId)','eq(identityDomains.organizationId, 1)')])assert.throws(()=>verifyEnterprisePostAuditSource(mutated,historical));
 const get=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='GET');
 assert.equal(createHash('sha256').update(get.getText(ast)).digest('hex'),'14041996a56ebf3fd95fba2b03a9e4557ba811fb656781041e71c65967f6e760');
 const start=source.indexOf('export async function POST'),business=source.indexOf('if (action === "save-security-policy")',start),guards=source.slice(start,business);
 for(const token of ['enforceSameOriginMutation(request)','getSessionUser()','publicDemoMutationDenied(','assertOrganizationRole(','ORG_ADMIN_ROLES','access?.companyWide','requireSensitiveActionMfa(user)','rateLimitDistributed('])assert.ok(guards.includes(token),token);
 assert.ok(source.includes('A second administrator must manage your own worker identity link.'));
 assert.ok(source.includes('SAML_RUNTIME_NOT_READY'));
});
test('fictional proof refuses unknown targets, absent opt-in, MFA bypass and every money flag',()=>{
 const env={TENANT_ENTERPRISE_ADMIN_PROOF:ENTERPRISE_PROOF_MODE,DATABASE_URL:'postgresql://postgres:postgres@127.0.0.1:5432/app_db',SECURITY_SMOKE_URL:'http://127.0.0.1:3000',NODE_ENV:'production',DEMO_MODE:'false',REQUIRE_PRIVILEGED_MFA:'true',...Object.fromEntries(ENTERPRISE_OFF_FLAGS.map(k=>[k,'false']))};
 requireEnterpriseProofEnvironment(env);
 for(const change of [{TENANT_ENTERPRISE_ADMIN_PROOF:''},{DATABASE_URL:'postgresql://example.invalid/live'},{SECURITY_SMOKE_URL:'https://example.invalid'},{REQUIRE_PRIVILEGED_MFA:'false'},{RESEND_API_KEY:'not-a-real-key'},...ENTERPRISE_OFF_FLAGS.map(k=>({[k]:'true'}))])assert.throws(()=>requireEnterpriseProofEnvironment({...env,...change}));
});
test('fixture transport refuses unlisted DNS and all external fetch destinations before egress',()=>{
 const env={...process.env,TENANT_ENTERPRISE_ADMIN_PROOF:ENTERPRISE_PROOF_MODE,DATABASE_URL:'postgresql://postgres:postgres@127.0.0.1:5432/app_db',SECURITY_SMOKE_URL:'http://127.0.0.1:3000',NODE_ENV:'production',DEMO_MODE:'false',REQUIRE_PRIVILEGED_MFA:'true',...Object.fromEntries(ENTERPRISE_OFF_FLAGS.map(k=>[k,'false']))};
 for(const key of ['RESEND_API_KEY','OPENAI_API_KEY','XENDIT_SECRET_KEY','PAYMONGO_SECRET_KEY','NEON_API_KEY'])delete env[key];
 const code=`import assert from 'node:assert/strict';import dns from 'node:dns/promises';import https from 'node:https';
 await assert.rejects(dns.lookup('unlisted.example.test'),/EGRESS_REFUSED/);
 assert.throws(()=>fetch('https://unlisted.example.test/'),/EGRESS_REFUSED/);
 assert.throws(()=>https.request(new URL('https://unlisted.example.test/'),{method:'GET'},()=>{}));
 assert.deepEqual(await dns.lookup('idp-7.enterprise.example.test',{all:true}),[{address:'93.184.216.34',family:4}]);`;
 const r=spawnSync(process.execPath,['--import','./scripts/qa/tenant-enterprise-admin-preload.mjs','--input-type=module','-e',code],{env,encoding:'utf8'});
 assert.equal(r.status,0,r.stderr);
});
