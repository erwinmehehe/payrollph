import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
test("year-end read-only route binds organization before loading annualized tax data",()=>{
 const route=readFileSync("src/app/api/year-end/route.ts","utf8");
 assert.match(route,/assertOrganizationRole\([\s\S]*?organizationId,[\s\S]*?PAYROLL_OPERATOR_ROLES/);
 assert.match(route,/eq\(yearEndAdjustments\.organizationId, organizationId\)/);
 assert.match(route,/eq\(yearEndAdjustments\.taxYear, taxYear\)/);
 assert.match(route,/\.innerJoin\(employees, and\([\s\S]*?eq\(employees\.organizationId, organizationId\)/,
   "the adjustment must never join to an employee of a different employer");
 assert.match(route,/if \(!access\?\.companyWide\)/);
});
test("real HTTP runner refuses unsafe environments before database imports",()=>{
 const runner=readFileSync("scripts/qa/tenant-batches/year-end-json-http.mjs","utf8");
 assert.match(runner,/YEAR_END_PROOF_REFUSED/);
 assert.ok(runner.indexOf("guard();") < runner.indexOf('import("../../../src/db/index.ts")'));
 assert.match(runner,/assert\.deepEqual\(after,before/);
 assert.match(runner,/foreign\.status,403/);
 assert.match(runner,/employeeId: victim\.worker\.id/,
   "HTTP proof must seed a genuinely foreign-employee FK in the attacker organization");
 assert.match(runner,/crossEmployer\.employeeId, victim\.worker\.id/,
   "the genuine foreign-tenant reference must be checked");
 assert.match(runner,/coverageCredits:0/);
});
