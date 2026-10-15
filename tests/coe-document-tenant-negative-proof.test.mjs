import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { assertCOEConstraintRejection } from "../scripts/qa/coe-document-tenant-negative-proof.mjs";

test("#1019 tenant-negative acceptance requires exact composite COE FK violation", () => {
  assert.equal(assertCOEConstraintRejection({
    code:"23503",constraint:"employee_hr_cases_coe_document_tenant_fk"
  }), true);
  assert.throws(() => assertCOEConstraintRejection({
    code:"23503",constraint:"employee_hr_cases_employee_tenant_fk"
  }));
  assert.throws(() => assertCOEConstraintRejection({
    code:"23502",constraint:"employee_hr_cases_coe_document_tenant_fk"
  }));
});

test("#1019 executable tenant fixture is ephemeral and CI-only", () => {
  const s = readFileSync("scripts/qa/coe-document-tenant-negative-proof.mjs", "utf8");
  assert.match(s, /assertDisposablePG18Environment\(env\)/);
  assert.match(s, /SELECT current_database\(\)/);
  assert.match(s, /SAVEPOINT cross_tenant_denial/);
  assert.match(s, /ROLLBACK TO SAVEPOINT cross_tenant_denial/);
  assert.match(s, /if \(inTransaction\) await client\.query\("ROLLBACK"\)/);
  assert.match(s, /employee_hr_cases_coe_document_tenant_fk/);
  assert.match(s, /const valid = \(await client\.query\(caseSql/);
  assert.doesNotMatch(s, /COMMIT|NEON_DATABASE_URL|--force|DROP\s+TABLE|TRUNCATE|DELETE\s+FROM/);
});
