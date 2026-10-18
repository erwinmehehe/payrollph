#!/usr/bin/env node
/* Offline source-only shape comparator for #1031. NO database client and NO SQL execution.
 * This is an October 17 named subset, NOT proof of the missing October 15 113 names.
 */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { structuralStatements, sqlTokens, SOURCE_EVIDENCE_TAG } from "./lib/issue-1031-ddl-shape-parser.mjs";
import { generateSourceWorksheet, RECEIPT_FIELDS } from "./generate-issue-1031-source-worksheet.mjs";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const read = path => readFileSync(resolve(ROOT, path), "utf8");
const PINNED_MAIN = "0921b02ad73475e4eaf76ea6b45f65efc046ce5d";
// Actual SHA-256 of src/db/schema.ts at the pinned 0921b02a commit.
export const HISTORICAL_SCHEMA_SHA256 = "72c465c62e99aa9ce0271d700cc526f408216b068c6d8b0fd1864c84201bd3cf";

/**
 * Keep the historical 0132-era SQL shape analysis immutable across #1210.
 * The only reviewed schema changes since the pinned commit are explicit
 * NULLS FIRST on two marketing_leads indexes. Reconstruct the EXACT
 * historical source bytes, or stop instead of falsely updating evidence.
 */
export function reconstructPinnedSchemaText(currentSource) {
  const hash = text => createHash("sha256").update(text).digest("hex");
  if (hash(currentSource) === HISTORICAL_SCHEMA_SHA256)
    return { text: currentSource, projected: false };
  const reviewed = [
    ['index("marketing_leads_status_created_idx").on(table.status, table.createdAt.desc().nullsFirst())',
     'index("marketing_leads_status_created_idx").on(table.status, table.createdAt.desc())'],
    ['index("marketing_leads_kind_created_idx").on(table.kind, table.createdAt.desc().nullsFirst())',
     'index("marketing_leads_kind_created_idx").on(table.kind, table.createdAt.desc())'],
  ];
  let historical = currentSource;
  for (const [newer, historicalText] of reviewed) {
    if (historical.split(newer).length !== 2)
      throw Error("HISTORICAL_1031_UNREVIEWED_SCHEMA_DIFFERENCE");
    historical = historical.replace(newer, historicalText);
  }
  if (hash(historical) !== HISTORICAL_SCHEMA_SHA256)
    throw Error("HISTORICAL_1031_UNREVIEWED_SCHEMA_DIFFERENCE");
  return { text: historical, projected: true };
}
const OUTPUT = "docs/engineering/issue-1031-20261017-named-shape-analysis-partial.csv";
const ALL_OUTPUT = "docs/engineering/issue-1031-all-numbered-creator-shape-analysis.csv";
const sort = array => [...array].sort((a,b) => a.localeCompare(b,"en"));
const typeNorm = s => String(s ?? "").toLowerCase().trim()
  .replace(/\bvarchar\b/g,"character varying").replace(/\btimestamptz\b/g,"timestamp with time zone")
  .replace(/\bint4\b/g,"integer").replace(/\bint8\b/g,"bigint").replace(/\bbool\b/g,"boolean")
  .replace(/\bnumeric\((\d+),\s*(\d+)\)/g,"numeric($1,$2)");
function canonical(x, table = "") {
  if (x === null || x === undefined) return null;
  if (x === "__serial__") return x;
  const src = sqlTokens(String(x));
  const id = tok => tok?.kind === "ident" ? tok.raw.slice(1,-1).replaceAll('""','"') :
    tok?.kind === "word" ? tok.raw.toLowerCase() : null;
  const a = [];
  for(let i=0;i<src.length;i++) {
    if (table && id(src[i]) === table && src[i+1]?.raw === "." && id(src[i+2])) { i++; continue; }
    a.push(src[i].kind === "ident" ? id(src[i]) : src[i].kind === "word" ? src[i].raw.toLowerCase() : src[i].raw);
  }
  while(a[0] === "(" && a[a.length-1] === ")") {
    let depth=0, early=false;
    for(let i=0;i<a.length-1;i++) {
      if(a[i] === "(") depth++;
      if(a[i] === ")" && --depth === 0) { early=true; break; }
    }
    if(early) break;
    a.shift();a.pop();
  }
  return a.join(" ").replace(/\s+([(),.;])/g,"$1").replace(/([(.])\s+/g,"$1")
    .replace(/\s*:\s*:\s*/g,"::").replace(/\s+/g," ").trim();
}
export function normalizeDefault(defaultValue, sqlType, table) {
  let v = canonical(defaultValue,table);
  if(v === null || v === "__serial__") return v;
  if(/^character varying(?:\(\d+\))?$/.test(typeNorm(sqlType)) && v.endsWith("::character varying"))
    v = v.slice(0,-"::character varying".length);
  if(/^numeric(?:\(\d+,\d+\))?$/.test(typeNorm(sqlType))) {
    if(v.endsWith("::numeric")) v = v.slice(0,-"::numeric".length);
    // SQL 0.75 and a typed Drizzle string default '0.75' both compile
    // to the exact same numeric value under the declared NUMERIC column.
    if(/^'[-+]?(?:\d+(?:\.\d*)?|\.\d+)'$/.test(v)) v = v.slice(1,-1);
  }
  // PostgreSQL implicitly coerces bare JSON string constants to the column's
  // declared jsonb type. Drizzle renders equivalent empty-object/array values
  // with an explicit ::jsonb cast. Only fold these two exact, well-known JSON
  // constants on jsonb columns; never discard casts for TEXT, JSON or unknown
  // expressions, and never erase a genuinely different JSON value.
  if(typeNorm(sqlType)==="jsonb" && (v==="'{}'::jsonb" || v=="'[]'::jsonb"))
    v = v.slice(0,-"::jsonb".length);
  return v;
}
const normAction = s => String(s||"no action").toLowerCase().trim().replaceAll("_"," ");
const signature = x => [x.columns.join(","),x.refTable,x.refColumns.join(","),
  normAction(x.onDelete),normAction(x.onUpdate)].join("->");
const sortedKeys = x => sort(x.map(y => y.columns.join(",")));
function compare(schema, sql) {
  const drift=[], unknown=[], t=schema.name;
  const expected = new Map(schema.columns.map(c => [c.name,c]));
  const actual = new Map(sql.columns.map(c => [c.name,c]));
  for(const name of sort(new Set([...expected.keys(),...actual.keys()]))) {
    const e=expected.get(name),a=actual.get(name);
    if(!e) { drift.push("column SQL-only: "+name); continue; }
    if(!a) { drift.push("column missing SQL: "+name); continue; }
    if(typeNorm(e.type)!==typeNorm(a.type)) drift.push("column "+name+" type SQL="+a.type+" schema="+e.type);
    if(e.nullable!==a.nullable) drift.push("column "+name+" nullable SQL="+a.nullable+" schema="+e.nullable);
    const ed=normalizeDefault(e.default,e.type,t),ad=normalizeDefault(a.default,a.type,t);
    if(ed!==ad) drift.push("column "+name+" default SQL="+ad+" schema="+ed);
    if(e.identity || a.identity) unknown.push("identity column "+name+" unsupported");
  }
  if(JSON.stringify(sortedKeys(schema.primaryKeys))!==JSON.stringify(sortedKeys(sql.primary.map(columns=>({columns})))))
    drift.push("primary key columns differ");
  if(JSON.stringify(sortedKeys(schema.uniqueConstraints))!==JSON.stringify(sortedKeys(sql.unique.map(columns=>({columns})))))
    drift.push("unique constraint columns differ");
  if(schema.uniqueConstraints.some(key=>key.nullsNotDistinct))
    drift.push("unique constraint NULLS NOT DISTINCT required by schema but not modeled in SQL source");
  if(JSON.stringify(sort(schema.foreignKeys.map(signature)))!==JSON.stringify(sort(sql.foreignKeys.map(signature))))
    drift.push("FK ref table/columns/update/delete actions differ");
  const indexes = new Map(sql.indexes.map(i=>[i.name,i]));
  for(const e of schema.indexes) {
    const a=indexes.get(e.name);
    if(!a) {drift.push("index missing SQL: "+e.name);continue;}
    indexes.delete(e.name);
    if(e.unique!==a.unique || (e.method||"btree")!==(a.method||"btree"))
      drift.push("index unique/method: "+e.name);
    const normKeys = arr => arr.map(k=>canonical(k,t).replace(/\s+asc$/,""));
    if(JSON.stringify(normKeys(e.keys))!==JSON.stringify(normKeys(a.keys)))
      drift.push("index keys or sort order: "+e.name+" SQL="+JSON.stringify(normKeys(a.keys))+
        " schema="+JSON.stringify(normKeys(e.keys)));
    if(canonical(e.predicate,t)!==canonical(a.predicate,t))
      unknown.push("partial index predicate equivalence unproven: "+e.name);
  }
  for(const k of indexes.keys())drift.push("index SQL-only: "+k);
  if(JSON.stringify(sort(schema.checks.map(x=>canonical(x.expression,t))))!==
     JSON.stringify(sort(sql.checks.map(x=>canonical(x,t)))))
    unknown.push("CHECK expression equivalence unproven");
  // Names on explicit CHECK constraints are part of schema structure.
  // PostgreSQL may synthesize names for inline CHECKs; do not invent them.
  const checksByExpr = sql.checks.map((expression,i)=>({
    expression:canonical(expression,t),
    name:sql.checkNames?.[i]??null,
  }));
  for(const ck of schema.checks){
    const found = checksByExpr.filter(item=>item.expression===canonical(ck.expression,t));
    if(found.length!==1)continue; // An expression mismatch was handled above.
    if(found[0].name===null)
      unknown.push("CHECK "+ck.name+" has no explicit SQL name; synthesized PG name unverified");
    else if(found[0].name!==ck.name)
      drift.push("CHECK name mismatch: SQL "+found[0].name+" vs schema "+ck.name);
  }
  return {drift,unknown};
}
function getManifest(projectHistoricalMarketingIndexes = false) {
  const runner=resolve(ROOT,"node_modules/.bin/tsx");
  const stdout=execFileSync(runner,["scripts/issue-1031-print-schema-manifest.ts"],{
    cwd:ROOT,encoding:"utf8",timeout:60000,maxBuffer:16*1024*1024,
    env:{...process.env,DATABASE_URL:"",PRODUCTION_DATABASE_URL:"",
      PRODUCTION_MIGRATION_AUDIT_DATABASE_URL:""},
  });
  const value=JSON.parse(stdout);
  if(value.evidenceScope!==SOURCE_EVIDENCE_TAG||value.tables.length<271)
    throw Error("SCHEMA_AST_MANIFEST_UNTRUSTED");
  // Drizzle's runtime manifest is still on current main. Project ONLY the
  // two proven #1210 differences back to their 0921b02a index semantics,
  // after exact source-byte verification by reconstructPinnedSchemaText().
  if (projectHistoricalMarketingIndexes) {
    const marketing = value.tables.find(x => x.name === "marketing_leads");
    if (!marketing) throw Error("HISTORICAL_1031_MARKETING_MODEL_MISSING");
    for (const [name, firstKey] of [
      ["marketing_leads_status_created_idx", "status"],
      ["marketing_leads_kind_created_idx", "kind"],
    ]) {
      const matches = marketing.indexes.filter(x => x.name === name);
      const index = matches[0];
      if (matches.length !== 1 || !index || index.keys.length !== 2 ||
          index.keys[0] !== firstKey || index.keys[1] !== "created_at DESC NULLS FIRST")
        throw Error("HISTORICAL_1031_MARKETING_INDEX_MODEL_DRIFT_" + name);
      index.keys[1] = "created_at DESC";
    }
  }
  return new Map(value.tables.map(x=>[x.name,x]));
}
function namedCatalog() {
  const doc=read("docs/engineering/issue-1198-live-table-catalog-20261017.md");
  const section=doc.split("## Declared application tables missing from observed Neon "+String.fromCharCode(96)+
    "public"+String.fromCharCode(96)+" (124)")[1]?.split("## Observed Neon")[0];
  if(!section)throw Error("MISSING_NAMED_CATALOG_SECTION");
  const names=section.split("\n").map(s=>/^- .([a-z0-9_]+).$/.exec(s)?.[1]).filter(Boolean);
  if(names.length!==124||new Set(names).size!==124)throw Error("NAMED_CATALOG_NOT_124");
  return names;
}
function sourceLine(s,name) {
  const ix=s.search(new RegExp('pgTable\\(\\s*["\\x27]'+name+'["\\x27]'));
  if(ix<0)throw Error("MISSING_SCHEMA_DECL_"+name);
  return s.slice(0,ix).split("\n").length;
}
function namedIn(s,n) {
  return new RegExp("(^|[^a-zA-Z0-9_])"+n+"([^a-zA-Z0-9_]|$)","i").test(s);
}
// Immutable October 18 analysis of exact pinned commit 0921b02a. That
// snapshot ended at numbered migration 0132. Later forward migrations
// (0133+) are excluded, never silently mixed into historical results.
// In-scope prefix additions still fail the exact 146-source count check.
export const HISTORICAL_SOURCE_MAX_PREFIX = 132;
function parseFiles() {
  const files=readdirSync(resolve(ROOT,"drizzle"))
    .filter(x=>/^[0-9]{4}_.+\.sql$/.test(x))
    .filter(x=>Number(x.slice(0,4))<=HISTORICAL_SOURCE_MAX_PREFIX)
    .sort();
  if(files.length!==146)throw Error("NUMBERED_SOURCE_FILE_COUNT_CHANGED_"+files.length);
    return files.map(filename=>{
    const file="drizzle/"+filename,content=read(file);
    try {return{file,prefix:Number(filename.slice(0,4)),content,statements:structuralStatements(content),fatal:""};}
    catch(e){return{file,prefix:Number(filename.slice(0,4)),content,statements:[],fatal:String(e.message)};}
  });
}
const csvQuote=v=>'"'+String(v??"").replaceAll('"','""')+'"';
export const HEADERS=[
  "evidence_scope","comparison_source_sha","source_schema_sha256","catalog_observation_date",
  "table_name","classification","column_name_type_null_default","primary_unique",
  "foreign_keys_and_actions","indexes_including_partial_unique","check_constraints",
  "later_alter_rename_drop","tenant_scope_rls","differences","migration_file_paths",
  "schema_ts_line_references","unparseable_or_incomplete_reason",
  "receipt_found","receipt_source","applied_at","applied_by","checksum_matches_receipt","disposition"
];
export function generateShapeAudit(cohort = "dated_named") {
  if(!["dated_named","all_numbered"].includes(cohort))throw Error("UNKNOWN_SOURCE_COHORT");
  const pinnedSchema = reconstructPinnedSchemaText(read("src/db/schema.ts"));
  const schemaText = pinnedSchema.text;
  const model = getManifest(pinnedSchema.projected), worksheet = generateSourceWorksheet();
  // The active worksheet tracks new forward candidates (0133, 0134, ...),
  // but this historical shape report is locked to the <=0132 source cohort.
  // Never compare later repair creators against a truncated parseFiles()
  // inventory: doing so produces false partial-state/creator mismatches.
  const pinnedCreators = value => String(value ?? "").split(" | ")
    .filter(path => /^drizzle\/[0-9]{4}_[a-z0-9_-]+\.sql$/.test(path))
    .filter(path => Number(path.slice(8, 12)) <= HISTORICAL_SOURCE_MAX_PREFIX);
  const cross=new Map(worksheet.tableRows.map(row => [row.schema_table, {
    ...row, numbered_files_creating_table:pinnedCreators(row.numbered_files_creating_table).join(" | "),
  }]));
  const files=parseFiles();
  const scope=cohort==="dated_named"
    ? namedCatalog().filter(n=>cross.get(n)?.numbered_files_creating_table)
    : [...cross.values()].filter(r=>r.numbered_files_creating_table).map(r=>r.schema_table);
  if(cohort==="dated_named" && scope.length!==100)
    throw Error("EXPECTED_DATED_100_TABLE_SCOPE_"+scope.length);
  if(cohort==="all_numbered" && (scope.length<187||scope.length>271))
    throw Error("UNEXPECTED_ALL_NUMBERED_TABLE_COUNT_"+scope.length);
  const allCreators=new Map(), indexOwners=new Map();
  for(const f of files) for(const q of f.statements){
    if(q.kind==="table")
      allCreators.set(q.value.table,[...(allCreators.get(q.value.table)||[]),
        {file:f.file,prefix:f.prefix,statement:q.statement}]);
    if(q.kind==="index"){
      const owners=indexOwners.get(q.value.index.name)||new Set();
      owners.add(q.value.table);
      indexOwners.set(q.value.index.name,owners);
    }
  }
  const rows=scope.map(name=>{
    const ast=model.get(name);if(!ast)throw Error("AST_TABLE_MISSING_"+name);
    const crossRow=cross.get(name),expectedFiles=crossRow.numbered_files_creating_table.split(" | ");
    const creators=[],indexes=[],indexLocations=[],mutations=[],rls=[],unsupported=[],paths=new Set(expectedFiles);
    for(const file of files){
      if(file.fatal && namedIn(file.content,name)){
        unsupported.push(file.file+" tokenization: "+file.fatal);paths.add(file.file);continue;
      }
      for(const stmt of file.statements){
        if(stmt.kind==="table"&&stmt.value.table===name){
          creators.push({...stmt.value,file:file.file,prefix:file.prefix,statement:stmt.statement});paths.add(file.file);
        }else if(stmt.kind==="index"&&stmt.value.table===name){
          indexes.push(stmt.value.index);
          indexLocations.push({file:file.file,prefix:file.prefix,statement:stmt.statement,name:stmt.value.index.name});
          paths.add(file.file);
        }else if((stmt.kind==="alter"||stmt.kind==="drop")&&stmt.table===name){
          mutations.push(file.file+" "+stmt.kind);paths.add(file.file);
        }else if(["drop_index","alter_index"].includes(stmt.kind)&&
                 indexOwners.get(stmt.index)?.has(name)){
          mutations.push(file.file+" "+stmt.kind+" "+stmt.index);paths.add(file.file);
        }else if(stmt.kind==="policy"&&namedIn(stmt.raw,name)){
          rls.push(file.file+" "+stmt.kind);paths.add(file.file);
        }else if(["procedural","unparseable","unknown"].includes(stmt.kind)&&
                 namedIn(stmt.raw||"",name)){
          unsupported.push(file.file+" "+(stmt.reason||stmt.kind));paths.add(file.file);
        }
      }
    }
    const unknown=[],differences=[],risk=[];
    if(creators.length!==expectedFiles.length)
      unknown.push("CREATE TABLE parser/crosswalk count differs: "+creators.length+"/"+expectedFiles.length);
    if(creators.length>1)unknown.push("Multiple conditional CREATE definitions; cannot choose final state");
    if(new Set(indexes.map(x=>x.name)).size!==indexes.length)
      unknown.push("Duplicate named CREATE INDEX definitions need conditional-order reconciliation");
    if(mutations.length)unknown.push("ALTER/DROP not safely resolved: "+mutations.join(" | "));
    if(rls.length)unknown.push("RLS/policy requires independent review: "+rls.join(" | "));
    if(unsupported.length)unknown.push("Unsupported procedural or malformed SQL: "+unsupported.join(" | "));
    const created=creators.length===1?creators[0]:null;
    if(created){
      for(const fk of created.foreignKeys){
        const all=allCreators.get(fk.refTable)||[];
        const baseline=cross.get(fk.refTable)?.unnumbered_baseline_creates_table?.startsWith("yes");
        if(fk.refTable!==name && all.length &&
           all.every(x => x.prefix > created.prefix ||
             x.prefix === created.prefix &&
             (x.file !== created.file || x.statement >= created.statement)))
          risk.push("FK "+fk.refTable+" has no proven earlier numbered CREATE (later or same-prefix ambiguous): "+
            all.map(x=>x.file+"#"+x.statement).join(" | "));
        if(fk.refTable!==name&&!all.length&&!baseline)
          risk.push("FK referenced "+fk.refTable+
            " has no numbered creator or unnumbered baseline definition; prerequisite unproven");
      }
      for(const idx of indexLocations){
        const sameCreate=idx.file===created.file;
        const isEarlier=idx.prefix<created.prefix ||
          idx.prefix===created.prefix && (!sameCreate||idx.statement<=created.statement);
        if(isEarlier)
          risk.push("Index "+idx.name+" may run before table creator: "+
            idx.file+"#"+idx.statement+" vs "+created.file+"#"+created.statement);
      }
      const detail=compare(ast,{...created,indexes});
      differences.push(...detail.drift);unknown.push(...detail.unknown);
    }
    const tenant=ast.columns.find(x=>x.name==="organization_id");
    if(!tenant)unknown.push("Equivalent tenant-scoping column requires manual review");
    // A proven difference wins over an unrelated uncertain CHECK grammar,
    // but NEVER over DDL whose unresolved effects could change final state.
    const uncertainFinalState=!created||mutations.length||unsupported.length||
      creators.length>1||rls.length||new Set(indexes.map(x=>x.name)).size!==indexes.length||
      unknown.some(x=>/CREATE TABLE parser\/crosswalk/.test(x));
    const classification=risk.length?"MIGRATION_ORDER_RISK":
      uncertainFinalState?"UNPARSEABLE":
      differences.length?"DRIFT":
      unknown.length?"UNPARSEABLE":"MATCH";
    const sourceLineRef="src/db/schema.ts:"+sourceLine(schemaText,name);
    const records={evidence_scope:SOURCE_EVIDENCE_TAG,comparison_source_sha:PINNED_MAIN,
      source_schema_sha256:createHash("sha256").update(schemaText).digest("hex"),
      catalog_observation_date:cohort==="dated_named"
        ? "2026-10-17 #1198 named 124/100, NOT historic 137/113"
        : "SOURCE-ONLY all numbered creator tables; no claim any were absent in production",
      table_name:name,classification,
      column_name_type_null_default:created?"compared "+created.columns.length+" SQL vs "+ast.columns.length+" AST columns":"UNVERIFIED",
      primary_unique:created?"compared PK and unique signatures":"UNVERIFIED",
      foreign_keys_and_actions:created?"compared "+created.foreignKeys.length+" SQL FK signatures":"UNVERIFIED",
      indexes_including_partial_unique:created?"compared "+indexes.length+" named SQL indexes":"UNVERIFIED",
      check_constraints:created?"compared "+created.checks.length+" SQL CHECK clauses":"UNVERIFIED",
      later_alter_rename_drop:mutations.length?mutations.join(" | "):"No explicit ALTER/DROP found by parser; dynamic SQL not certified",
      tenant_scope_rls:(tenant?"organization_id "+typeNorm(tenant.type)+(tenant.nullable?" nullable":" NOT NULL"):
        "tenant equivalent not established")+"; "+(rls.length?rls.join(" | "):"no directly named RLS statement parsed"),
      differences:[...risk,...differences].join(" | "),migration_file_paths:sort(paths).join(" | "),
      schema_ts_line_references:sourceLineRef,unparseable_or_incomplete_reason:unknown.join(" | "),
      ...Object.fromEntries(RECEIPT_FIELDS.map(x=>[x,""]))};
    return records;
  });
  const counts=Object.fromEntries(["MATCH","DRIFT","UNPARSEABLE","MIGRATION_ORDER_RISK"]
    .map(x=>[x,rows.filter(y=>y.classification===x).length]));
  const csv=[HEADERS.map(csvQuote).join(","),...rows.map(row=>HEADERS.map(x=>csvQuote(row[x])).join(","))].join("\n")+"\n";
  if(rows.length!==scope.length||new Set(rows.map(r=>r.table_name)).size!==rows.length||
     rows.some(row=>RECEIPT_FIELDS.some(f=>row[f]!=="")))
    throw Error("SOURCE_ONLY_ROW_OR_RECEIPT_GUARD_FAILED");
  return{counts,rows,csv,tag:SOURCE_EVIDENCE_TAG,sourceOnly:true,cohort,
    historical113Attested:false,productionQueried:false,releaseApproved:false};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const command=process.argv[2];
  if(!["--summary","--write","--check","--base64",
        "--summary-all","--write-all","--check-all","--base64-all"].includes(command)||
     process.argv.length!==3)
    throw Error("USAGE_SUMMARY_WRITE_CHECK_BASE64_OPTIONAL_ALL");
  const all=command.endsWith("-all"),verb=all?command.slice(0,-4):command;
  const output=all?ALL_OUTPUT:OUTPUT;
  const result=generateShapeAudit(all?"all_numbered":"dated_named");
  if(verb==="--write")writeFileSync(resolve(ROOT,output),result.csv);
  if(verb==="--check"&&read(output)!==result.csv)throw Error("STALE_SOURCE_SHAPE_CSV_REGENERATE");
  if(verb==="--base64")console.log(Buffer.from(result.csv).toString("base64"));
  else console.log(JSON.stringify({counts:result.counts,rows:result.rows.length,
    cohort:result.cohort,tag:result.tag,historical113Attested:false,
    productionQueried:false,releaseApproved:false},null,2));
}
