import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { classifyDrizzleRepeatPush } from "../scripts/qa/verified-pg18-repeat-push.mjs";

test("accept only an exit-zero Drizzle response proving a real NO-OP",()=>{
  assert.equal(classifyDrizzleRepeatPush(0,"\u001b[32m[✓] No changes detected\u001b[0m",""),true);
  assert.throws(()=>classifyDrizzleRepeatPush(1,"No changes detected",""),/PG18_REPEAT_PUSH_NONZERO_EXIT/);
  assert.throws(()=>classifyDrizzleRepeatPush(0,"Changes applied",""),/PG18_REPEAT_PUSH_PHANTOM_DDL_OR_UNPROVEN_NOOP/);
  assert.throws(()=>classifyDrizzleRepeatPush(0,"",""),/PG18_REPEAT_PUSH_PHANTOM_DDL_OR_UNPROVEN_NOOP/);
});

test("reject Drizzle's known silent PostgreSQL constraint failure (even with exit 0)",()=>{
  const error="error: cannot drop constraint documents_org_employee_id_hr_cases_unique on table documents because other objects depend on it";
  assert.throws(()=>classifyDrizzleRepeatPush(0,error,""),/PG18_REPEAT_PUSH_REPORTED_ERROR/);
  assert.throws(()=>classifyDrizzleRepeatPush(0,"No changes detected",error),/PG18_REPEAT_PUSH_REPORTED_ERROR/);
  assert.throws(()=>classifyDrizzleRepeatPush(0,"No changes detected\nALTER TABLE documents DROP CONSTRAINT foo;",""),
    /PG18_REPEAT_PUSH_PHANTOM_DDL_OR_UNPROVEN_NOOP/);
});

test("only the bounded disposable GitHub CI target may execute a second schema push",()=>{
  const source=readFileSync(new URL("../scripts/qa/verified-pg18-repeat-push.mjs",import.meta.url),"utf8");
  assert.match(source,/assertDisposablePG18Environment\(env\)/);
  assert.match(source,/spawn\(executable, \["run","db:push"\]/);
  assert.match(source,/PG18_REPEAT_PUSH_REPORTED_ERROR/);
  assert.match(source,/No changes detected/i);
  assert.doesNotMatch(source,/shell:true|--force\b|--accept-data-loss|DROP SCHEMA|TRUNCATE\b/);
});
