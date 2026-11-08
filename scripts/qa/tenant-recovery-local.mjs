/** Local launcher: own PG16 cluster, fixture keys only; no hosted identity spoof. */
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdirSync,readFileSync,writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { TENANT_TABLE_BASE_ENV,TENANT_TABLE_PROFILES } from './tenant-table-env.mjs';
import { RECOVERY_MODE,OFF,ABSENT,requireLocalRecovery } from './tenant-recovery-local-contract.mjs';
for(const key of ABSENT)assert.ok(!process.env[key],'RECOVERY_REFUSED: external credential '+key);
mkdirSync('outputs',{recursive:true});
const file='outputs/recovery-fixture-keys.json';let keys;
try{keys=JSON.parse(readFileSync(file,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;
  keys=Object.fromEntries(['PII_ENCRYPTION_KEY','BANK_DATA_ENCRYPTION_KEY','TOTP_ENCRYPTION_KEY'].map(k=>[k,randomBytes(32).toString('hex')]));
  writeFileSync(file,JSON.stringify(keys),{mode:0o600,flag:'wx'});
}
const env={...process.env,...TENANT_TABLE_BASE_ENV,...TENANT_TABLE_PROFILES['compliance-posts'],...keys,
  ...Object.fromEntries(OFF.map(k=>[k,'false'])),TENANT_RECOVERY_MODE:RECOVERY_MODE,
  TENANT_RECOVERY_PGDATA:resolve('outputs/recovery-pg16'),MALWARE_SCAN_URL:'',MALWARE_SCAN_TOKEN:'',
  TENANT_TOTP_SETUP_MODE:'fictional-ci-only',RESEND_WEBHOOK_SECRET:'whsec_'+randomBytes(32).toString('base64')};
requireLocalRecovery(env);
const mode=process.argv[2];
if(mode==='db'){
  const {default:pg}=await import('pg');const pool=new pg.Pool({connectionString:env.DATABASE_URL});
  const {assertLocalRecoveryDatabase}=await import('./tenant-recovery-local-contract.mjs');
  Object.assign(process.env,env);
  try{await assertLocalRecoveryDatabase(pool);}finally{await pool.end();}
}
const args=mode==='db'?['scripts/qa/local-tenant-proof-db.mjs','--reset']:
  mode==='build'?['node_modules/next/dist/bin/next','build']:
  mode==='start'?['node_modules/next/dist/bin/next','start','-H','127.0.0.1','-p','3000']:
  mode==='totp'?['--import','tsx','scripts/qa/tenant-totp-setup-http.mjs']:
  mode==='scenarios'?['--import','tsx','scripts/qa/tenant-wps01-scenarios-http.mjs']:null;
assert.ok(args,'Usage: db | build | start | totp | scenarios');
// Schema initialization is explicitly LOCAL, never a fabricated hosted CI job.
const child=spawn(process.execPath,args,{env:mode==='db'?{...env,CI:'false'}:env,stdio:'inherit'});child.on('exit',code=>process.exit(code??1));
