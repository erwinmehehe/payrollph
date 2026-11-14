/** Execution inputs and environment guard for the public-metadata decision proof. */
import assert from 'node:assert/strict';
import {readdirSync} from 'node:fs';
import {requireIsolatedSamlProof} from './tenant-saml-metadata-public-contract.mjs';
import {collectRenewalInputs} from './payroll-run-renewal-inputs.mjs';
export function requireFreshSamlMetadataEnv(env=process.env){
 requireIsolatedSamlProof(env);
 assert.equal(env.SAML_FRESH_PROOF_MODE,'fictional-pg16-public-metadata');
 assert.equal(env.XENDIT_PAYOUTS_LIVE_APPROVED,'false');
 assert.equal(env.FINAL_PAY_MANUAL_RELEASE_ENABLED,'false');
 assert.match(env.SAML_PROOF_HEAD_SHA??'',/^[a-f0-9]{40}$/);
}
export function collectFreshSamlInputs(){
 const sqlInventory=readdirSync('drizzle').filter(p=>/^\d{4}_.+\.sql$/.test(p)).sort().map(p=>'drizzle/'+p);
 const roots=[
  'src/app/api/auth/saml/metadata/[providerId]/route.ts',
  'scripts/qa/tenant-saml-metadata-fresh-http.mjs',
  'scripts/qa/tenant-saml-metadata-fresh-inputs.mjs',
  'scripts/qa/tenant-saml-metadata-public-contract.mjs',
  'scripts/qa/tenant-saml-metadata-privacy-verify.mjs',
  'tests/tenant-saml-metadata-fresh.test.mjs',
  'tests/tenant-saml-metadata-public.test.mjs',
  'tests/tenant-saml-metadata-disabled-route.test.mjs',
  'tests/tenant-saml-metadata-privacy-verify.test.mjs',
  '.github/workflows/tenant-saml-metadata-fresh-http.yml',
  'scripts/strict-db-push.mjs','drizzle.config.ts',
  'scripts/qa/apply-isolated-baseline.mjs','scripts/qa/apply-audit-0109-isolated.mjs',
  'scripts/qa/apply-source-baseline-supplement.mjs','docs/sql/source-baseline-supplement.sql',
  'src/lib/ess-profile-schema.ts','src/lib/saas-billing-schema.ts','src/lib/workforce-schedule-receipt-schema.ts',
  'package.json','package-lock.json','tsconfig.json','next.config.ts',...sqlInventory,
 ];
 return{roots,sqlInventory,algorithm:'git-blob-sha1',pins:collectRenewalInputs(roots)};
}
export function assertFreshSamlResult(r){
 assert.equal(r.target,'GET /api/auth/saml/metadata/[providerId]');
 assert.equal(r.attackers,2);assert.equal(r.higherIdRealVictim,true);assert.equal(r.allBusinessIdsOverSix,true);
 assert.equal(r.signedInSessions,3);assert.ok(r.requests>=48);
 for(const k of ['anonymousXml200','forgedSelectorsIdentical','disabledAndMissingIdentical404',
  'enabledThenDisabledConcealed','noTenantOrProviderSecrets','unchangedDbDuringHttp','allOrganizationTablesProtected'])assert.equal(r[k],true,k);
 assert.equal(r.enabledProviderPositiveControls,3);assert.equal(r.disabledProviderControls,3);
 assert.equal(r.fixtureProviderDisableWrites,1);assert.equal(r.classificationCandidate,'PUBLIC-BY-DESIGN');
 assert.equal(r.disabledProviderPublicPolicy,'CONCEAL_DISABLED_PROVIDERS');
 assert.ok(Number.isSafeInteger(r.protectedOrganizationTables)&&r.protectedOrganizationTables>100);
 assert.equal(r.currentStatus,'GAP');assert.equal(r.coverageCredits,0);
 assert.equal(r.independentlyAccepted,false);assert.equal(r.productionCertified,false);
 assert.equal(r.evidenceLabel,'SOLO_VERIFIED_DEV_RECOVERY');assert.equal(r.resolveHeld,true);
 assert.equal(r.postgresMajor,16);
}
