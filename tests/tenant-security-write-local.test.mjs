import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdirSync} from 'node:fs';
import {mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import test from 'node:test';
import {OFF,ABSENT} from '../scripts/qa/tenant-recovery-local-contract.mjs';
import {SECURITY_WRITE_MODE,requireSecurityWrite} from '../scripts/qa/tenant-security-write-local-contract.mjs';
const safe={TENANT_SECURITY_WRITE_MODE:SECURITY_WRITE_MODE,TENANT_SECURITY_PGDATA:resolve('outputs/security-write-pg16'),
  DATABASE_URL:'postgresql://postgres:postgres@127.0.0.1:5432/app_db',SECURITY_SMOKE_URL:'http://127.0.0.1:3000',APP_BASE_URL:'https://payroll.example.test',
  NODE_ENV:'production',DEMO_MODE:'false',REQUIRE_PRIVILEGED_MFA:'true',SMTP_URL:'smtp://127.0.0.1:2525',
  DOCUMENT_UPLOADS_ENABLED:'true',EMPLOYEE_DOCUMENT_VAULT_ENABLED:'false',
  MALWARE_SCAN_URL:'https://scanner.fixture.invalid/scan',MALWARE_SCAN_TOKEN:'ci-fictional-scanner-'+'a'.repeat(64),
  BIOMETRIC_INGEST_SECRET:'ci-bio01-'+'b'.repeat(64),DOCUMENT_OBJECT_STORAGE_ENDPOINT:'https://objects.fixture.invalid',
  DOCUMENT_OBJECT_STORAGE_BUCKET:'fictional-documents',DOCUMENT_OBJECT_STORAGE_REGION:'fixture-region',
  DOCUMENT_OBJECT_STORAGE_ACCESS_KEY_ID:'fixture-document-access',DOCUMENT_OBJECT_STORAGE_SECRET_ACCESS_KEY:'fixture-document-'+'c'.repeat(64),
  ...Object.fromEntries(OFF.map(k=>[k,'false'])),...Object.fromEntries(['PII_ENCRYPTION_KEY','BANK_DATA_ENCRYPTION_KEY','TOTP_ENCRYPTION_KEY'].map(k=>[k,'d'.repeat(64)]))};
test('four-method proof refuses external DB, mail, storage, credentials and enabled money/worker flags',()=>{
  requireSecurityWrite(safe);
  for(const patch of [{TENANT_SECURITY_WRITE_MODE:''},{DATABASE_URL:'postgresql://postgres:postgres@db.example.test/app_db'},
    {SMTP_URL:'smtp://mail.example.test:2525'},{SMTP_URL:'smtp://user:pass@127.0.0.1:2525'},
    {TENANT_SECURITY_PGDATA:resolve('unrelated')},{DOCUMENT_OBJECT_STORAGE_ENDPOINT:'https://real.example.test'},
    {GITHUB_ACTIONS:'true',CI:'false'},...OFF.map(k=>({[k]:'true'})),...ABSENT.filter(k=>k!=='SMTP_URL').map(k=>({[k]:'not-allowed'}))])
    assert.throws(()=>requireSecurityWrite({...safe,...patch}));
});
test('preload refuses every non-fixture HTTPS, DNS and fetch destination',()=>{
  const env={...process.env,...safe};delete env.GITHUB_ACTIONS;
  const code="import dns from 'node:dns/promises';import https from 'node:https';import assert from 'node:assert/strict';await assert.rejects(dns.lookup('not-a-fixture.example.test'));assert.throws(()=>https.request('https://not-a-fixture.example.test/'));await assert.rejects(fetch('https://not-a-fixture.example.test/'));console.log('EGRESS_REFUSED');";
  // A pristine CI checkout has no generated outputs directory. The sealed
  // fixture preload writes initial zeroed transport counters on import; create
  // only its local destination without touching the pinned proof or egress guard.
  mkdirSync('outputs',{recursive:true});
  // The sealed preload writes its sanitized counters immediately on import.
  // Prepare the disposable output folder here without changing proof-pinned code.
  mkdirSync('outputs',{recursive:true});
  const child=spawnSync(process.execPath,['--import','./scripts/qa/tenant-security-write-preload.mjs','--input-type=module','-e',code],{env,encoding:'utf8'});
  assert.equal(child.status,0,child.stderr);assert.match(child.stdout,/EGRESS_REFUSED/);
});
