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

test("case-sensitive literal content and internal spaces must not normalize away", () => {
 const withLabel: SchemaManifest={
   ...manifest,
   tables:[{...manifest.tables[0]!,
     columns:[...manifest.tables[0]!.columns,
       {name:"label",type:"text",nullable:false,default:"'Approved  By HR'",identity:null}]
   }]
 };
 const catalog: CatalogRow[]=[
   ...observed,{table_name:"synthetic_payroll",kind:"column",object_name:"label",
     type:"text",nullable:false,default:"'approved by HR'",identity:null}
 ];
 const result=diffSchema(withLabel,catalog);
 assert.equal(result.find(x=>x.kind==="column"&&x.object==="label")?.status,"DRIFT");
});

test("serial primary key cannot accept an arbitrary nextval sequence", () => {
 const wrong=observed.map(x=>x.kind==="column"&&x.object_name==="id"
   ? {...x,default:"nextval('unrelated_payroll_sequence'::regclass)"} : x);
 const result=diffSchema(manifest,wrong);
 assert.equal(result.find(x=>x.kind==="column"&&x.object==="id")?.status,"DRIFT");
});

test("PostgreSQL proven varchar/numeric default deparser casts compare only when types and literals match",()=>{
 const meta: SchemaManifest = {...manifest,tables:[{...manifest.tables[0]!,
   columns:[...manifest.tables[0]!.columns,
     {name:"status",type:"varchar(16)",nullable:false,default:"'Open'",identity:null},
     {name:"budget",type:"numeric(14,2)",nullable:false,default:"'0'",identity:null}]}]};
 const actual: CatalogRow[]=[...observed,
   {table_name:"synthetic_payroll",kind:"column",object_name:"status",type:"character varying(16)",
     nullable:false,default:"'Open'::character varying",identity:null},
   {table_name:"synthetic_payroll",kind:"column",object_name:"budget",type:"numeric(14,2)",
     nullable:false,default:"'0'::numeric",identity:null}];
 assert.ok(diffSchema(meta,actual).every(x=>x.status==="PASS"));
 for(const [object,alteration] of [
   ["status","'open'::character varying"],["status","'Open'::text"],
   ["budget","'1'::numeric"],["budget","'0'::text"]
 ]) {
   const mutated=actual.map(x=>x.object_name===object?{...x,default:alteration}:x);
   assert.equal(diffSchema(meta,mutated).find(x=>x.kind==="column"&&x.object===object)?.status,"DRIFT");
 }
});

test("PostgreSQL deparsed varchar IN list compares only identical columns and case-sensitive literals",()=>{
 const model: SchemaManifest={...manifest,tables:[{...manifest.tables[0]!,
   checks:[{name:"synthetic_payroll_status_check",
     expression:"synthetic_payroll.status in ('info','warning','blocker')"}]}]};
 const expr="((status)::text = ANY ((ARRAY['info'::character varying, 'warning'::character varying, 'blocker'::character varying])::text[]))";
 const row: CatalogRow={table_name:"synthetic_payroll",kind:"check",
   object_name:"synthetic_payroll_status_check",expression:expr,validated:true};
 assert.ok(diffSchema(model,[...observed,row]).every(x=>x.status==="PASS"));
 const changed=[
   expr.replace("'blocker'","'critical'"),
   expr.replace("(status)","(other)"),
   expr.replace("'warning'::character varying","'warning'::text"),
   "((status)::text = ANY ((ARRAY['info'::character varying, 'warning'::character varying])::text[]))",
 ];
 for(const expression of changed) {
   assert.equal(diffSchema(model,[...observed,{...row,expression}])
     .find(x=>x.kind==="check"&&x.object===row.object_name)?.status,"DRIFT");
 }
 assert.equal(diffSchema(model,[...observed,{...row,validated:false}])
   .find(x=>x.kind==="check"&&x.object===row.object_name)?.status,"DRIFT");
});
