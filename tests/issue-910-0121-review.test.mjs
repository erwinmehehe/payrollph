import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const original = readFileSync(new URL("../drizzle/0121_multi_entity_v2_scope_transfer.sql", import.meta.url), "utf8");
const names = ["bootstrap","schema","linked-payroll-attribution","initial-entity-grants","employment-interval-attribution"];
const stage = name => readFileSync(new URL("../docs/sql/issue-910-review-only-0121-"+name+".sql", import.meta.url), "utf8");
const body = name => stage(name).split("-- BEGIN_SOURCE_0121_STAGE --\n")[1]?.split("-- END_SOURCE_0121_STAGE --")[0]?.trim() ?? "";
const normalized = text => text.replace(/--[^\n]*/g,"").replace(/\s+/g," ").trim();
const ddl = text => text.replace(/--[^\n]*/g,"").split(";").map(s=>s.trim()).filter(Boolean);
const originalAnchors = [
  "INSERT INTO legal_entities (",
  "ALTER TABLE legal_entities ADD COLUMN IF NOT EXISTS registered_address text;",
  "UPDATE payroll_entries e SET legal_entity_id = r.legal_entity_id",
  "CREATE TABLE IF NOT EXISTS user_legal_entity_grants (",
  "INSERT INTO user_legal_entity_grants(organization_id,user_id,legal_entity_id)",
  "INSERT INTO employee_entity_assignments(organization_id,employee_id,legal_entity_id,effective_from)",
];
test("#910 original 0121 remains unchanged and review extracts preserve every statement",()=>{
  const pos=originalAnchors.map(a=>original.indexOf(a));
  assert.ok(pos.every((p,i)=>p>=0&&(i===0||p>pos[i-1])));
  assert.match(original,/worker_employment_events/);
  assert.doesNotMatch(original,/^\s*(?:BEGIN|COMMIT|ROLLBACK)\s*;/mi);
  const reconstructed = [
    body("bootstrap"),body("schema").split("CREATE TABLE IF NOT EXISTS user_legal_entity_grants (")[0],
    body("linked-payroll-attribution"),
    body("schema").slice(body("schema").indexOf("CREATE TABLE IF NOT EXISTS user_legal_entity_grants (")),
    body("initial-entity-grants"),body("employment-interval-attribution"),
  ].join("\n");
  assert.equal(normalized(reconstructed),normalized(original.slice(pos[0])));
});
test("#910 extracts are docs-only and do not grant execution approval",()=>{
  for(const name of names){
    const content=stage(name);
    assert.match(content,/REVIEW-ONLY SQL SOURCE EXTRACT/);
    assert.match(content,/NO PRODUCTION, NEON OR STAGING EXECUTION/);
    assert.match(content,/BEGIN_SOURCE_0121_STAGE/);
    assert.match(content,/END_SOURCE_0121_STAGE/);
    assert.ok(body(name).length>80);
  }
});
test("#910 schema is additive-only with zero row mutations and no historical event fabrication",()=>{
  // The PostgreSQL dollar-quoted control block contains nested semicolons.
  // Extract it before tokenizing top-level DDL statements.
  const sql=body("schema");
  const control=sql.match(/DO\s+\$checks\$[\s\S]*?END \$checks\$;/i);
  assert.ok(control,"composite FK review block must be present");
  assert.doesNotMatch(control[0],/\b(?:INSERT INTO|UPDATE\s+\w+\s+SET|DELETE FROM|TRUNCATE)\b/i);
  const statements=ddl(sql.replace(control[0],""));
  assert.ok(statements.length>10);
  for(const statement of statements){
    assert.match(statement,/^(?:ALTER TABLE|CREATE (?:UNIQUE )?INDEX|CREATE TABLE)/i);
    assert.doesNotMatch(statement,/^(?:INSERT|UPDATE|DELETE|TRUNCATE|DROP|BEGIN|COMMIT)/i);
  }
  assert.doesNotMatch(body("schema"),/CREATE TABLE IF NOT EXISTS worker_employment_events/i);
  assert.doesNotMatch(body("schema"),/\bINSERT\s+INTO\s+worker_employment_events\b/i);
});
test("#910 money and employment backfill may not default to current employee employer",()=>{
  const linked=body("linked-payroll-attribution");
  const history=body("employment-interval-attribution");
  assert.match(linked,/FROM payroll_runs r/);
  assert.match(history,/FROM worker_employment_events h/);
  assert.match(history,/pr\.legal_entity_id IS DISTINCT FROM e\.legal_entity_id/);
  assert.doesNotMatch(linked,/SET legal_entity_id = e\.legal_entity_id/i);
});

test("#910 post-0121 tenant guard is an unnumbered, additive-only review proposal", () => {
  const path = "../docs/sql/issue-910-review-only-post-0121-tenant-integrity.sql";
  const content = readFileSync(new URL(path, import.meta.url), "utf8");
  const executable = content.replace(/--[^\n]*/g,"");
  assert.match(content,/UNNUMBERED/);
  assert.match(content,/NOT VALID/);
  assert.doesNotMatch(executable, /\b(?:INSERT INTO|DELETE FROM|UPDATE\s+\w+\s+SET|TRUNCATE|DROP TABLE|CREATE EXTENSION)\b/i);
  const fks = executable.match(/\bADD CONSTRAINT\s+[a-z_]+/gi) ?? [];
  assert.equal(fks.length,13);
  for (const pair of [
    "FOREIGN KEY (organization_id,legal_entity_id) REFERENCES legal_entities(organization_id,id)",
    "FOREIGN KEY (organization_id,employee_id) REFERENCES employees(organization_id,id)",
    "FOREIGN KEY (payroll_run_id,legal_entity_id) REFERENCES payroll_runs(id,legal_entity_id)",
  ]) assert.ok(executable.includes(pair), "missing required composite relation "+pair);
});
