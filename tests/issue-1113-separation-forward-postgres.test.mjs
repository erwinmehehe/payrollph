import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import test from 'node:test';
import pg from 'pg';
import {drizzle} from 'drizzle-orm/node-postgres';
import {and,eq} from 'drizzle-orm';
import {getTableConfig} from 'drizzle-orm/pg-core';
import {assertIsolatedMigrationTarget} from '../scripts/lib/isolated-migration-target.mjs';

const file='drizzle/0131_separation_record_forward_repair.sql';
const source=readFileSync(file,'utf8');
const added=['thirteenth_entitlement','thirteenth_paid_ytd','basic_salary_earned_ytd',
  'historical_basic_salary_earned','unpaid_basic_salary','separation_pay','retirement_pay',
  'other_benefits','final_statutory_deductions','gross_final_pay','final_pay_due_date',
  'computation_snapshot','approved_at','released_at','release_reference',
  'prepared_by_user_id','approved_by_user_id','released_by_user_id'];
const quote=name=>'"'+name.replaceAll('"','""')+'"';
async function catalog(db){
  return (await db.query(`SELECT
    (SELECT jsonb_agg(jsonb_build_object('oid',a.attnum,'name',a.attname,
      'type',format_type(a.atttypid,a.atttypmod),'notNull',a.attnotnull,
      'default',pg_get_expr(d.adbin,d.adrelid)) ORDER BY a.attname)
      FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
      WHERE a.attrelid='public.separation_records'::regclass AND a.attnum>0 AND NOT a.attisdropped) AS columns,
    (SELECT jsonb_agg(jsonb_build_object('oid',oid,'name',conname,'definition',pg_get_constraintdef(oid),
      'validated',convalidated,'deferred',condeferrable) ORDER BY conname)
      FROM pg_constraint WHERE conrelid='public.separation_records'::regclass) AS constraints,
    (SELECT jsonb_agg(jsonb_build_object('name',indexname,'definition',indexdef) ORDER BY indexname)
      FROM pg_indexes WHERE schemaname='public' AND tablename='separation_records') AS indexes`)).rows[0];
}
async function rejected(db,statement,code,marker){
  await db.query('SAVEPOINT rejected');
  try {await assert.rejects(()=>db.query(statement),e=>e.code===code&&(!marker||e.message.includes(marker)));}
  finally {await db.query('ROLLBACK TO SAVEPOINT rejected');await db.query('RELEASE SAVEPOINT rejected');}
}

test('#1113: actual old-schema Drizzle failure, 18-column repair, money/tenancy/actor preservation and rollback',{
  skip:process.env.ISSUE_1113_REHEARSAL!=='isolated-ci-only',timeout:120000,
},async()=>{
  const {separationRecords}=await import('../src/db/schema.ts');
  const url=assertIsolatedMigrationTarget(process.env);
  const db=new pg.Client({connectionString:url,query_timeout:90000});
  await db.connect();
  let active=false;
  try {
    const identity=(await db.query('SELECT current_database() AS db,current_user AS role,current_setting(\'server_version_num\')::int AS version')).rows[0];
    const major=Number(process.env.ISSUE_1113_PG_MAJOR);
    assert.ok([16,18].includes(major)&&identity.db==='app_db'&&identity.role==='postgres'
      &&Math.floor(identity.version/10000)===major);
    assert.deepEqual((await db.query('SELECT (SELECT count(*)::int FROM organizations) AS orgs,(SELECT count(*)::int FROM employees) AS employees,(SELECT count(*)::int FROM separation_records) AS separations')).rows[0],{orgs:0,employees:0,separations:0});
    const original=await catalog(db);
    await db.query('BEGIN');active=true;

    // Busy-reader rejection is exercised before this transaction owns DDL locks.
    const reader=new pg.Client({connectionString:url});await reader.connect();
    try {
      await reader.query('BEGIN');await reader.query('SELECT id FROM separation_records LIMIT 0');
      await rejected(db,source,'55P03');
    } finally {await reader.query('ROLLBACK');await reader.end();}

    const orgs=(await db.query("INSERT INTO organizations(name,legal_name) VALUES ('sep-1113-a','Synthetic A'),('sep-1113-b','Synthetic B') RETURNING id")).rows.map(x=>x.id);
    const workers=[];
    for(const org of orgs)workers.push((await db.query("INSERT INTO employees(organization_id,employee_no,first_name,last_name,title,avatar_initials,basic_rate,start_date) VALUES ($1,'SAME-ID','Synthetic','Worker','Test','SW',100,'2026-01-01') RETURNING id",[org])).rows[0].id);
    // Reproduce exactly the 20-column historical table; no shared/real data exists.
    await db.query('ALTER TABLE separation_records DROP CONSTRAINT separation_review_identity_separation_check');
    await db.query('DROP INDEX separation_records_org_status_idx');
    await db.query('ALTER TABLE separation_records '+added.map(x=>'DROP COLUMN '+quote(x)+' CASCADE').join(','));
    const legacy=await catalog(db);assert.equal(legacy.columns.length,20);
    const ids=[];
    for(let i=0;i<2;i++)ids.push((await db.query("INSERT INTO separation_records(organization_id,employee_id,separation_type,notice_date,last_day,net_final_pay,tax_adjustment,loan_deductions,status) VALUES ($1,$2,'resignation','2026-01-01','2026-01-31',12345.67,-432.10,77.77,'approved') RETURNING id",[orgs[i],workers[i]])).rows[0].id);
    const before=(await db.query('SELECT to_jsonb(s) AS row FROM separation_records s ORDER BY id')).rows;
    const orm=drizzle(db);
    await db.query('SAVEPOINT missing_select');
    try {await assert.rejects(()=>orm.select().from(separationRecords).where(eq(separationRecords.organizationId,orgs[0])),e=>(e.cause?.code??e.code)==='42703');}
    finally {await db.query('ROLLBACK TO SAVEPOINT missing_select');await db.query('RELEASE SAVEPOINT missing_select');}

    const probes=[
      ['partial column',"ALTER TABLE separation_records ADD COLUMN gross_final_pay numeric(12,2)",'COLUMNS_ALREADY_PRESENT'],
      ['wrong existing type',"ALTER TABLE separation_records ALTER COLUMN status TYPE varchar(64)",'LEGACY_COLUMN_DRIFT'],
      ['missing PK','ALTER TABLE separation_records DROP CONSTRAINT separation_records_pkey CASCADE','PRIMARY_KEY_DRIFT'],
      ['occupied index','CREATE INDEX separation_records_org_status_idx ON organizations(id)','TARGET_NAME_OCCUPIED'],
      ['occupied check','ALTER TABLE separation_records ADD CONSTRAINT separation_review_identity_separation_check CHECK(true)','TARGET_NAME_OCCUPIED'],
    ];
    const fk=(await db.query("SELECT conname FROM pg_constraint WHERE conrelid='separation_records'::regclass AND contype='f' AND confrelid='employees'::regclass")).rows[0].conname;
    probes.push(['missing tenant FK','ALTER TABLE separation_records DROP CONSTRAINT '+quote(fk),'TENANT_FK_DRIFT']);
    for(const [label,mutation,marker] of probes){
      await db.query('SAVEPOINT mutation');
      await db.query(mutation);await rejected(db,source,'P0001','ISSUE1113_SEPARATION_'+marker);
      await db.query('ROLLBACK TO SAVEPOINT mutation');await db.query('RELEASE SAVEPOINT mutation');
      assert.deepEqual(await catalog(db),legacy,label+' must restore exact old catalog');
    }
    await db.query(source);
    const repaired=await catalog(db);
    const expected=getTableConfig(separationRecords).columns.map(c=>({name:c.name,type:c.getSQLType().replace(/^serial$/,'integer').replace(/^varchar/,'character varying').replaceAll(', ',','),notNull:c.notNull})).sort((a,b)=>a.name.localeCompare(b.name));
    const actual=repaired.columns.map(c=>({name:c.name,type:c.type,notNull:c.notNull})).sort((a,b)=>a.name.localeCompare(b.name));
    assert.deepEqual(actual,expected,'all 38 actual app column contracts restored');
    const selected=await orm.select().from(separationRecords).where(eq(separationRecords.organizationId,orgs[0]));
    assert.equal(selected.length,1);assert.equal(selected[0].id,ids[0]);
    assert.equal(selected[0].netFinalPay,'12345.67');assert.equal(selected[0].taxAdjustment,'-432.10');
    assert.equal(selected[0].loanDeductions,'77.77');assert.equal(selected[0].status,'approved');
    assert.equal(selected[0].preparedByUserId,null);assert.equal(selected[0].approvedByUserId,null);
    assert.equal(selected[0].releasedByUserId,null);assert.deepEqual(selected[0].computationSnapshot,{});
    assert.equal((await orm.select().from(separationRecords).where(and(eq(separationRecords.organizationId,orgs[1]),eq(separationRecords.id,ids[0])))).length,0,'app tenant predicates do not expose employer A record to B');
    // Every old field/value is byte-for-byte unchanged, including both employers.
    const preserved=(await db.query('SELECT to_jsonb(s) - $1::text[] AS row FROM separation_records s ORDER BY id',[added])).rows;
    assert.deepEqual(preserved,before);
    await rejected(db,source,'P0001','COLUMNS_ALREADY_PRESENT');
    await rejected(db,'UPDATE separation_records SET prepared_by_user_id=-123 WHERE id='+ids[0],'23503');
    const actor=(await db.query("INSERT INTO users(name,email,password_hash) VALUES ('Synthetic','sep-1113@example.invalid','not-a-password') RETURNING id")).rows[0].id;
    await rejected(db,'UPDATE separation_records SET prepared_by_user_id='+actor+',approved_by_user_id='+actor+' WHERE id='+ids[0],'23514');
    await db.query('UPDATE separation_records SET prepared_by_user_id=$1 WHERE id=$2',[actor,ids[0]]);
    await db.query('DELETE FROM users WHERE id=$1',[actor]);
    assert.equal((await db.query('SELECT prepared_by_user_id FROM separation_records WHERE id=$1',[ids[0]])).rows[0].prepared_by_user_id,null,'actor FK retains ON DELETE SET NULL');
    await db.query('ROLLBACK');active=false;
    assert.deepEqual(await catalog(db),original,'outer rollback restores complete original catalog including OIDs');
    assert.equal((await db.query('SELECT count(*)::int AS n FROM organizations')).rows[0].n,0);
    console.log(JSON.stringify({event:'issue1113_separation_repair',major,sourceSha256:createHash('sha256').update(source).digest('hex'),added:18,oldSchemaDrizzleError:'42703',appReadRestored:true,tenantScopedRead:true,moneyPreserved:true,actorsNotInvented:true,malformedCatalogRejected:probes.map(p=>p[0]),readerLockRejected:true,replayRejected:true,actorFkAndCheckerEnforced:true,rollbackVerified:true,productionContact:false}));
  }finally{if(active)await db.query('ROLLBACK');await db.end();}
});
