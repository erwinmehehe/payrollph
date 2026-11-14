import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {load} from 'js-yaml';
import {requireFreshSamlMetadataEnv,collectFreshSamlInputs,assertFreshSamlResult} from '../scripts/qa/tenant-saml-metadata-fresh-inputs.mjs';
import {verifySamlMetadataPrivacyHold} from '../scripts/qa/tenant-saml-metadata-privacy-verify.mjs';
const env=()=>({CI:'true',GITHUB_ACTIONS:'true',NODE_ENV:'production',TENANT_SECOND_PASS_MODE:'isolated-ci-only',
 TENANT_SAML_METADATA_MODE:'isolated-ci-only',DATABASE_URL:'postgresql://postgres:postgres@127.0.0.1:5432/app_db',
 SECURITY_SMOKE_URL:'http://127.0.0.1:3000',APP_BASE_URL:'https://payroll.example.test',DEMO_MODE:'false',WORKER_ENABLED:'false',
 CENTRAL_SCHEDULER_ENABLED:'false',XENDIT_BILLING_ENABLED:'false',XENDIT_PAYOUTS_ENABLED:'false',PAYMONGO_DISBURSEMENTS_ENABLED:'false',
 FINAL_PAY_SIGNED_REVIEW_ENABLED:'false',EXACT_THIRTEENTH_CENTAVOS_ENABLED:'false',PAYROLL_CALCULATION_HISTORY_ENABLED:'false',NEXT_CSP_ENABLED:'false',
 XENDIT_PAYOUTS_LIVE_APPROVED:'false',FINAL_PAY_MANUAL_RELEASE_ENABLED:'false',
 SAML_FRESH_PROOF_MODE:'fictional-pg16-public-metadata',SAML_PROOF_HEAD_SHA:'a'.repeat(40)});
const result=()=>({target:'GET /api/auth/saml/metadata/[providerId]',attackers:2,higherIdRealVictim:true,allBusinessIdsOverSix:true,
 signedInSessions:3,requests:48,anonymousXml200:true,forgedSelectorsIdentical:true,disabledAndMissingIdentical404:true,
 enabledThenDisabledConcealed:true,noTenantOrProviderSecrets:true,unchangedDbDuringHttp:true,allOrganizationTablesProtected:true,
 protectedOrganizationTables:200,enabledProviderPositiveControls:3,disabledProviderControls:3,fixtureProviderDisableWrites:1,
 disabledProviderPublicPolicy:'CONCEAL_DISABLED_PROVIDERS',classificationCandidate:'PUBLIC-BY-DESIGN',currentStatus:'GAP',coverageCredits:0,
 independentlyAccepted:false,productionCertified:false,evidenceLabel:'SOLO_VERIFIED_DEV_RECOVERY',resolveHeld:true,postgresMajor:16});
test('fresh proof refuses non-CI, remote DB, real credentials and any money activation',()=>{
 assert.doesNotThrow(()=>requireFreshSamlMetadataEnv(env()));
 for(const patch of [{CI:'false'},{DATABASE_URL:'postgresql://remote.invalid/app_db'},
  {SAML_FRESH_PROOF_MODE:undefined},{SAML_PROOF_HEAD_SHA:'main'},{XENDIT_SECRET_KEY:'fictional-but-forbidden'},
  {XENDIT_PAYOUTS_LIVE_APPROVED:'true'},{FINAL_PAY_MANUAL_RELEASE_ENABLED:'true'}])
  assert.throws(()=>requireFreshSamlMetadataEnv({...env(),...patch}));
});
test('a partial, foreign-accepting, mutated-SQL or self-credited result cannot pass',()=>{
 assert.doesNotThrow(()=>assertFreshSamlResult(result()));
 for(const [key,value]of Object.entries(result())){
  const r=result();delete r[key];assert.throws(()=>assertFreshSamlResult(r),'Missing '+key);
  if(typeof value==='boolean'){const x=result();x[key]=!value;assert.throws(()=>assertFreshSamlResult(x),'Flipped '+key);}
 }
 for(const patch of [{coverageCredits:1},{currentStatus:'COVERED'},{classificationCandidate:'COVERED'},
  {requests:0},{protectedOrganizationTables:0},{evidenceLabel:'independent'}])assert.throws(()=>assertFreshSamlResult({...result(),...patch}));
});
test('fresh workflow checks out exact head, executes the new HTTP runner and retains only sanitized evidence',()=>{
 const w=load(readFileSync('.github/workflows/tenant-saml-metadata-fresh-http.yml','utf8')),j=w.jobs['public-saml-metadata'];
 assert.equal(j.services.postgres.image,'postgres:16');
 assert.equal(j.steps[0].with.ref,'${{ github.event.pull_request.head.sha }}');assert.equal(j.steps[0].with['persist-credentials'],false);
 assert.equal(j.env.SAML_FRESH_PROOF_MODE,'fictional-pg16-public-metadata');
 for(const k of ['XENDIT_PAYOUTS_ENABLED','XENDIT_PAYOUTS_LIVE_APPROVED','FINAL_PAY_MANUAL_RELEASE_ENABLED','NEXT_CSP_ENABLED'])assert.equal(j.env[k],'false');
 assert.ok(j.steps.some(s=>s.run==='node --import tsx scripts/qa/tenant-saml-metadata-fresh-http.mjs'));
 assert.ok(j.steps.some(s=>s.with?.path==='/tmp/payrollph-saml-metadata-public/receipt.json'));
});
test('complete input closure pins schema, subprocess baseline, source and every numbered SQL file',()=>{
 const r=collectFreshSamlInputs();
 for(const p of ['src/lib/saml.ts','src/lib/security-request.ts','src/db/schema.ts',
  'scripts/qa/apply-audit-0109-isolated.mjs','scripts/qa/apply-source-baseline-supplement.mjs',
  'scripts/strict-db-push.mjs','drizzle.config.ts','.github/workflows/tenant-saml-metadata-fresh-http.yml'])assert.ok(r.pins[p],p);
 assert.ok(r.sqlInventory.length>100);assert.ok(r.sqlInventory.every(p=>r.pins[p]));
});
test('fresh evidence cannot silently classify metadata or lift anonymous resolve hold',()=>{
 const m=JSON.parse(readFileSync('scripts/qa/tenant-isolation-coverage-manifest.json'));
 assert.equal(verifySamlMetadataPrivacyHold(m),0);
 const resolve=m.allApiRouteFiles['src/app/api/auth/sso/resolve/route.ts'].methods.find(r=>r.name==='POST');
 assert.equal(resolve.status,'GAP');assert.equal(resolve.testedBy,null);
});
