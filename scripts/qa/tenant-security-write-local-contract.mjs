import assert from 'node:assert/strict';
import {existsSync,realpathSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {OFF,ABSENT} from './tenant-recovery-local-contract.mjs';
export const SECURITY_WRITE_MODE='fictional-disposable-security-writes';
export const securityWriteRun=()=>process.env.TENANT_SECURITY_WRITE_MODE===SECURITY_WRITE_MODE;
export function requireSecurityWrite(env=process.env){
  const fail='SECURITY_WRITE_REFUSED: ';
  assert.equal(env.TENANT_SECURITY_WRITE_MODE,SECURITY_WRITE_MODE,fail+'explicit mode');
  assert.equal(env.DATABASE_URL,'postgresql://postgres:postgres@127.0.0.1:5432/app_db',fail+'loopback PG only');
  assert.equal(env.SECURITY_SMOKE_URL,'http://127.0.0.1:3000');
  assert.equal(env.APP_BASE_URL,'https://payroll.example.test');
  assert.equal(env.NODE_ENV,'production');assert.equal(env.DEMO_MODE,'false');
  assert.equal(env.REQUIRE_PRIVILEGED_MFA,'true');
  for(const flag of OFF)assert.equal(env[flag],'false',fail+flag);
  for(const name of ABSENT.filter(x=>x!=='SMTP_URL'))assert.ok(!env[name],fail+name);
  assert.equal(env.SMTP_URL,'smtp://127.0.0.1:2525',fail+'only the fictional loopback SMTP sink');
  assert.equal(env.MALWARE_SCAN_URL,'https://scanner.fixture.invalid/scan');
  assert.match(env.MALWARE_SCAN_TOKEN??'',/^ci-fictional-scanner-[a-f0-9]{64}$/);
  assert.match(env.BIOMETRIC_INGEST_SECRET??'',/^ci-bio01-[a-f0-9]{64}$/);
  for(const name of ['PII_ENCRYPTION_KEY','BANK_DATA_ENCRYPTION_KEY','TOTP_ENCRYPTION_KEY'])assert.match(env[name]??'',/^[a-f0-9]{64}$/);
  assert.equal(env.DOCUMENT_UPLOADS_ENABLED,'true');
  assert.ok(['false','true'].includes(env.EMPLOYEE_DOCUMENT_VAULT_ENABLED));
  assert.equal(env.DOCUMENT_OBJECT_STORAGE_ENDPOINT,'https://objects.fixture.invalid');
  assert.equal(env.DOCUMENT_OBJECT_STORAGE_BUCKET,'fictional-documents');
  assert.equal(env.DOCUMENT_OBJECT_STORAGE_REGION,'fixture-region');
  assert.equal(env.DOCUMENT_OBJECT_STORAGE_ACCESS_KEY_ID,'fixture-document-access');
  assert.match(env.DOCUMENT_OBJECT_STORAGE_SECRET_ACCESS_KEY??'',/^fixture-document-[a-f0-9]{64}$/);
  for(const f of ['.env','.env.local','.env.production','.env.production.local'])assert.ok(!existsSync(f),fail+'clean worktree');
  if(env.GITHUB_ACTIONS){assert.equal(env.GITHUB_ACTIONS,'true');assert.equal(env.CI,'true');}
  else assert.equal(resolve(env.TENANT_SECURITY_PGDATA??''),resolve('outputs/security-write-pg16'),fail+'worktree-owned PG cluster');
}
export async function assertSecurityDatabase(pool,{empty=true}={}){
  requireSecurityWrite();const {rows:[r]}=await pool.query("SELECT current_setting('server_version_num') AS version,current_setting('data_directory') AS dir,current_database() AS name");
  assert.equal(Math.floor(Number(r.version)/10000),16,'SECURITY_WRITE_REFUSED: actual PG16');assert.equal(r.name,'app_db');
  if(!process.env.GITHUB_ACTIONS)assert.equal(realpathSync(r.dir),realpathSync(resolve('outputs/security-write-pg16')),'SECURITY_WRITE_REFUSED: unrelated local cluster');
  if(empty){const {rows:[counts]}=await pool.query('SELECT (SELECT count(*)::int FROM users) AS users,(SELECT count(*)::int FROM organizations) AS orgs');assert.deepEqual(counts,{users:0,orgs:0},'SECURITY_WRITE_REFUSED: fresh empty fictional DB');}
}
export function securityReceipt(family,result){
  if(!securityWriteRun())return;requireSecurityWrite();
  const git=(...args)=>execFileSync('git',args,{encoding:'utf8'}).trim();
  assert.equal(git('diff','--name-only','HEAD','--','src','scripts/qa','.github/workflows','drizzle','docs/sql'),'','Commit proof and runtime inputs before execution');
  const r={label:'SOLO_VERIFIED_DEV_RECOVERY',execution:process.env.GITHUB_ACTIONS?'github-actions-http-pg16':'local-production-http-pg16',
    sourceHead:git('rev-parse','HEAD'),family,result,coverageCredits:0,productionCertified:false,
    flags:Object.fromEntries(OFF.map(k=>[k,process.env[k]])),vaultProfile:process.env.EMPLOYEE_DOCUMENT_VAULT_ENABLED==='true'};
  writeFileSync('outputs/security-write-'+family+(family==='documents'?(r.vaultProfile?'-vault':'-legacy'):'')+'.json',JSON.stringify(r,null,2)+'\n');
}
export async function withSecurityVeto(pool,table,orgId,run,{action}={}){
  requireSecurityWrite();await assertSecurityDatabase(pool,{empty:false});
  assert.equal(table,'audit_events');assert.ok(Number.isSafeInteger(orgId)&&orgId>0);
  assert.ok(action===undefined||['Employee document scanned and stored in private vault','API key created','API key revoked','Webhook endpoint created'].includes(action));
  const client=await pool.connect();
  try{
    await client.query('CREATE SEQUENCE qa_security_veto_reached');
    await client.query("CREATE FUNCTION qa_security_veto() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM nextval('qa_security_veto_reached'); RAISE EXCEPTION 'QA_SECURITY_AUDIT_VETO'; END $$");
    await client.query('CREATE TRIGGER qa_security_veto BEFORE INSERT ON audit_events FOR EACH ROW WHEN (NEW.organization_id = '+orgId+(action?" AND NEW.action = '"+action+"'":'')+') EXECUTE FUNCTION qa_security_veto()');
    await run();
    assert.equal((await client.query('SELECT is_called FROM qa_security_veto_reached')).rows[0].is_called,true,'the audit veto must actually be reached');
  }finally{
    try{await client.query('DROP TRIGGER IF EXISTS qa_security_veto ON audit_events');await client.query('DROP FUNCTION IF EXISTS qa_security_veto()');await client.query('DROP SEQUENCE IF EXISTS qa_security_veto_reached');}finally{client.release();}
  }
}
