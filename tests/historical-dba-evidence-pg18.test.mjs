import assert from "node:assert/strict";
import test from "node:test";
import pg from "pg";
import { HISTORICAL_ITEMS,HISTORICAL_CATALOG_QUERY } from
  "../scripts/lib/historical-dba-evidence.mjs";

const isolated=process.env.GITHUB_ACTIONS==="true" &&
  process.env.CI==="true" &&
  process.env.P0_4_HISTORICAL_EVIDENCE_MODE==="isolated-pg18-only" &&
  process.env.DATABASE_URL==="postgresql://postgres:postgres@127.0.0.1:5432/app_db";

test("exact catalog SQL executes on disposable PostgreSQL 18 and returns every key",{
  skip:!isolated,timeout:30000,
},async()=>{
 const client=new pg.Client({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:3000});
 await client.connect();
 try{
   const {rows}=await client.query(HISTORICAL_CATALOG_QUERY);
   assert.equal(rows.length,HISTORICAL_ITEMS.length);
   const keys=new Set(rows.map(x=>x.key));
   assert.deepEqual(keys,new Set(HISTORICAL_ITEMS.map(x=>x.key)));
   assert.ok(rows.every(x=>typeof x.present==="boolean"));
   // db:push can provide all objects already. The second test removes one
   // inside a rollback-only transaction and proves missing-table detection.
 }finally{await client.end();}
});

test("disposable catalog control: a vanished table is detected and rollback restores original schema",{
  skip:!isolated,timeout:30000,
},async()=>{
 const client=new pg.Client({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:3000});
 await client.connect();
 let inTx=false;
 try{
   const source=await client.query(HISTORICAL_CATALOG_QUERY);
   await client.query("BEGIN");inTx=true;
   await client.query("DROP TABLE IF EXISTS public.job_profiles CASCADE");
   const altered=await client.query(HISTORICAL_CATALOG_QUERY);
   const key="drizzle/0022_job_architecture_positions.sql|table|job_profiles|";
   const missing=altered.rows.find(x=>x.key===key);
   assert.equal(missing?.present,false);
   await client.query("ROLLBACK");inTx=false;
   const after=await client.query(HISTORICAL_CATALOG_QUERY);
   assert.deepEqual(after.rows,source.rows);
 }finally{
   if(inTx)try{await client.query("ROLLBACK");}catch{}
   await client.end();
 }
});
