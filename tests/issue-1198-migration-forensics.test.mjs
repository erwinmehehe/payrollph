import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const sqlPath="docs/engineering/issue-1198-catalog-only-inspection.sql";
const docPath="docs/engineering/issue-1198-migration-forensics-20261017.md";
const workflowPath=".github/workflows/historical-dba-evidence.yml";
const sql=readFileSync(sqlPath,"utf8");
const doc=readFileSync(docPath,"utf8");
const workflow=readFileSync(workflowPath,"utf8");

test("DBA packet contains only catalog reads inside a bounded READ ONLY/ROLLBACK transaction",()=>{
  const uncommented=sql.replace(/--[^\n]*/g,"").trim();
  const statements=uncommented.split(";").map(s=>s.trim()).filter(Boolean);
  assert.ok(statements.length>=10,"Partial catalog worksheet");
  assert.match(statements[0],/^BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY$/);
  assert.equal(statements.at(-1),"ROLLBACK");
  assert.ok(statements.slice(1,-1).every(s=>/^(?:SET LOCAL|SELECT|WITH)\b/i.test(s)),
    "Only SET LOCAL timeouts and SELECT/WITH catalog statements are permitted");
  const withoutLiterals=uncommented.replace(/'(?:''|[^'])*'/g,"''");
  assert.doesNotMatch(withoutLiterals,
    /\b(?:INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|TRUNCATE|GRANT|REVOKE|MERGE|CALL|DO|COPY|COMMIT|EXECUTE|REFRESH)\b/i);
  assert.doesNotMatch(withoutLiterals, /\bFROM\s+(?:"?public"?\.)?(?:"?(?:employees|payroll_runs|payroll_entries|bank_accounts|users|sessions)"?)\b/i);
  for(const name of ["pg_catalog.pg_class","pg_catalog.pg_roles","pg_catalog.pg_auth_members",
    "pg_catalog.pg_constraint","pg_catalog.pg_attribute","pg_catalog.pg_indexes"]) {
    assert.ok(sql.includes(name),"Missing catalog-only source "+name);
  }
  assert.match(sql,/statement_timeout\s*=\s*'7000ms'/);
  assert.match(sql,/lock_timeout\s*=\s*'2000ms'/);
  assert.match(sql,/HISTORICAL_EXECUTION_UNPROVEN/);
});

test("forensic report preserves no-journal, no-runtime-attestation and no-false-receipt boundaries",()=>{
  for(const term of ["271","154","124","7 live-only","#1078","#1090","#1198",
    "UNPROVEN","NO-GO","production-migration-receipts-audit.yml",
    "production-runtime-db-target-attestation.yml","issue-1031-full-schema-diff.yml",
    "issue-1198-catalog-only-inspection.sql","not a new authenticated production query"]) {
    assert.ok(doc.toLowerCase().includes(term.toLowerCase()),"Missing evidence limitation or handoff: "+term);
  }
  assert.doesNotMatch(doc,/historical sql execution:\s*(?:applied|never applied|verified)/i);
});

test("DBA forensic packet is validated on PR and main, never executed as live production SQL",()=>{
  const pr=workflow.split("  pull_request:\n")[1]?.split("  push:\n")[0];
  const push=workflow.split("  push:\n")[1]?.split("  workflow_dispatch:\n")[0];
  for(const section of [pr,push]){
    assert.ok(section,"Missing CI event");
    for(const name of [sqlPath,docPath,"tests/issue-1198-migration-forensics.test.mjs"]) {
      assert.ok(section.includes(JSON.stringify(name)),"File changes must retrigger offline guard: "+name);
    }
  }
  assert.ok(workflow.includes("node --test tests/issue-1198-migration-forensics.test.mjs"));
  assert.ok(!workflow.includes("psql -f "+sqlPath));
  assert.ok(!workflow.includes("psql -v ON_ERROR_STOP=1 -f "+sqlPath));
});
