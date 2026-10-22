import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { and, eq } from 'drizzle-orm';

const source=readFileSync('drizzle/0132_filing_remittance_evidence_forward.sql','utf8');
const oneActiveProofIndex=readFileSync('drizzle/0136_statutory_payment_evidence_one_active.sql','utf8');
const enabled=process.env.FILING_FORWARD_REHEARSAL==='synthetic-only';

test('filing forward repair restores real Drizzle reads, preserves outcomes, fails safely and rolls back',{
  skip:!enabled,timeout:90000,
},async()=>{
  const url=new URL(process.env.DATABASE_URL??'');
  assert.ok(['postgres:','postgresql:'].includes(url.protocol));
  assert.ok(['localhost','127.0.0.1'].includes(url.hostname));
  assert.ok(['5432','54942','54943'].includes(url.port));
  assert.equal(url.pathname,'/app_db'); assert.equal(url.username,'postgres');
  assert.equal(url.search,'');assert.equal(url.hash,'');
  const client=new pg.Client({connectionString:url.toString(),query_timeout:60000});
  await client.connect();let active=false;
  const {fullSchemaCatalogSql}=await import('../scripts/check-issue-1031-full-schema-diff.ts');
  const {governmentFilingValidations:filings,statutoryRemittancePaymentEvidence:evidence}=await import('../src/db/schema.ts');
  const tables=['government_filing_validations','statutory_remittance_payment_evidence'];
  const catalog=async()=> (await client.query(fullSchemaCatalogSql)).rows.filter(r=>tables.includes(r.table_name));
  const reject=async(sql,code,marker)=>{
    await client.query('SAVEPOINT rejection');
    try{await assert.rejects(client.query(sql),e=>e.code===code&&(!marker||e.message.includes(marker)));}
    finally{await client.query('ROLLBACK TO SAVEPOINT rejection');await client.query('RELEASE SAVEPOINT rejection');}
  };
  try{
    const identity=(await client.query("SELECT current_database() AS db,current_user AS role,shobj_description(oid,'pg_database') AS marker FROM pg_database WHERE datname=current_database()" )).rows[0];
    assert.deepEqual(identity,{db:'app_db',role:'postgres',marker:'FILING_FORWARD_SYNTHETIC_ONLY'});
    const counts=(await client.query('SELECT (SELECT count(*)::int FROM organizations) AS orgs,(SELECT count(*)::int FROM government_filing_validations) AS filings')).rows[0];
    assert.deepEqual(counts,{orgs:0,filings:0});
    const pristine=await catalog();
    // A real concurrent reader must cause immediate refusal, not a long lock queue.
    const reader=new pg.Client({connectionString:url.toString()});await reader.connect();
    try{
      await reader.query('BEGIN');await reader.query('SELECT id FROM government_filing_validations LIMIT 0');
      await assert.rejects(client.query(source),e=>e.code==='55P03');
    }finally{await reader.query('ROLLBACK');await reader.end();}
    await client.query('BEGIN');active=true;
    await client.query('DROP TABLE statutory_remittance_payment_evidence');
    await client.query('DROP INDEX government_filing_month_idx');
    await client.query('ALTER TABLE government_filing_validations DROP COLUMN applicable_month, DROP COLUMN employee_count, DROP COLUMN reported_total');
    const legacy=await catalog();
    const orgs=(await client.query("INSERT INTO organizations(name,legal_name) VALUES ('Filing synthetic A','Filing A'),('Filing synthetic B','Filing B') RETURNING id")).rows.map(r=>r.id);
    const entities=[];const batches=[];
    for(const org of orgs){
      const entity=(await client.query("INSERT INTO legal_entities(organization_id,code,legal_name,display_name) VALUES ($1,'TEST','Fictional','Fictional') RETURNING id",[org])).rows[0].id;
      entities.push(entity);
      batches.push((await client.query("INSERT INTO statutory_remittance_batches(organization_id,legal_entity_id,agency,applicable_month,due_date,snapshot_hash,created_by) VALUES ($1,$2,'SSS','2026-09','2026-10-31','synthetic','Fictional') RETURNING id",[org,entity])).rows[0].id);
      await client.query("INSERT INTO government_filing_validations(organization_id,legal_entity_id,agency,form,period_label,file_name,file_sha256,generator_version,status,agency_reference,generated_by) VALUES ($1,$2,'SSS','R-3','September 2026','synthetic.csv',$3,'synthetic-v1','accepted','SYNTHETIC-ACCEPTANCE','Fictional')",[org,entity,'a'.repeat(64)]);
    }
    const before=(await client.query('SELECT to_jsonb(f) AS row FROM government_filing_validations f ORDER BY id')).rows;
    const orm=drizzle(client);
    await client.query('SAVEPOINT broken_reads');
    await assert.rejects(async()=>orm.select().from(filings),e=>(e.cause?.code??e.code)==='42703');
    await client.query('ROLLBACK TO SAVEPOINT broken_reads');
    await assert.rejects(async()=>orm.select().from(evidence),e=>(e.cause?.code??e.code)==='42P01');
    await client.query('ROLLBACK TO SAVEPOINT broken_reads');await client.query('RELEASE SAVEPOINT broken_reads');

    const fk=(await client.query("SELECT conname FROM pg_constraint WHERE conrelid='government_filing_validations'::regclass AND confrelid='legal_entities'::regclass AND contype='f'")).rows[0].conname;
    for(const [mutation,marker] of [
      ['ALTER TABLE government_filing_validations ADD COLUMN employee_count integer','LEGACY_COLUMN_COUNT'],
      ['ALTER TABLE government_filing_validations ALTER COLUMN status TYPE varchar(17)','LEGACY_COLUMN_DRIFT'],
      ["ALTER TABLE government_filing_validations ALTER COLUMN status SET DEFAULT 'accepted'",'LEGACY_DEFAULT_DRIFT'],
      ['CREATE INDEX government_filing_month_idx ON organizations(id)','TARGET_OCCUPIED'],
      ['CREATE TABLE statutory_remittance_payment_evidence(id integer)','TARGET_OCCUPIED'],
      ['ALTER TABLE government_filing_validations DROP CONSTRAINT "'+fk+'"','ATTRIBUTION_FK_DRIFT'],
      ['ALTER TABLE users DROP CONSTRAINT users_pkey CASCADE','PARENT_KEY_DRIFT'],
      ['ALTER TABLE statutory_remittance_batches RENAME TO missing_batches','PARENT_MISSING'],
    ]){
      await client.query('SAVEPOINT malformed');await client.query(mutation);
      await reject(source,'P0001','FILING_FORWARD_'+marker);
      await client.query('ROLLBACK TO SAVEPOINT malformed');await client.query('RELEASE SAVEPOINT malformed');
      assert.deepEqual(await catalog(),legacy);
    }
    // A failure after both DDLs must undo the compound operation atomically.
    await reject(source.replace('END\n$filing_remittance_forward$;',"RAISE EXCEPTION 'INJECTED_POST_DDL_FAILURE';\nEND\n$filing_remittance_forward$;"),'P0001','INJECTED_POST_DDL_FAILURE');
    assert.deepEqual(await catalog(),legacy);
    await client.query('SET LOCAL search_path=pg_catalog');
    await client.query(source);
    await client.query('SET LOCAL search_path=public,pg_catalog');
    // The reviewed 0132 repair restores the historical legacy structure.
    // The new forward-only 0136 then restores the additive current-schema
    // one-active-proof index; compare the FULL catalog without filtering it.
    await client.query(oneActiveProofIndex);
    assert.deepEqual(await catalog(),pristine,'exact catalog parity with fresh Drizzle schema');
    const rows=await orm.select().from(filings).where(and(eq(filings.organizationId,orgs[0]),eq(filings.legalEntityId,entities[0])));
    assert.equal(rows.length,1);assert.equal(rows[0].status,'accepted');
    assert.equal(rows[0].applicableMonth,null);assert.equal(rows[0].employeeCount,null);assert.equal(rows[0].reportedTotal,null);
    const after=(await client.query("SELECT to_jsonb(f)-'applicable_month'-'employee_count'-'reported_total' AS row FROM government_filing_validations f ORDER BY id")).rows;
    assert.deepEqual(after,before,'no fabricated snapshots or changed filing outcomes/hashes');
    await orm.update(filings).set({applicableMonth:'2026-09',employeeCount:2,reportedTotal:'1234.56'}).where(eq(filings.organizationId,orgs[0]));
    assert.equal((await orm.select().from(filings).where(and(eq(filings.organizationId,orgs[0]),eq(filings.applicableMonth,'2026-09'))))[0].reportedTotal,'1234.56');
    const uploader=(await client.query("INSERT INTO users(email,name,password_hash) VALUES ('filing@example.invalid','Synthetic','not-a-login') RETURNING id")).rows[0].id;
    for(let i=0;i<2;i++)await orm.insert(evidence).values({organizationId:orgs[i],batchId:batches[i],fileName:'synthetic.pdf',mimeType:'application/pdf',byteSize:5,fileSha256:'b'.repeat(64),fileDataBase64:'JVBERi0=',uploadedByUserId:uploader,uploadedByName:'Synthetic'});
    assert.equal((await orm.select().from(evidence).where(and(eq(evidence.organizationId,orgs[0]),eq(evidence.batchId,batches[0])))).length,1);
    assert.equal((await orm.select().from(evidence).where(and(eq(evidence.organizationId,orgs[0]),eq(evidence.batchId,batches[1])))).length,0);
    await reject("INSERT INTO statutory_remittance_payment_evidence(organization_id,batch_id,file_name,mime_type,byte_size,file_sha256,file_data_base64,uploaded_by_name) SELECT organization_id,batch_id,file_name,mime_type,byte_size,file_sha256,file_data_base64,uploaded_by_name FROM statutory_remittance_payment_evidence LIMIT 1",'23505','statutory_remittance_payment_evidence_hash_unique');
    await reject("INSERT INTO statutory_remittance_payment_evidence(organization_id,batch_id,file_name,mime_type,byte_size,file_sha256,file_data_base64,uploaded_by_name) SELECT organization_id,batch_id,file_name,mime_type,byte_size,repeat('c',64),file_data_base64,uploaded_by_name FROM statutory_remittance_payment_evidence WHERE organization_id=" + orgs[0] + " LIMIT 1",'23505','statutory_remittance_payment_evidence_one_active_unique');
    await reject('UPDATE statutory_remittance_payment_evidence SET batch_id=2147483647 WHERE organization_id='+orgs[0],'23503');
    await client.query('DELETE FROM users WHERE id=$1',[uploader]);
    assert.ok((await orm.select().from(evidence)).every(r=>r.uploadedByUserId===null));
    await client.query('DELETE FROM statutory_remittance_batches WHERE id=$1',[batches[0]]);
    assert.equal((await orm.select().from(evidence)).length,1);
    await reject(source,'P0001','FILING_FORWARD_LEGACY_COLUMN_COUNT');
    await client.query('ROLLBACK');active=false;
    assert.deepEqual(await catalog(),pristine);
    assert.equal((await client.query('SELECT count(*)::int AS n FROM organizations')).rows[0].n,0);
    console.log(JSON.stringify({event:'filing_forward_behavior',missingReadsReproduced:true,exactCatalogParity:true,legacyRowsPreserved:true,scopedQueries:true,negativeCatalogCases:8,lockRefusal:true,compoundRollback:true,duplicateAndForeignKeys:true,outerRollback:true}));
  }finally{if(active)await client.query('ROLLBACK');await client.end();}
});
