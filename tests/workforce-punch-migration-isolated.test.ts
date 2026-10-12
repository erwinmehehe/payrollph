import assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";
import {createHash,randomUUID} from "node:crypto";
import {Client} from "pg";

/**
 * Run the CANONICAL 0120 SQL (not only Drizzle's schema projection) in a
 * disposable namespace of an isolated CI PostgreSQL session, then roll back.
 * This does not modify Neon or establish historical migration receipts.
 */
test("0120 migration is idempotent and rejects tenant/self-review violations in disposable CI schema",{
  skip:process.env.CI!=="true"||!process.env.DATABASE_URL,
},async()=>{
  const schema="wfm_punch_0120_lab_"+randomUUID().replaceAll("-","").slice(0,12);
  assert.match(schema,/^wfm_punch_0120_lab_[0-9a-f]{12}$/);
  const migration=readFileSync("drizzle/0120_wfm_punch_evidence.sql","utf8");
  const sha256=createHash("sha256").update(migration).digest("hex");
  assert.equal(sha256.length,64);
  // Refuse schema DDL outside a disposable loopback CI database.
  const ciHost=new URL(process.env.DATABASE_URL!).hostname;
  assert.ok(ciHost==="localhost"||ciHost==="127.0.0.1"||ciHost==="[::1]",
    "Migration test is restricted to local ephemeral PostgreSQL.");
  const client=new Client({connectionString:process.env.DATABASE_URL});
  await client.connect();
  let started=false;
  async function expectDenied(query:string,params:unknown[],code:string,signal:string){
    await client.query("SAVEPOINT wfm_rejection");
    let denial:unknown=null;
    try{await client.query(query,params);}
    catch(error){denial=error;}
    await client.query("ROLLBACK TO SAVEPOINT wfm_rejection");
    await client.query("RELEASE SAVEPOINT wfm_rejection");
    assert.ok(denial,"The canonical SQL must reject this negative scenario");
    const pgError=denial as {code?:string;message?:string};
    assert.equal(pgError.code,code);
    assert.match(pgError.message??"",new RegExp(signal));
  }
  try{
    await client.query("BEGIN");started=true;
    await client.query("CREATE SCHEMA "+schema);
    await client.query("SET LOCAL search_path TO "+schema+",public");
    // Synthetic parent tables only, never copy employee or payroll records.
    await client.query("CREATE TABLE organizations(id integer PRIMARY KEY)");
    await client.query("CREATE TABLE users(id integer PRIMARY KEY)");
    await client.query("CREATE TABLE employees(id integer PRIMARY KEY,organization_id integer NOT NULL REFERENCES organizations(id))");
    await client.query("CREATE TABLE worksites(id integer PRIMARY KEY,organization_id integer NOT NULL REFERENCES organizations(id))");
    await client.query("CREATE TABLE time_punches(id integer PRIMARY KEY,organization_id integer NOT NULL REFERENCES organizations(id),employee_id integer NOT NULL REFERENCES employees(id))");
    await client.query(migration);
    await client.query(migration); // Rerun must be non-destructive.
    const tables=await client.query(
      "SELECT tablename FROM pg_tables WHERE schemaname=$1 AND tablename=ANY($2::text[]) ORDER BY tablename",
      [schema,["worksite_punch_policies","workforce_punch_photo_consents","workforce_punch_photo_evidence","workforce_punch_submissions"]]);
    assert.equal(tables.rowCount,4);
    const triggers=await client.query(
      "SELECT tgname FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 AND NOT t.tgisinternal",
      [schema]);
    assert.equal(triggers.rowCount,4);
    await client.query("INSERT INTO organizations(id) VALUES(1),(2)");
    await client.query("INSERT INTO users(id) VALUES(11),(12)");
    await client.query("INSERT INTO employees(id,organization_id) VALUES(101,1),(202,2)");
    await client.query("INSERT INTO worksites(id,organization_id) VALUES(301,1),(302,2)");
    await client.query("INSERT INTO time_punches(id,organization_id,employee_id) VALUES(401,2,202)");
    await client.query("INSERT INTO worksite_punch_policies(worksite_id,organization_id) VALUES(301,1)");
    await expectDenied("INSERT INTO worksite_punch_policies(worksite_id,organization_id) VALUES(302,1)",[],"23514","WFM_PUNCH_TENANT_MISMATCH");
    const photoId=randomUUID();
    await client.query(
      "INSERT INTO workforce_punch_photo_evidence(id,organization_id,employee_id,sealed_photo,expires_at) VALUES($1,1,101,'test-ciphertext',now()+interval '90 days')",
      [photoId]);
    await expectDenied(
      "INSERT INTO workforce_punch_photo_evidence(id,organization_id,employee_id,sealed_photo,expires_at) VALUES($1,1,202,'cross-tenant',now()+interval '90 days')",
      [randomUUID()],"23514","WFM_PUNCH_TENANT_MISMATCH");
    const baseParams=[randomUUID(),photoId];
    const insert=await client.query(
      "INSERT INTO workforce_punch_submissions(organization_id,employee_id,client_punch_id,action_type,work_date,device_occurred_at,received_source,worksite_id,photo_evidence_id,device_digest,requested_by_user_id) VALUES(1,101,$1,'clock_in','2026-10-12','2026-10-12T01:00:00Z','offline',301,$2,repeat('a',64),11) RETURNING id",
      baseParams);
    const punchId=insert.rows[0].id as number;
    await expectDenied(
      "UPDATE workforce_punch_submissions SET worksite_id=302 WHERE id=$1",
      [punchId],"23514","WFM_PUNCH_WORKSITE_TENANT_MISMATCH");
    await expectDenied(
      "UPDATE workforce_punch_submissions SET time_punch_id=401 WHERE id=$1",
      [punchId],"23514","WFM_PUNCH_TIMECARD_TENANT_MISMATCH");
    await expectDenied(
      "UPDATE workforce_punch_submissions SET status='approved',reviewed_by_user_id=11,reviewed_at=now(),review_note='Reviewed by same worker',approved_time_source='device' WHERE id=$1",
      [punchId],"23514","WFM_PUNCH_REQUIRES_DISTINCT_HUMAN_CHECKER");
    await client.query(
      "UPDATE workforce_punch_submissions SET status='approved',reviewed_by_user_id=12,reviewed_at=now(),review_note='Independent work checked',approved_time_source='device' WHERE id=$1",
      [punchId]);
    await expectDenied(
      "UPDATE workforce_punch_submissions SET status='rejected' WHERE id=$1",
      [punchId],"23514","WFM_PUNCH_REVIEW_DECISION_IMMUTABLE");
    console.log("Synthetic 0120 rollback-only migration verified; sha256="+sha256);
  }finally{
    if(started)await client.query("ROLLBACK");
    await client.end();
  }
  const verifier=new Client({connectionString:process.env.DATABASE_URL});
  await verifier.connect();
  try{
    const result=await verifier.query("SELECT to_regnamespace($1) IS NULL AS rolled_back",[schema]);
    assert.equal(result.rows[0]?.rolled_back,true,"All synthetic schema changes must roll back");
  }finally{await verifier.end();}
});
