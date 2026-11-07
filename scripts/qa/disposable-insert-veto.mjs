import assert from 'node:assert/strict';

export function validateVetoTarget(table,organizationId,env=process.env){
  assert.equal(env.GITHUB_ACTIONS,'true');assert.equal(env.CI,'true');
  assert.equal(env.DATABASE_URL,'postgresql://postgres:postgres@127.0.0.1:5432/app_db');
  assert.equal(env.TENANT_SECOND_PASS_MODE,'isolated-ci-only');
  assert.equal(env.WORKER_ENABLED,'false');assert.equal(env.CENTRAL_SCHEDULER_ENABLED,'false');
  assert.ok(['audit_events','outbox'].includes(table));
  assert.ok(Number.isSafeInteger(organizationId)&&organizationId>0);
}

// A deliberately rejecting trigger in the isolated workflow DB, never app code.
// Its error must unwind the actual HTTP handler's complete transaction.
export async function withDisposableInsertVeto(pool,table,organizationId,run){
  validateVetoTarget(table,organizationId);
  const client=await pool.connect();let created=false,installed=false;
  try{
    const prior=await client.query("SELECT to_regprocedure('public.qa_proof_insert_veto()') AS existing");
    assert.equal(prior.rows[0].existing,null,'never replace an existing database object');
    await client.query("CREATE FUNCTION public.qa_proof_insert_veto() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fictional proof insert veto'; END $$");created=true;
    await client.query('CREATE TRIGGER qa_proof_insert_veto BEFORE INSERT ON '+table+' FOR EACH ROW WHEN (NEW.organization_id = '+organizationId+') EXECUTE FUNCTION public.qa_proof_insert_veto()');installed=true;
    return await run();
  }finally{
    try{if(installed)await client.query('DROP TRIGGER qa_proof_insert_veto ON '+table);}
    finally{try{if(created)await client.query('DROP FUNCTION public.qa_proof_insert_veto()');}finally{client.release();}}
  }
}
