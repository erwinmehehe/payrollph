import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { classifyInitialPush } from "../scripts/qa/verified-pg18-bootstrap.mjs";

test("first PG18 push must actually create a fresh schema without reported errors",()=>{
  assert.equal(classifyInitialPush(0,"[✓] Changes applied",""),true);
  assert.throws(()=>classifyInitialPush(0,"No changes detected",""),
    /PG18_FIRST_PUSH_NO_CONFIRMED_CREATION/);
  assert.throws(()=>classifyInitialPush(2,"Changes applied",""),
    /PG18_FIRST_PUSH_BAD_EXIT/);
  assert.throws(()=>classifyInitialPush(0,"",""),
    /PG18_FIRST_PUSH_NO_CONFIRMED_CREATION/);
});

test("Drizzle stdout SQL error fails even with exit code 0",()=>{
  const sqlError="error: cannot drop constraint documents_org_employee_id_hr_cases_unique because other objects depend on it";
  assert.throws(()=>classifyInitialPush(0,"Changes applied",sqlError),
    /PG18_FIRST_PUSH_REPORTED_ERROR/);
  assert.throws(()=>classifyInitialPush(0,sqlError,""),
    /PG18_FIRST_PUSH_REPORTED_ERROR/);
});

test("runner refuses remote targets and unsafe DDL options",()=>{
  const s=readFileSync(new URL("../scripts/qa/verified-pg18-bootstrap.mjs",import.meta.url),"utf8");
  assert.match(s,/assertDisposablePG18Environment\(env\)/);
  assert.match(s,/spawn\(cmd,\["run","db:push"\]/);
  assert.doesNotMatch(s,/shell:true|--force\b|--accept-data-loss|DROP SCHEMA|TRUNCATE\b/);
});
