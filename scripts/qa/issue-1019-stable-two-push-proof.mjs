#!/usr/bin/env node
/**
 * #1019 real pinned-toolchain two-push proof on disposable PG16 or PG18.
 * No real databases, credentials, migrations, or application-row reads.
 */
import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";

const TARGET = "postgresql://postgres:postgres@127.0.0.1:5432/app_db";
const artifact = resolve("qa-artifacts/issue-1019-stable-repeat-proof.json");
const forbidden = ["NEON_DATABASE_URL", "MIGRATION_TARGET_DATABASE_URL", "PRODUCTION_DATABASE_URL",
  "PAYMONGO_SECRET_KEY", "XENDIT_SECRET_KEY", "OPENAI_API_KEY"];
const major = Number(process.env.PG_MAJOR);

function fail(code) { throw new Error("ISSUE_1019_" + code); }
function verifyEnvironment(env) {
  if (env.CI !== "true" || env.GITHUB_ACTIONS !== "true" ||
      env.ISSUE_1019_REHEARSAL !== "disposable-ci-only" ||
      env.DATABASE_URL !== TARGET ||
      !["16","18"].includes(env.PG_MAJOR) ||
      env.PAYMONGO_DISBURSEMENTS_ENABLED !== "false" ||
      env.XENDIT_PAYOUTS_ENABLED !== "false" ||
      forbidden.some(key => Boolean(env[key]))) fail("UNSAFE_CI_TARGET");
}
const catalogSql = {
  relations: "SELECT c.relname AS name, c.relkind AS kind FROM pg_catalog.pg_class c " +
    "JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace " +
    "WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','S') ORDER BY c.relname,c.relkind",
  columns: "SELECT c.relname AS relation,a.attname AS name," +
    "pg_catalog.format_type(a.atttypid,a.atttypmod) AS data_type,a.attnotnull AS required," +
    "COALESCE(pg_catalog.pg_get_expr(d.adbin,d.adrelid),'') AS default_expr," +
    "a.attidentity AS identity,a.attgenerated AS generated FROM pg_catalog.pg_attribute a " +
    "JOIN pg_catalog.pg_class c ON c.oid=a.attrelid " +
    "JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace " +
    "LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum " +
    "WHERE n.nspname='public' AND c.relkind IN ('r','p') AND a.attnum>0 AND NOT a.attisdropped " +
    "ORDER BY c.relname,a.attnum",
  constraints: "SELECT c.relname AS relation,k.conname AS name,k.contype AS kind," +
    "pg_catalog.pg_get_constraintdef(k.oid,true) AS definition,k.convalidated AS validated " +
    "FROM pg_catalog.pg_constraint k JOIN pg_catalog.pg_class c ON c.oid=k.conrelid " +
    "JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace " +
    "WHERE n.nspname='public' ORDER BY c.relname,k.conname",
  indexes: "SELECT tablename AS table_name,indexname AS name,indexdef AS definition FROM " +
    "pg_catalog.pg_indexes WHERE schemaname='public' ORDER BY tablename,indexname",
};

function assertTenantKeys(constraints) {
  const unique = constraints.find(x => x.relation === "documents" &&
    x.name === "documents_org_employee_id_hr_cases_unique");
  const fk = constraints.find(x => x.relation === "employee_hr_cases" &&
    x.name === "employee_hr_cases_coe_document_tenant_fk");
  const caseFk = constraints.find(x => x.relation === "employee_hr_case_messages" &&
    x.name === "employee_hr_case_messages_case_tenant_fk");
  const norm = x => String(x?.definition ?? "").replaceAll('"',"").replace(/\s+/g," ").trim();
  assert.match(norm(unique),/^UNIQUE \(organization_id, employee_id, id\)$/i);
  assert.match(norm(fk),/^FOREIGN KEY \(organization_id, employee_id, coe_document_id\) REFERENCES (?:public\.)?documents\(organization_id, employee_id, id\)$/i);
  assert.match(norm(caseFk),/^FOREIGN KEY \(organization_id, case_id\) REFERENCES (?:public\.)?employee_hr_cases\(organization_id, id\) ON DELETE CASCADE$/i);
  for (const c of [unique,fk,caseFk]) assert.equal(c.validated,true, "no NOT VALID security constraints");
}

async function readCatalogObjects(client) {
  const tables = {};
  for (const [key,sql] of Object.entries(catalogSql))
    tables[key] = (await client.query(sql)).rows;
  return tables;
}
async function catalog(client) {
  await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
  try {
    const rows = await readCatalogObjects(client);
    await client.query("COMMIT");
    return rows;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  }
}
function summarize(c) {
  if (c.relations.filter(x=>x.kind==="r"||x.kind==="p").length < 270 ||
      c.columns.length < 150 || c.constraints.length < 40 || c.indexes.length < 35)
    fail("INCOMPLETE_FIRST_SCHEMA_PUSH");
  assertTenantKeys(c.constraints);
  return {
    tables: c.relations.filter(x => x.kind==="r"||x.kind==="p").length,
    columns:c.columns.length,constraints:c.constraints.length,indexes:c.indexes.length,
    sha256:createHash("sha256").update(JSON.stringify(c)).digest("hex")
  };
}

// Store only hashes of public schema metadata. No user rows or SQL are logged.
function objectDigests(c) {
  const key = {
    relations: x => x.name + "#" + x.kind,
    columns: x => x.relation + "." + x.name,
    constraints: x => x.relation + "." + x.name,
    indexes: x => x.table_name + "." + x.name,
  };
  return Object.fromEntries(Object.entries(c).map(([type,rows])=>[type,
    Object.fromEntries(rows.map(x=>[key[type](x),
      createHash("sha256").update(JSON.stringify(x)).digest("hex")]))
  ]));
}
function reportCatalogDelta(previous, current) {
  for(const group of ["relations","columns","constraints","indexes"]) {
    const old = previous.objectDigests?.[group] || {};
    const next = objectDigests(current)[group];
    const added=Object.keys(next).filter(k=>!(k in old));
    const removed=Object.keys(old).filter(k=>!(k in next));
    const modified=Object.keys(next).filter(k=>k in old && next[k]!==old[k]);
    // Names are source schema metadata, not DDL or user data.
    process.stdout.write("ISSUE_1019_CATALOG_DELTA_"+group.toUpperCase()+"="+
      JSON.stringify({added:added.slice(0,20),removed:removed.slice(0,20),
        modified:modified.slice(0,20),counts:[added.length,removed.length,modified.length]})+"\\n");
  }
}

async function negativeTenantProof(client) {
  await client.query("BEGIN");
  try {
    const orgQuery="INSERT INTO organizations(name,legal_name) VALUES($1,$1) RETURNING id";
    const a=(await client.query(orgQuery,["Fictional #1019 Employer A"])).rows[0].id;
    const b=(await client.query(orgQuery,["Fictional #1019 Employer B"])).rows[0].id;
    const user=(await client.query(
      "INSERT INTO users(email,name,password_hash) VALUES('issue1019@synthetic.invalid','Fictional Test User','no-credential') RETURNING id"
    )).rows[0].id;
    const employeeQuery="INSERT INTO employees (organization_id,employee_no,first_name,last_name,title,avatar_initials,basic_rate,start_date) " +
      "VALUES ($1,$2,'Fictional','Worker','QA Role','FW',1200,DATE '2026-01-01') RETURNING id";
    const ea=(await client.query(employeeQuery,[a,"1019-A"])).rows[0].id;
    const eb=(await client.query(employeeQuery,[b,"1019-B"])).rows[0].id;
    const documentQuery="INSERT INTO documents (organization_id,employee_id,kind,file_name,mime_type,byte_size,sha256,uploaded_by,content) " +
      "VALUES ($1,$2,'coe','fake.txt','text/plain',8,$3,'synthetic-fixture','fictional') RETURNING id";
    const docA=(await client.query(documentQuery,[a,ea,"a".repeat(64)])).rows[0].id;
    const docB=(await client.query(documentQuery,[b,eb,"b".repeat(64)])).rows[0].id;
    const caseQuery="INSERT INTO employee_hr_cases " +
      "(organization_id,employee_id,created_by_user_id,case_type,subject,description,assigned_role,sla_due_at,coe_document_id) " +
      "VALUES ($1,$2,$3,'coe','Fictional COE','CI-only rollback','hr',NOW() + INTERVAL '1 day',$4) RETURNING id";
    const id=(await client.query(caseQuery,[a,ea,user,docA])).rows[0].id;
    assert.ok(Number.isSafeInteger(id),"valid within-org COE must be accepted");
    await client.query("SAVEPOINT deny_document");
    await assert.rejects(() => client.query(caseQuery,[a,ea,user,docB]),e=>{
      assert.equal(e.code,"23503");
      assert.equal(e.constraint,"employee_hr_cases_coe_document_tenant_fk"); return true;
    });
    await client.query("ROLLBACK TO SAVEPOINT deny_document");
    await client.query("SAVEPOINT deny_message");
    await assert.rejects(() => client.query(
      "INSERT INTO employee_hr_case_messages(organization_id,case_id,actor_user_id,visibility,body) " +
      "VALUES($1,$2,$3,'internal','synthetic')",[b,id,user]
    ), e => { assert.equal(e.code,"23503");
      assert.equal(e.constraint,"employee_hr_case_messages_case_tenant_fk"); return true;
    });
    await client.query("ROLLBACK TO SAVEPOINT deny_message");
    process.stdout.write("ISSUE_1019_COMPOSITE_TENANT_NEGATIVE=PASS\n");
  } finally {
    await client.query("ROLLBACK").catch(() => {});
  }
}

async function main() {
  verifyEnvironment(process.env);
  const mode=process.argv[2];
  if(!["preflight","capture","negative","compare","negative-drift","diagnose"].includes(mode))
    fail("UNKNOWN_MODE");
  const client=new pg.Client({connectionString:TARGET,connectionTimeoutMillis:7000,query_timeout:30000});
  try {
    await client.connect();
    const i=(await client.query(
      "SELECT current_database() AS db,current_user AS role,current_setting('server_version_num')::integer AS ver"
    )).rows[0];
    if(i.db!=="app_db"||i.role!=="postgres"||
       i.ver < major * 10000 || i.ver >= (major+1)*10000) fail("SERVER_IDENTITY_MISMATCH");
    if(mode==="preflight") {
      // Exercise the actual PG16/PG18 SQL grammar and positional FK pairing
      // before allowing the real pinned binary to push any schema.
      const pairs=(await client.query(
        "SELECT fkcols.source_attnum,fkcols.target_attnum,fkcols.ord " +
        "FROM (SELECT ARRAY[1,2]::smallint[] AS conkey, ARRAY[3,4]::smallint[] AS confkey) con " +
        "JOIN LATERAL ROWS FROM (pg_catalog.unnest(con.conkey), pg_catalog.unnest(con.confkey)) " +
        "WITH ORDINALITY AS fkcols(source_attnum,target_attnum,ord) ON true ORDER BY fkcols.ord"
      )).rows;
      assert.deepEqual(pairs.map(x=>[x.source_attnum,x.target_attnum,Number(x.ord)]),
        [[1,3,1],[2,4,2]],"FK column ordinal pairing must be preserved");
      const c=await catalog(client);
      if(c.relations.length!==0) fail("NOT_EMPTY");
      process.stdout.write("ISSUE_1019_EMPTY_DISPOSABLE_PG"+major+"=PASS\n");
      return;
    }
    if(mode==="negative") {await negativeTenantProof(client);return;}
    const before=await catalog(client);
    const current=summarize(before);
    if(mode==="capture") {
      mkdirSync(resolve("qa-artifacts"),{recursive:true});
      writeFileSync(artifact,JSON.stringify({kind:"issue-1019-stable-push-v1",major, ...current,\n        objectDigests:objectDigests(before),
        productionApproved:false,db:"app_db",sourceOnly:true})+"\n",{flag:"wx",mode:0o600});
      process.stdout.write("ISSUE_1019_PINNED_STABLE_FIRST_PUSH_PG"+major+"="+current.tables+" tables\n");
      return;
    }
    const previous=JSON.parse(readFileSync(artifact,"utf8"));
    if(mode==="diagnose") {\n      if(previous.kind!=="issue-1019-stable-push-v1"||previous.major!==major || !previous.objectDigests)\n        fail("DIAGNOSIS_BASELINE_MISSING");\n      reportCatalogDelta(previous,before);\n      process.stdout.write("ISSUE_1019_SECOND_PUSH_CATALOG_EQUAL="+String(previous.sha256===current.sha256)+"\\n");\n      return;\n    }\n    if(previous.kind!=="issue-1019-stable-push-v1"||previous.major!==major||
       previous.sha256!==current.sha256||previous.tables!==current.tables||
       previous.columns!==current.columns||previous.constraints!==current.constraints||
       previous.indexes!==current.indexes||previous.productionApproved!==false) {
      fail("CATALOG_DRIFT");
    }
    if(mode==="negative-drift") {
      // Both probes run only against an empty disposable CI database and must
      // revert their entire DDL transaction. Check each drift independently.
      const probes=[
        {
          name:"index",
          ddl:"CREATE INDEX issue1019_negative_catalog_probe ON documents(organization_id)",
          expected:c=>c.indexes.some(x=>x.name==="issue1019_negative_catalog_probe"),
        },
        {
          name:"column-type",
          // The pinned source schema declares documents.file_name VARCHAR(200).
          ddl:"ALTER TABLE documents ALTER COLUMN file_name TYPE varchar(201)",
          expected:c=>c.columns.some(x=>x.relation==="documents" &&
            x.name==="file_name" && x.data_type==="character varying(201)"),
        },
      ];
      if(!before.columns.some(x=>x.relation==="documents" && x.name==="file_name" &&
        x.data_type==="character varying(200)"))fail("UNEXPECTED_DRIFT_BASELINE");
      for(const probe of probes) {
        await client.query("BEGIN");
        try {
          await client.query(probe.ddl);
          const mutated=await readCatalogObjects(client);
          if(!probe.expected(mutated) || summarize(mutated).sha256===current.sha256)
            fail("NEGATIVE_DRIFT_UNDETECTED");
        } finally {
          await client.query("ROLLBACK").catch(()=>{});
        }
        const restored=await catalog(client);
        if(summarize(restored).sha256!==current.sha256)fail("NEGATIVE_DRIFT_NOT_ROLLED_BACK");
      }
      process.stdout.write("ISSUE_1019_CATALOG_INDEX_AND_COLUMN_TYPE_DRIFT_NEGATIVE=PASS\n");
      return;
    }
    process.stdout.write("ISSUE_1019_PINNED_STABLE_TRUE_NO_OP_PG"+major+"=PASS; catalog unchanged\n");
  } finally {await client.end().catch(()=>{});}
}
main().catch(() => {process.stderr.write("ISSUE_1019_REHEARSAL_FAILED_CLOSED\n");process.exitCode=1;});
