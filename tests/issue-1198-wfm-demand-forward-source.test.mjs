import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { analyzeMigrationChanges } from "../scripts/check-sql-migration-history.mjs";
import { inventoryMigrationSources } from "../scripts/lib/migration-receipt-audit.mjs";
import { loadReviewedSql } from "../scripts/lib/reviewed-migration-runner.mjs";

const path="drizzle/0134_wfm_demand_missing_foundation_forward.sql";
const sql=readFileSync(new URL("../"+path, import.meta.url),"utf8");
const tables=[
  "workforce_demand_import_batches",
  "workforce_demand_observation_revisions",
  "workforce_demand_forecast_issues",
  "workforce_demand_forecast_scores",
  "workforce_demand_staffing_policies",
  "workforce_demand_staffing_policy_events",
];

test("0134 source is a single forward-only recovery with six exact creators",()=>{
  assert.match(sql,/ISSUE1198_MISSING_REQUIRED_PARENTS/);
  assert.match(sql,/ISSUE1198_ALREADY_PRESENT_OR_PARTIAL_STATE/);
  assert.ok(sql.indexOf("ISSUE1198_ALREADY_PRESENT_OR_PARTIAL_STATE") <
            sql.indexOf("CREATE TABLE workforce_demand_import_batches"));
  for (const name of tables) {
    assert.equal((sql.match(new RegExp("CREATE TABLE "+name+"\\s*\\(","g"))??[]).length,1,name);
  }
  assert.equal((sql.match(/CREATE TABLE /g)??[]).length,6);
  assert.doesNotMatch(sql,/CREATE TABLE IF NOT EXISTS/i,
    "never silently adopt an existing or partially created table");
  assert.doesNotMatch(sql,/\b(?:INSERT INTO|UPDATE\s+\w+\s+SET|DELETE FROM|TRUNCATE TABLE)\s+(?:public\.)?workforce_demand_/i,
    "no invented employer observations, approvals, journals or backfill");
  assert.doesNotMatch(sql,/^\s*(?:BEGIN|COMMIT|ROLLBACK)\s*;/im,
    "transaction is owned solely by reviewed runner");
  assert.equal((sql.match(/FOREIGN KEY\s*\(/g)??[]).length,9,
    "every cross-tenant parent relationship must be constrained");
  assert.doesNotMatch(sql,/ALTER\s+ROLE|GRANT\s+|CREATE\s+USER|SET\s+ROLE|CREATE\s+POLICY/i,
    "no role, grant, or bypass alteration");
});

test("0134 is accepted by the protected exact-SHA runner and consecutively numbered",()=>{
  const inventory=inventoryMigrationSources();
  const entry=inventory.files.find(x=>x.path===path);
  assert.ok(entry,"the numbered source must be in the source inventory");
  assert.ok(loadReviewedSql("drizzle",entry).includes("ISSUE1198_MISSING_REQUIRED_PARENTS"));
  assert.throws(()=>loadReviewedSql("drizzle",{...entry,sha256:"0".repeat(64)}),
    /SQL_CHANGED_AFTER_PLAN/);
  // History as it stood when 0134 was added: later forward migrations (0135+) excluded.
  const prefixHistory=inventory.files.map(x=>x.path)
    .filter(p=>p!==path&&Number(/^drizzle\/(\d{4})_/.exec(p)?.[1]??0)<134);
  const check=analyzeMigrationChanges(prefixHistory,[{status:"A",path}]);
  assert.deepEqual(check.errors,[]);
  assert.equal(check.maxNumber,133);
});
