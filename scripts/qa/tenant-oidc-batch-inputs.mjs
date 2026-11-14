/** Explicit runtime/import and subprocess/schema inputs of this disposable proof. */
import {readdirSync} from 'node:fs';
import {collectRenewalInputs} from './payroll-run-renewal-inputs.mjs';
export function collectOidcBatchInputs(){
 const sql=readdirSync('drizzle').filter(name=>/^\d{4}_.+\.sql$/.test(name)).sort().map(name=>'drizzle/'+name);
 const roots=[
  'src/app/api/auth/sso/start/route.ts','src/app/api/auth/sso/callback/route.ts',
  'src/app/api/auth/sso/resolve/route.ts','scripts/qa/tenant-oidc-batch-http.mjs',
  'scripts/qa/tenant-oidc-batch-contract.mjs','.github/workflows/tenant-oidc-batch-http.yml',
  'tests/tenant-oidc-batch-contract.test.mjs','scripts/strict-db-push.mjs','drizzle.config.ts',
  'src/lib/ess-profile-schema.ts','src/lib/saas-billing-schema.ts','src/lib/workforce-schedule-receipt-schema.ts',
  'scripts/qa/apply-isolated-baseline.mjs','scripts/qa/apply-audit-0109-isolated.mjs',
  'scripts/qa/apply-source-baseline-supplement.mjs','docs/sql/source-baseline-supplement.sql',
  'package.json','package-lock.json','next.config.ts','tsconfig.json',...sql,
 ];
 return{roots,sqlInventory:sql,algorithm:'git-blob-sha1',pins:collectRenewalInputs(roots)};
}
