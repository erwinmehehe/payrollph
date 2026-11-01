import {TENANT_TABLE_BASE_ENV} from './tenant-table-env.mjs';
const env={...TENANT_TABLE_BASE_ENV,FIRST_PAYROLL_FULL_MODE:'fictional-disposable-only',FIRST_PAYROLL_FULL_BROWSER:'true',WORKER_ENABLED:'false',CENTRAL_SCHEDULER_ENABLED:'false',XENDIT_BILLING_ENABLED:'false',MALWARE_SCAN_URL:'',MALWARE_SCAN_TOKEN:'',PAYMONGO_SECRET_KEY:'',XENDIT_SECRET_KEY:'',RESEND_API_KEY:'',SMTP_URL:''};
for(const[k,v]of Object.entries(env))console.log(k+'='+v);
