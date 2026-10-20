/**
 * #1102 committed operator-SQL rehearsal. GitHub Actions disposable app_db ONLY.
 * Original SQL is executed unmodified for wrong-target refusal, then a CI-only
 * in-memory adaptation replaces 1 DB name and 7 before-image fingerprints
 * with local synthetic witnesses. Neon GUCs are emulated only in this isolated
 * session. All remaining reviewed SQL is identical, including final ROLLBACK.
 * It never executes against Neon or changes real payroll data.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import pg from "pg";

const FILE = "docs/sql/issue-1102-legacy-fictitious-header-REVIEW-ONLY.sql";
const CONNECTION = "postgresql://postgres:postgres@127.0.0.1:5432/app_db";
const IDENTITY = [
  ["neon.project_id", "calm-wave-70219564"],
  ["neon.branch_id", "br-lucky-sound-b79i56jw"],
  ["neon.endpoint_id", "ep-cool-hat-b7e7gpoo"],
];
const expectedRuns = [
  {id:1, beforeGross:"176300.00",beforeNet:"145645.00",afterGross:"181300.00",afterNet:"147400.00",sourceHash:"ff19c0614e6c7a840dcded961b8d8fbe"},
  {id:2, beforeGross:"181250.00",beforeNet:"149768.00",afterGross:"182800.00",afterNet:"148600.00",sourceHash:"42a9c09537efaf55480d47c3cd71fc93"},
  {id:3, beforeGross:"183400.00",beforeNet:"151524.00",afterGross:"184300.00",afterNet:"149800.00",sourceHash:"12a911dd1d4f0f9dbe844377b26fb561"},
];
const immutableTableHashes = [
  {table:"payroll_entries",sourceHash:"1e19bf4a0bc4b0717b7be848945abc2e"},
  {table:"employees",sourceHash:"3d061f144881d46c8ef4fba3d258ec78"},
  {table:"audit_events",sourceHash:"8a1ed09531b7621c30aee14793e28134"},
  {table:"organizations",sourceHash:"906294baa0f4469a704bd60b465677dd"},
];
const requiredTables = [
  "approval_tasks","bank_file_validations","government_filing_validations",
  "managed_payroll_run_approvals","payroll_jobs","employee_pay_retro_adjustments",
  "payslips","payout_batches","payout_transfers","provider_events",
  "payroll_underpayment_requests","year_end_adjustments","supplementary_earnings",
  "expense_claims","earned_wage_requests","loan_payments","leave_conversions",
  "workforce_timesheet_expectations","attendance_correction_requests",
];
function guard() {
  assert.equal(process.env.GITHUB_ACTIONS,"true","GITHUB_ACTIONS_REQUIRED");
  assert.equal(process.env.CI,"true","CI_REQUIRED");
  assert.equal(process.env.NODE_ENV,"test","TEST_ENV_REQUIRED");
  assert.equal(process.env.DEMO_MODE,"true","DEMO_ONLY");
  assert.equal(process.env.GITHUB_REPOSITORY,"erwinmehehe/payrollph","REPO_GUARD");
  assert.equal(process.env.DATABASE_URL,CONNECTION,"DISPOSABLE_LOOPBACK_ONLY");
  assert.equal(process.env.PRODUCTION_DATABASE_URL,undefined,"NO_PROD_DATABASE_URL");
  for(const name of ["PAYMONGO_DISBURSEMENTS_ENABLED","XENDIT_PAYOUTS_ENABLED","XENDIT_PAYOUTS_LIVE_APPROVED"]){
    assert.equal(process.env[name],"false",name);
  }
}
function replaceOnce(source, from, to) {
  assert.notEqual(from,to);
  const first=source.indexOf(from);
  assert.ok(first>=0,"MISSING_EXPECTED_SQL_LITERAL_"+from);
  assert.equal(source.indexOf(from,first+1),-1,"DUPLICATE_SQL_LITERAL_"+from);
  return source.slice(0,first)+to+source.slice(first+from.length);
}
async function baseline(client) {
  const identities=(await client.query(
    "SELECT (SELECT count(*)::int FROM public.organizations) AS orgs, "+
    "(SELECT count(*)::int FROM public.employees) AS employees, "+
    "(SELECT count(*)::int FROM public.payroll_runs) AS runs, "+
    "(SELECT count(*)::int FROM public.payroll_entries) AS entries"
  )).rows[0];
  assert.deepEqual(identities,{orgs:1,employees:8,runs:3,entries:18},
    "REQUIRES_PRIOR_FICTIONAL_SEEDED_REHEARSAL");
  const runs=(await client.query(
    "SELECT r.id,md5(row_to_json(r)::text) AS fingerprint, "+
    "r.gross_pay::numeric(18,2)::text AS gross,r.net_pay::numeric(18,2)::text AS net "+
    "FROM public.payroll_runs r ORDER BY r.id"
  )).rows;
  for(const spec of expectedRuns){
    const row=runs.find(x=>x.id===spec.id);
    assert.ok(row);
    assert.equal(row.gross,spec.beforeGross);
    assert.equal(row.net,spec.beforeNet);
  }
  const hashByTable={};
  for(const {table} of immutableTableHashes){
    const rows=await client.query(
      "SELECT md5(coalesce(string_agg(row_to_json(e)::text,'|' ORDER BY e.id),'')) AS hash "+
      "FROM public."+table+" e"
    );
    hashByTable[table]=rows.rows[0].hash;
    assert.match(hashByTable[table],/^[a-f0-9]{32}$/);
  }
  return {identities,runs,hashByTable};
}
function adaptOnlyFixtureWitnesses(source,state) {
  // This is a REHEARSAL-ONLY transformation; never write this version to Git.
  let sql=replaceOnce(source,
    "current_database() IS DISTINCT FROM 'neondb'",
    "current_database() IS DISTINCT FROM 'app_db'");
  for(const spec of expectedRuns){
    const row=state.runs.find(x=>x.id===spec.id);
    assert.ok(row);
    sql=replaceOnce(sql,"'"+spec.sourceHash+"'","'"+row.fingerprint+"'");
  }
  for(const spec of immutableTableHashes){
    sql=replaceOnce(sql,"'"+spec.sourceHash+"'","'"+state.hashByTable[spec.table]+"'");
  }
  assert.match(sql,/\nROLLBACK;\s*$/);
  return sql;
}
async function assertRefusal(client,source,message) {
  let error;
  try { await client.query(source); }
  catch(e){error=e;}
  await client.query("ROLLBACK");
  assert.ok(error,"SQL_DID_NOT_REFUSE");
  assert.match(String(error.message),new RegExp(message));
}
async function testDependency(client,source,test) {
  const insertion=await client.query(test.insert);
  assert.equal(insertion.rowCount,1,test.name+"_INSERT");
  try {
    await assertRefusal(client,source,"ISSUE1102_RUN_HAS_CONNECTED_PAYROLL_OR_FINANCIAL_EVIDENCE");
  } finally {
    await client.query("DELETE FROM public."+test.table+" WHERE id=$1",[insertion.rows[0].id]);
  }
}
async function main() {
  guard();
  const source=readFileSync(FILE,"utf8");
  assert.match(source,/BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE;/);
  assert.match(source,/\nROLLBACK;\s*$/,"DEFAULT_MUST_ROLLBACK");
  assert.equal((source.match(/\bUPDATE\s+public\.payroll_runs\s+r\b/gi)||[]).length,1,
    "EXACTLY_ONE_TARGET_UPDATE_STATEMENT");
  for(const table of requiredTables){
    assert.ok(source.includes("FROM public."+table),
      "MISSING_SOURCE_DEPENDENCY_GUARD_"+table);
  }
  const client=new pg.Client({connectionString:CONNECTION,connectionTimeoutMillis:5000});
  await client.connect();
  try {
    const state=await baseline(client);
    // Byte-for-byte committed SQL MUST reject the local (not Neon) database.
    await assertRefusal(client,source,"ISSUE1102_WRONG_DATABASE_PROJECT_BRANCH_OR_ENDPOINT");
    assert.deepEqual(await baseline(client),state,"RAW_SQL_WRONG_TARGET_CHANGED_FIXTURE");
    for(const [setting,value] of IDENTITY){
      await client.query("SELECT set_config($1,$2,false)",[setting,value]);
    }
    const localSql=adaptOnlyFixtureWitnesses(source,state);
    const notices=[];
    client.on("notice",event=>notices.push(String(event.message)));
    const result=await client.query(localSql);
    assert.ok(Array.isArray(result),"EXPECTED_MULTI_STATEMENT_ROLLBACK_SQL");
    const aggregates=result.find(x=>x.rows?.length===3&&x.rows[0]?.proposed_gross!==undefined);
    assert.ok(aggregates,"THREE_PROPOSED_HEADER_ROWS_MISSING");
    for(const spec of expectedRuns){
      const row=aggregates.rows.find(x=>x.id===spec.id);
      assert.ok(row);
      assert.equal(row.proposed_gross,spec.afterGross);
      assert.equal(row.proposed_net,spec.afterNet);
      assert.equal(row.detail_gross,spec.afterGross);
      assert.equal(row.detail_net,spec.afterNet);
      assert.equal(row.detail_count,6);
    }
    assert.ok(notices.some(x=>x.includes("ISSUE1102_DRY_RUN_PASSED_3_FICTIONAL_HEADER_PAIRS")),
      "PROPOSED_TOTALS_NOT_ACTUALLY_VALIDATED");
    assert.deepEqual(await baseline(client),state,"DEFAULT_ROLLBACK_FAILED");
    const tests=[
      {name:"prepared_payout_batch",table:"payout_batches",
       insert:"INSERT INTO public.payout_batches "+
       "(organization_id,payroll_run_id,idempotency_key,request_hash,transfer_count,total_amount_cents) "+
       "VALUES (1,1,'issue1102-qa-batch','fixture-only',1,100) RETURNING id"},
      {name:"prepared_payout_transfer",table:"payout_transfers",
       insert:"INSERT INTO public.payout_transfers "+
       "(organization_id,payroll_run_id,payroll_entry_id,employee_id,reference_number,amount_cents) "+
       "SELECT 1,1,e.id,e.employee_id,'issue1102-qa-transfer',100 "+
       "FROM public.payroll_entries e WHERE e.payroll_run_id=1 ORDER BY e.id LIMIT 1 RETURNING id"},
      {name:"provider_event",table:"provider_events",
       insert:"INSERT INTO public.provider_events "+
       "(provider,event_id,organization_id,payroll_run_id,event_type) "+
       "VALUES ('synthetic','issue1102-qa-provider',1,1,'QAOnly') RETURNING id"},
    ];
    for(const test of tests){
      await testDependency(client,localSql,test);
      assert.deepEqual(await baseline(client),state,test.name+"_CHANGED_CORE_FIXTURES");
    }
    // Exercise the reviewed SQL against the older generation: absent optional
    // relations contain no dependencies, while all core before-images remain.
    const optionalTables=requiredTables.slice(7);
    const hidden=[];
    try {
      for(const table of optionalTables){
        await client.query('ALTER TABLE public.'+table+' RENAME TO issue1102_hidden_'+table);
        hidden.push(table);
      }
      await client.query(localSql);
      assert.deepEqual(await baseline(client),state,"LEGACY_SCHEMA_ROLLBACK_FAILED");
    } finally {
      for(const table of hidden.reverse()){
        await client.query('ALTER TABLE public.issue1102_hidden_'+table+' RENAME TO '+table);
      }
    }
    console.log(JSON.stringify({
      result:"PASS",scope:"DISPOSABLE_GITHUB_POSTGRES_ONLY",
      unmodifiedSqlWrongTargetDenied:true,
      inMemoryAdaptation:"database-name and seven synthetic MD5 witnesses only",
      actualOriginalNeonRowsTested:false,
      sourceFilePreservesRollback:true,
      absentOptionalRelationsRehearsed:optionalTables.length,
      proposedRunPairsReconciled:3,
      linkedDependencyDenials:tests.map(x=>x.name),
      allHistoricalHeaderRowsRestored:true,
      productionNeonTouched:false,
      realEmployerAcceptance:false
    }));
  } finally { await client.end(); }
}
main().catch(error=>{
  console.error("ISSUE1102_OPERATOR_SQL_REHEARSAL_FAILED: "+
    (error instanceof Error?error.message:String(error)).slice(0,500));
  process.exitCode=1;
});
