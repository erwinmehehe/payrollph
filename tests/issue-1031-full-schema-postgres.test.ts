import { strict as assert } from "node:assert";
import { test } from "node:test";
import { Client } from "pg";
import { fullSchemaCatalogSql } from "../scripts/check-issue-1031-full-schema-diff";
import { diffSchema, EVIDENCE, type CatalogRow, type SchemaManifest } from "../src/lib/issue-1031-full-schema-diff";

/**
 * Disposable LOCALHOST PostgreSQL only; never use with a Neon connection.
 * Transaction is always rolled back and the test database is never retained.
 */
test("real pg_catalog detects an injected wrong column type", async(t)=>{
 const url=process.env.ISSUE1031_DISPOSABLE_PG_URL;
 if(!url){t.skip("no explicitly provisioned disposable localhost PostgreSQL service");return;}
 const parsed=new URL(url);
 if(!["localhost","127.0.0.1","::1"].includes(parsed.hostname)
   ||parsed.pathname!=="/issue1031_schema_fixture")throw new Error("REFUSING non-disposable DB");
 const db=new Client({connectionString:url,connectionTimeoutMillis:3000});
 await db.connect();
 let tx=false;
 try{
  await db.query("BEGIN");tx=true;
  const before=await db.query("SELECT count(*)::integer AS count FROM pg_catalog.pg_tables WHERE schemaname='public'");
  assert.equal(before.rows[0].count,0,"requires an empty CI-only database");
  await db.query("CREATE TABLE public.synthetic_payroll(id serial PRIMARY KEY, amount numeric(14,2) NOT NULL)");
  await db.query("CREATE INDEX synthetic_payroll_amount_idx ON public.synthetic_payroll(amount)");
  const manifest:SchemaManifest={formatVersion:1,evidenceScope:EVIDENCE,source:"synthetic fixture",tables:[
   {name:"synthetic_payroll",columns:[
    {name:"id",type:"serial",nullable:false,default:"__serial__",identity:null},
    {name:"amount",type:"numeric(14,2)",nullable:false,default:null,identity:null}],
   foreignKeys:[],checks:[],primaryKeys:[{name:"synthetic_payroll_pkey",columns:["id"]}],
   uniqueConstraints:[],indexes:[{name:"synthetic_payroll_amount_idx",unique:false,method:"btree",keys:["amount"],predicate:null}]}
  ]};
  async function snapshot():Promise<CatalogRow[]>{
   const result=await db.query<{table_name:string;kind:string;object_name:string;details:Record<string,unknown>}>(fullSchemaCatalogSql);
   return result.rows.map(x=>({table_name:x.table_name,kind:x.kind,object_name:x.object_name,...x.details}));
  }
  assert.ok(diffSchema(manifest,await snapshot()).every(r=>r.status==="PASS"));
  await db.query("ALTER TABLE public.synthetic_payroll ALTER COLUMN amount TYPE numeric(12,2)");
  const changed=diffSchema(manifest,await snapshot());
  assert.equal(changed.find(r=>r.table==="synthetic_payroll"&&r.kind==="column"&&r.object==="amount")?.status,"DRIFT");
 }finally{if(tx)await db.query("ROLLBACK");await db.end();}
});
