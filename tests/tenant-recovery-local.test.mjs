import assert from 'node:assert/strict';
import test from 'node:test';
import {resolve} from 'node:path';
import {requireLocalRecovery,assertLocalRecoveryDatabase,OFF,ABSENT,RECOVERY_MODE} from '../scripts/qa/tenant-recovery-local-contract.mjs';
const safe={TENANT_RECOVERY_MODE:RECOVERY_MODE,DATABASE_URL:'postgresql://postgres:postgres@127.0.0.1:5432/app_db',
  SECURITY_SMOKE_URL:'http://127.0.0.1:3000',APP_BASE_URL:'https://payroll.example.test',NODE_ENV:'production',
  DEMO_MODE:'false',REQUIRE_PRIVILEGED_MFA:'true',TENANT_RECOVERY_PGDATA:resolve('outputs/recovery-pg16'),
  ...Object.fromEntries(OFF.map(k=>[k,'false'])),...Object.fromEntries(['PII_ENCRYPTION_KEY','BANK_DATA_ENCRYPTION_KEY','TOTP_ENCRYPTION_KEY'].map(k=>[k,'a'.repeat(64)]))};
test('local recovery refuses hosted identity, unrelated DB, enabled money/worker flags and external credentials',()=>{
  requireLocalRecovery(safe);
  for(const patch of [{GITHUB_ACTIONS:'true'},{DATABASE_URL:'postgresql://postgres:postgres@example.test/app_db'},
    {TENANT_RECOVERY_MODE:''},{TENANT_RECOVERY_PGDATA:resolve('outputs/other')},
    {SECURITY_SMOKE_URL:'https://example.test'},...OFF.map(k=>({[k]:'true'})),...ABSENT.map(k=>({[k]:'fictional-present'}))])
    assert.throws(()=>requireLocalRecovery({...safe,...patch}),/RECOVERY_REFUSED/);
});
test('database identity is checked before accepting local execution',async()=>{
  const previous={...process.env};Object.assign(process.env,safe);delete process.env.GITHUB_ACTIONS;
  try{await assert.rejects(assertLocalRecoveryDatabase({query:async()=>({rows:[{version:'180000',name:'app_db',dir:'.'}]})}),/actual PG16/);}
  finally{for(const k of Object.keys(process.env))if(!(k in previous))delete process.env[k];Object.assign(process.env,previous);}
});
