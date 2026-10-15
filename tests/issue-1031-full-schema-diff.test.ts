import { strict as assert } from "node:assert";
import { test } from "node:test";
import { diffSchema, EVIDENCE, type SchemaManifest, type CatalogRow } from "../src/lib/issue-1031-full-schema-diff";

const manifest: SchemaManifest = {
  formatVersion:1,evidenceScope:EVIDENCE,source:"synthetic pgTable fixture",
  tables:[{name:"synthetic_payroll",columns:[
    {name:"id",type:"serial",nullable:false,default:"__serial__",identity:null},
    {name:"amount",type:"numeric(14,2)",nullable:false,default:null,identity:null},
  ],foreignKeys:[],checks:[],primaryKeys:[{name:"synthetic_payroll_pkey",columns:["id"]}],
  uniqueConstraints:[],indexes:[{name:"synthetic_payroll_amount_idx",unique:false,method:"btree",keys:["amount"],predicate:null}]}],
};
const observed: CatalogRow[]=[
 {table_name:"synthetic_payroll",kind:"table",object_name:"synthetic_payroll"},
 {table_name:"synthetic_payroll",kind:"column",object_name:"id",type:"integer",nullable:false,default:"nextval('synthetic_payroll_id_seq'::regclass)",identity:null},
 {table_name:"synthetic_payroll",kind:"column",object_name:"amount",type:"numeric(14,2)",nullable:false,default:null,identity:null},
 {table_name:"synthetic_payroll",kind:"primary_key",object_name:"synthetic_payroll_pkey",columns:["id"],validated:true},
 {table_name:"synthetic_payroll",kind:"index",object_name:"synthetic_payroll_amount_idx",unique:false,method:"btree",keys:["amount"],predicate:null,valid:true,ready:true},
];
test("full schema comparator detects a mutated PostgreSQL column type, not a false PASS",()=>{
 const healthy=diffSchema(manifest,observed);
 assert.ok(healthy.every(x=>x.status==="PASS"),JSON.stringify(healthy));
 const changed=observed.map(x=>x.object_name==="amount"&&x.kind==="column"?{...x,type:"numeric(12,2)"}:x);
 const rows=diffSchema(manifest,changed);
 assert.equal(rows.find(x=>x.kind==="column"&&x.object==="amount")?.status,"DRIFT");
 assert.equal(rows.find(x=>x.kind==="column"&&x.object==="id")?.status,"PASS");
 assert.ok(rows.every(x=>x.evidenceScope===EVIDENCE));
});
test("missing constraint, extra column, and changed unique flag all fail",()=>{
 const rows=diffSchema(manifest,[
   ...observed.filter(x=>x.kind!=="primary_key"),
   {table_name:"synthetic_payroll",kind:"column",object_name:"unreviewed",type:"text",nullable:true,default:null,identity:null},
 ].map(x=>x.kind==="index"?{...x,unique:true}:x));
 assert.equal(rows.find(x=>x.kind==="primary_key")?.status,"MISSING");
 assert.equal(rows.find(x=>x.object==="unreviewed")?.status,"EXTRA");
 assert.equal(rows.find(x=>x.kind==="index")?.status,"DRIFT");
});
