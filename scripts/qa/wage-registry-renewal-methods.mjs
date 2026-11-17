/** Complete original proof families required for each exact withdrawn method. */
import assert from 'node:assert/strict';
import {PAYROLL_RENEWAL_COHORTS} from './payroll-run-credit-renewal-contract.mjs';

const payroll={boundary:['oracle'],secondPass:['security'],readTable:['table'],exportsPost:['exports'],actions:['payroll'],moneyOff:['approvals'],moneyOn:['approvals'],paymongo:['paymongo'],creation:['payroll']};
const byFile={
 'tenant-approval-types-http.mjs':['approvals'],
 'tenant-identity-account-http.mjs':['identity'],
 'tenant-studio-recovery-scope-http.mjs':['triage','draft','lifecycle','execution','resolution','language','scope','sessions'],
 'tenant-bir1604c-candidate-post-http.mjs':['bir'],
 'compliance-read-sweep-http.mjs':['security'],
 'tenant-table-http.mjs':['table'],
 'bank-tenant-http.mjs':['security'],
 'tenant-second-pass-http.mjs':['security'],
 'tenant-dl01-batch2-http.mjs':['security'],
 'tenant-dl01-filing-file-http.mjs':['security'],
 'tenant-compliance-accepted-http.mjs':['filing'],
 'tenant-high-risk-01-http.mjs':['security'],
 'tenant-write-table-http.mjs':['table'],
 'government-loan-read-http.mjs':['security'],
 'tenant-labor-inspection-post-http.mjs':['labor'],
 'remittance-action-entity-http.mjs':['remittance'],
 'payroll-read-sweep-http.mjs':['security'],
 'tenant-onboarding-http.mjs':['onboarding'],
 'tenant-dl01-import-history-http.mjs':['security'],
 'tenant-enterprise-admin-http.mjs':['enterprise'],
 'pr-1302-tenant-proof.mjs':['security'],
 'tenant-managed-client-approval-http.mjs':['spend'],
 'tenant-requested-migrations-http.mjs':['migrations'],
 'tenant-dl02-http.mjs':['dl02'],
 'tenant-spend-write-actions-http.mjs':['spend'],
 'year-end-annualization-post.mjs':['yearend'],
};
export const methodKey=e=>e.verb+' '+e.path;
export function requiredWageFamilies(entry){
 const key=entry.verb+' '+entry.path.slice('src/app/api/'.length,-'/route.ts'.length);
 if(PAYROLL_RENEWAL_COHORTS[key])return [...new Set(['oracle',...PAYROLL_RENEWAL_COHORTS[key].flatMap(x=>payroll[x])])].sort();
 if(key==='POST compliance/payroll-month-close'||key==='POST compliance/statutory-remittances')return ['statutory'];
 const file=entry.held.reviewedUncertified.priorProof.file?.split('/').at(-1);
 assert.ok(byFile[file],'No reviewed complete-method cohort: '+key);
 return [...byFile[file]].sort();
}
