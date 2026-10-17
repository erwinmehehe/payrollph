import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const sql=readFileSync(new URL("../drizzle/0129_non_recovery_fk_names_forward.sql",import.meta.url),"utf8");
const body=sql.replace(/--[^\r\n]*/g,"");
const values=[...body.matchAll(/\('([a-z_]+)', '([a-z_]+)', '([a-z_]+)', '([crn])'\)/g)]
  .map(([,table,col,parent,del])=>({table,col,parent,del}));
const renameRegex=/ALTER TABLE public\."([a-z_]+)" RENAME CONSTRAINT "([a-z0-9_]+)" TO "([a-z0-9_]+)";/g;
const renames=[...body.matchAll(renameRegex)].map(([,table,oldName,newName])=>({
  table,oldName,newName,
}));


test("preflight locks exactly the 15 reviewed FK child tables before catalog inspection", () => {
  const contractScan = body.indexOf("  FOR item IN\n    SELECT * FROM (VALUES");
  assert.ok(contractScan > 0, "catalog inspection anchor absent");
  const locks = body.slice(0, contractScan);
  const lockedTables = [...locks.matchAll(/\('([a-z_]+)'\)/g)].map(match => match[1]);
  const expected = [...new Set(values.map(item => item.table))].sort();
  assert.equal(expected.length, 15);
  assert.deepEqual(lockedTables, expected, "do not omit, duplicate or add locked tables");
  assert.match(locks, /ORDER BY child_table\s+LOOP/);
  assert.match(locks, /EXECUTE format\('LOCK TABLE public\.%I IN ACCESS EXCLUSIVE MODE', item\.child_table\);/);
  assert.equal(locks.split("EXECUTE format(").length, 2, "exactly one dynamic locking operation");
});

test("exactly 54 forward-only catalog renames without DML, destructive DDL or journal adoption",()=>{
  assert.equal(values.length,54);
  assert.equal(renames.length,54);
  assert.equal((body.match(/ALTER TABLE public\."/g)||[]).length,54);
  assert.doesNotMatch(body,/\b(?:UPDATE\s+\w+\s+SET|INSERT\s+INTO|DELETE\s+FROM|TRUNCATE|DROP\s+(?:TABLE|INDEX|COLUMN|CONSTRAINT)|VALIDATE\s+CONSTRAINT|GRANT|REVOKE)\b/i);
  // PL/pgSQL DO blocks legitimately contain an inner BEGIN/END.
  // Forbid only standalone transaction-control statements outside the
  // reviewed catalog preflight, rather than rejecting valid DO syntax.
  const outsideDo = body.replace(/DO \$issue_0129_preflight\$[\s\S]*?END \$issue_0129_preflight\$;/m,"");
  assert.notEqual(outsideDo,body,"Reviewed DO preflight must be present");
  assert.doesNotMatch(outsideDo,/^\s*(?:BEGIN|COMMIT|ROLLBACK|SAVEPOINT)\s*;/im);
  const statements = outsideDo.split(";").map(x=>x.trim()).filter(Boolean);
  assert.equal(statements.length,54,"No hidden DDL outside the catalog preflight and 54 renames");
  for(const statement of statements){
    assert.match(statement,
      /^ALTER TABLE public\."[a-z_]+"\s+RENAME CONSTRAINT "[a-z0-9_]+"\s+TO "[a-z0-9_]+"$/,
      "Only literal ALTER TABLE RENAME CONSTRAINT is allowed after the DO guard");
  }
  assert.ok(renames.every(r=>r.oldName!==r.newName));
});
test("all renamed names and PK/FK paths precisely match the pinned source contracts",()=>{
  const keyed=new Set();
  for(let i=0;i<values.length;i++){
    const row=values[i],rename=renames[i];
    const old=(row.table+"_"+row.col+"_fkey").slice(0,63);
    const next=(row.table+"_"+row.col+"_"+row.parent+"_id_fk").slice(0,63);
    assert.deepEqual(rename,{table:row.table,oldName:old,newName:next});
    assert.ok(next.length<=63);
    assert.ok(!keyed.has(row.table+"/"+next));
    keyed.add(row.table+"/"+next);
  }
  assert.equal(keyed.size,54);
  assert.equal(new Set(values.map(r=>r.table)).size,15);
});
test("fail-closed preflight checks validated, nondeferrable, exact key and action contracts",()=>{
  for(const piece of [
    "ISSUE0129_TARGET_CONSTRAINT_NAME_EXISTS",
    "ISSUE0129_FK_CATALOG_CONTRACT_MISMATCH",
    "ISSUE0129_INVALID_TARGET_NAME",
    "pg_catalog.format_type(src.atttypid, src.atttypmod) = 'integer'",
    "pg_catalog.format_type(dst.atttypid, dst.atttypmod) = 'integer'",
    "pk.conrelid = parent.oid AND pk.contype = 'p'",
    "pk.conkey[1] = dst.attnum AND pk.convalidated",
    "fk.conkey = ARRAY[src.attnum]::smallint[]",
    "fk.confkey = ARRAY[dst.attnum]::smallint[]",
    "fk.confdeltype = item.delete_code",
    "fk.confupdtype = 'a'",
    "fk.convalidated AND NOT fk.condeferrable AND NOT fk.condeferred",
  ]) assert.ok(body.includes(piece),"Guard absent: "+piece);
});
test("source documents human-only production cutover and forbids 0127/0128 receipt inference",()=>{
  assert.match(sql, /NOT an approval or receipt/);
  assert.match(sql, /approved 0127/);
  assert.match(sql, /reviewed 0128/);
  assert.match(sql, /atomic transaction/);
  assert.match(sql, /ZERO DML/);
});
