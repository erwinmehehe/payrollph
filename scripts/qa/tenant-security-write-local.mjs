import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {spawn} from 'node:child_process';
import {TENANT_TABLE_BASE_ENV,TENANT_TABLE_PROFILES} from './tenant-table-env.mjs';
import {OFF,ABSENT} from './tenant-recovery-local-contract.mjs';
import {SECURITY_WRITE_MODE,requireSecurityWrite,assertSecurityDatabase} from './tenant-security-write-local-contract.mjs';
for(const k of ABSENT)assert.ok(!process.env[k],'SECURITY_WRITE_REFUSED: configured external credential '+k);
if(process.env.GITHUB_ACTIONS)assert.equal(process.env.CI,'true','Hosted execution requires actual GitHub CI');
mkdirSync('outputs',{recursive:true});const file='outputs/security-write-fixture-env.json';let keys;
try{keys=JSON.parse(readFileSync(file,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;
  keys=Object.fromEntries(['PII_ENCRYPTION_KEY','BANK_DATA_ENCRYPTION_KEY','TOTP_ENCRYPTION_KEY'].map(k=>[k,randomBytes(32).toString('hex')]));
  keys.BIOMETRIC_INGEST_SECRET='ci-bio01-'+randomBytes(32).toString('hex');
  keys.MALWARE_SCAN_TOKEN='ci-fictional-scanner-'+randomBytes(32).toString('hex');
  keys.DOCUMENT_OBJECT_STORAGE_SECRET_ACCESS_KEY='fixture-document-'+randomBytes(32).toString('hex');
  writeFileSync(file,JSON.stringify(keys),{flag:'wx',mode:0o600});}
const [mode,profile='legacy']=process.argv.slice(2);assert.ok(['legacy','vault'].includes(profile));
const env={...process.env,...TENANT_TABLE_BASE_ENV,...TENANT_TABLE_PROFILES['compliance-posts'],...keys,
  ...Object.fromEntries(OFF.map(k=>[k,'false'])),TENANT_SECURITY_WRITE_MODE:SECURITY_WRITE_MODE,TENANT_SECURITY_PGDATA:resolve('outputs/security-write-pg16'),
  SMTP_URL:'smtp://127.0.0.1:2525',SMTP_FROM:'fictional@example.invalid',DOCUMENT_UPLOADS_ENABLED:'true',
  EMPLOYEE_DOCUMENT_VAULT_ENABLED:profile==='vault'?'true':'false',MALWARE_SCAN_URL:'https://scanner.fixture.invalid/scan',
  DOCUMENT_OBJECT_STORAGE_ENDPOINT:'https://objects.fixture.invalid',DOCUMENT_OBJECT_STORAGE_BUCKET:'fictional-documents',
  DOCUMENT_OBJECT_STORAGE_REGION:'fixture-region',DOCUMENT_OBJECT_STORAGE_ACCESS_KEY_ID:'fixture-document-access',
  TENANT_ACCOUNT_EMAIL_REQUEST_MODE:'fictional-pg16-smtp',TENANT_DOCUMENT_UPLOAD_MODE:'fictional-pg16-http',
  TENANT_BIO01_MODE:'fictional-pg16-http',TENANT_DEVELOPER_KEY_PROOF:'fictional-pg16-http-only'};
requireSecurityWrite(env);
if(mode==='db'){Object.assign(process.env,env);const {default:pg}=await import('pg');const p=new pg.Pool({connectionString:env.DATABASE_URL});try{await assertSecurityDatabase(p,{empty:false});}finally{await p.end();}}
const proof={email:'tenant-account-email-request-http.mjs',documents:'tenant-document-upload-http.mjs',biometrics:'tenant-bio01-biometric-http.mjs',developer:'tenant-developer-key-http.mjs'};
const args=mode==='db'?['scripts/qa/local-tenant-proof-db.mjs','--reset']:mode==='build'?['node_modules/next/dist/bin/next','build']:
 mode==='start'?['--import','./scripts/qa/tenant-security-write-preload.mjs','node_modules/next/dist/bin/next','start','-H','127.0.0.1','-p','3000']:
 proof[mode]?['--import','tsx','scripts/qa/'+proof[mode]]:null;
assert.ok(args,'Usage: db | build | start | email | documents | biometrics | developer [legacy|vault]');
const child=spawn(process.execPath,args,{env:mode==='db'?{...env,CI:process.env.GITHUB_ACTIONS?'true':'false'}:env,stdio:'inherit'});
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>child.kill(signal));
child.on('exit',code=>process.exit(code??1));
