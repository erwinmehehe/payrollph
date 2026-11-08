/** Explicit fictional local/CI runner. Requires an already provisioned PG16 listener. */
import assert from 'node:assert/strict';import {randomBytes} from 'node:crypto';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';import {spawnSync,spawn} from 'node:child_process';
import {TENANT_TABLE_BASE_ENV} from './tenant-table-env.mjs';
import {ENTERPRISE_OFF_FLAGS,ENTERPRISE_PROOF_MODE,requireEnterpriseProofEnvironment} from './tenant-enterprise-admin-contract.mjs';
const keyNames=['PII_ENCRYPTION_KEY','BANK_DATA_ENCRYPTION_KEY','TOTP_ENCRYPTION_KEY','ENTERPRISE_IDENTITY_ENCRYPTION_KEY'];
for(const name of ['RESEND_API_KEY','OPENAI_API_KEY','XENDIT_SECRET_KEY','PAYMONGO_SECRET_KEY','NEON_API_KEY'])assert.ok(!process.env[name],'ENTERPRISE_PROOF_REFUSED: external credential configured');
mkdirSync('outputs',{recursive:true});const file='outputs/enterprise-fixture-env.json';let keys;
try{keys=JSON.parse(readFileSync(file,'utf8'));}catch(error){
 if(error.code!=='ENOENT')throw error;
 keys=Object.fromEntries(keyNames.map(k=>[k,randomBytes(32).toString('hex')]));writeFileSync(file,JSON.stringify(keys),{mode:0o600,flag:'wx'});
}
assert.deepEqual(Object.keys(keys).sort(),[...keyNames].sort());for(const value of Object.values(keys))assert.match(value,/^[a-f0-9]{64}$/);
const env={...process.env,...TENANT_TABLE_BASE_ENV,...keys,...Object.fromEntries(ENTERPRISE_OFF_FLAGS.map(k=>[k,'false'])),TENANT_ENTERPRISE_ADMIN_PROOF:ENTERPRISE_PROOF_MODE,MALWARE_SCAN_URL:'',MALWARE_SCAN_TOKEN:''};
// This runner neither requires nor fabricates GitHub identity on a local host.
if(!process.env.GITHUB_ACTIONS)env.CI='false';
requireEnterpriseProofEnvironment(env);
const mode=process.argv[2];
if(mode==='db'){const r=spawnSync(process.execPath,['scripts/qa/local-tenant-proof-db.mjs','--reset'],{env,stdio:'inherit'});process.exit(r.status??1);}
const args=mode==='build'?['node_modules/next/dist/bin/next','build']:mode==='start'?['--import','./scripts/qa/tenant-enterprise-admin-preload.mjs','node_modules/next/dist/bin/next','start','-H','127.0.0.1','-p','3000']:mode==='proof'?['--import','tsx','scripts/qa/tenant-enterprise-admin-http.mjs']:null;
if(!args)throw Error('Usage: db | build | start | proof');
const child=spawn(process.execPath,args,{env,stdio:'inherit'});child.on('exit',code=>process.exit(code??1));
