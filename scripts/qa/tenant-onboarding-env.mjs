import {TENANT_TABLE_BASE_ENV} from './tenant-table-env.mjs';
export function onboardingEnv(profile){
 if(!['legacy','preview'].includes(profile))throw Error('Unknown onboarding profile');
 return {...TENANT_TABLE_BASE_ENV,TENANT_ONBOARDING_MODE:'fictional-disposable-only',TENANT_ONBOARDING_PROFILE:profile,
 EMPLOYEE_IMPORT_PREVIEW_ENABLED:profile==='preview'?'true':'false',FIRST_PAYROLL_INLINE_ENABLED:'true',MULTI_ENTITY_ENABLED:'false',WORKER_ENABLED:'false',CENTRAL_SCHEDULER_ENABLED:'false',FINAL_PAY_MANUAL_RELEASE_ENABLED:'false',XENDIT_CALLBACK_TOKEN:'',XENDIT_SECRET_KEY:'',PAYMONGO_SECRET_KEY:'',MALWARE_SCAN_URL:'',MALWARE_SCAN_TOKEN:''};
}
if(process.argv[1]?.replaceAll('\\','/').endsWith('/tenant-onboarding-env.mjs'))for(const[k,v]of Object.entries(onboardingEnv(process.argv[2])))console.log(k+'='+v);
