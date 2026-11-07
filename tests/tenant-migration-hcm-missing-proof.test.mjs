import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {tsImport} from 'tsx/esm/api';
import {fictionalMigrationXlsx} from '../scripts/qa/fictional-migration-xlsx.mjs';
import {migrationProofBody,MIGRATION_PROOF_KINDS} from '../scripts/qa/migration-method-proof.mjs';
import {validateVetoTarget} from '../scripts/qa/disposable-insert-veto.mjs';
import {assertOwnedSlaResult} from '../scripts/qa/hcm-sla-owned-proof.mjs';
const {xlsxToCsv}=await tsImport('../src/lib/xlsx-import.ts',import.meta.url);
const {parseMigrationCsv}=await tsImport('../src/lib/migration-import.ts',import.meta.url);
test('all four XLSX fixtures survive the actual XLSX and migration parsers',()=>{
  const employer={org:{id:11},worker:{id:22,employeeNo:'FICTIONAL-22'},marker:'FICTIONAL'};
  for(const kind of MIGRATION_PROOF_KINDS){
    const body=migrationProofBody(employer,kind),csv=xlsxToCsv(fictionalMigrationXlsx(body.csv));
    const parsed=parseMigrationCsv({...body,csv});assert.deepEqual(parsed.errors,[]);assert.equal(parsed.rows.length,1);
    assert.deepEqual(parsed.rows,parseMigrationCsv(body).rows,'XLSX and CSV carry identical values, despite CSV quoting');
  }
});
test('insert fault is restricted to disposable CI and two named fixture tables',()=>{
  const safe={CI:'true',GITHUB_ACTIONS:'true',TENANT_SECOND_PASS_MODE:'isolated-ci-only',DATABASE_URL:'postgresql://postgres:postgres@127.0.0.1:5432/app_db',WORKER_ENABLED:'false',CENTRAL_SCHEDULER_ENABLED:'false'};
  validateVetoTarget('audit_events',11,safe);validateVetoTarget('outbox',11,safe);
  for(const delta of [{CI:'false'},{GITHUB_ACTIONS:'false'},{DATABASE_URL:'postgresql://example.invalid/app'},{WORKER_ENABLED:'true'}])assert.throws(()=>validateVetoTarget('audit_events',11,{...safe,...delta}));
  assert.throws(()=>validateVetoTarget('users',11,safe));assert.throws(()=>validateVetoTarget('audit_events','11;DROP TABLE users',safe));
});
test('worker proof rejects another employer case, event, recipient and outbox',()=>{
  const subject={orgId:11,caseId:31,email:'fictional@example.invalid'};
  const result={cases:[{id:31,organization_id:11,escalation_level:1,escalated_at:new Date()}],events:[{organization_id:11,case_id:31,event_type:'sla_escalated'}],emails:[{organization_id:11,recipient:subject.email,dedupe_key:'hcm-sla:11:31:date:email'}]};
  assertOwnedSlaResult(result,subject);
  for(const [table,key] of [['cases','organization_id'],['events','organization_id'],['emails','organization_id'],['emails','recipient']]){
    const forged=structuredClone(result);forged[table][0][key]=99;
    assert.throws(()=>assertOwnedSlaResult(forged,subject),/accepts another employer's data/);
  }
});
test('new runtime branches actually invoke fault and discrimination assertions',()=>{
  const migration=readFileSync('scripts/qa/tenant-requested-migrations-http.mjs','utf8');
  const hcm=readFileSync('scripts/qa/tenant-hcm-sla-escalate-http.mjs','utf8');
  assert.ok(migration.includes("withDisposableInsertVeto(pool,'audit_events'"));
  assert.ok(migration.includes('fictionalMigrationXlsx(payload.csv)'));
  assert.ok(migration.includes('auditVetoRollbacks:8,xlsxCommits:8,xlsxForeignDenials:8'));
  assert.ok(hcm.includes("withDisposableInsertVeto(fixtureConnection,'outbox'"));
  assert.ok(hcm.includes('assertOwnedSlaResult({cases,events,emails},org)'));
  assert.ok(hcm.includes('assert.throws(()=>assertOwnedSlaResult(item,other)'));
});
