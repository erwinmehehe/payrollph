import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  validateBuilderSpec, runWhitelistedBuilder, builderRowsToCsv, explicitReportBuilderEmployerId,
} from "../src/lib/tenant-report-builder";
import { criticalReleaseFlagEnabled } from "../src/lib/critical-release-flags";

const facts = [
 { department: "SALES", status: "Active", headcount: 1, separatedCount: 0 },
 { department: "SALES", status: "Separated", headcount: 0, separatedCount: 1 },
 { department: "IT", status: "Active", headcount: 1, separatedCount: 0 },
];

test("whitelisted grouping counts active headcount and separated snapshot", () => {
 const spec = validateBuilderSpec({ dataset:"people",
   fields:["department", "headcount","separatedCount"], groupBy:"department" }, "owner");
 const rows = runWhitelistedBuilder(facts, spec);
 assert.deepEqual(rows, [["IT","1","0"],["SALES","1","1"]]);
});
test("salary/cost fields cannot be selected by an owner, bookkeeper or manager", () => {
 for(const role of ["owner","admin","bookkeeper","manager"]) {
   assert.throws(() => validateBuilderSpec({dataset:"payroll",fields:["department","payrollCost"]},role));
 }
 const payroll = validateBuilderSpec({dataset:"payroll",fields:["department","payrollCost"]},"hr");
 assert.deepEqual(payroll.fields,["department","payrollCost"]);
});
test("raw SQL, arbitrary filters, and invalid grouping are rejected", () => {
 assert.throws(() => validateBuilderSpec({ dataset:"people",fields:["DROP TABLE employees"] }, "hr"));
 assert.throws(() => validateBuilderSpec({ dataset:"people",fields:["department"], filters:{ rawSql:"SELECT *" } }, "hr"));
 assert.throws(() => validateBuilderSpec({ dataset:"people",fields:["department","status","headcount"],groupBy:"department" }, "hr"));
});
test("CSV neutralizes spreadsheet formula injection", () => {
 const spec=validateBuilderSpec({dataset:"people",fields:["department","headcount"]},"hr");
 const csv=builderRowsToCsv(spec,runWhitelistedBuilder([{department:"=HYPERLINK(1)",headcount:1}],spec));
 assert.ok(csv.includes("'=HYPERLINK(1)"));
});
test("new report capability is default-off", () => {
 assert.equal(criticalReleaseFlagEnabled("tenantReportBuilder",{}),false);
 assert.equal(criticalReleaseFlagEnabled("tenantReportBuilder",{TENANT_REPORT_BUILDER_ENABLED:"true"}),true);
});

test("recorded turnover facts roll up without confusing them with current separated headcount", () => {
 const spec=validateBuilderSpec({
   dataset:"people",fields:["department","headcount","separatedCount","turnoverCount"],
   groupBy:"department",
 }, "hr");
 const rows=runWhitelistedBuilder([
   {department:"OPS",headcount:1,separatedCount:0,turnoverCount:0},
   {department:"OPS",headcount:0,separatedCount:1,turnoverCount:1},
   {department:"OPS",headcount:0,separatedCount:1,turnoverCount:0},
 ],spec);
 assert.deepEqual(rows,[["OPS","1","2","1"]]);
});

test("partial-window approved leave is rejected rather than overstated", async () => {
 const {leaveRangeFullyWithinReport} = await import("../src/lib/tenant-report-builder");
 assert.equal(leaveRangeFullyWithinReport("2026-10-01","2026-10-05","2026-10-01","2026-10-31"),true);
 assert.equal(leaveRangeFullyWithinReport("2026-09-29","2026-10-05","2026-10-01","2026-10-31"),false);
 assert.equal(leaveRangeFullyWithinReport("2026-10-25","2026-11-02","2026-10-01","2026-10-31"),false);
});

test("multi-entity HR report export needs future group-scope authorization",async()=>{
 const {builderRequiresEntityRole}=await import("../src/lib/tenant-report-builder");
 assert.equal(builderRequiresEntityRole(0),true);
 assert.equal(builderRequiresEntityRole(-1),true);
 assert.equal(builderRequiresEntityRole(1),false);
 assert.equal(builderRequiresEntityRole(2),true);
 assert.equal(builderRequiresEntityRole(999),true);
});

test("report route refuses ambiguous employer history before exporting data", () => {
 const route=readFileSync("src/app/api/reports/builder/route.ts","utf8");
 assert.match(route, /eq\(legalEntities\.organizationId, organizationId\)/);
 assert.match(route, /employers\[0\]\.active !== true/);
 for(const name of ["employees", "payrollRuns", "orgUnits"]) {
   assert.ok(route.includes("isNull(" + name + ".legalEntityId)"), name);
   assert.ok(route.includes("ne(" + name + ".legalEntityId, employerId)"), name);
 }
 assert.match(route, /ENTITY_ATTRIBUTION_REQUIRED/);
 assert.match(route, /status: 409/);
});

test("payroll aggregation preserves exact decimal centavos", () => {
 const spec=validateBuilderSpec({dataset:"payroll",fields:["department","payrollCost","otLineCost"],groupBy:"department"},"payroll");
 assert.deepEqual(runWhitelistedBuilder([
  {department:"OPS",payrollCost:"0.10",otLineCost:"0.10"},
  {department:"OPS",payrollCost:"0.20",otLineCost:"0.20"},
  {department:"OPS",payrollCost:"99999999.99",otLineCost:"0.01"},
 ],spec),[["OPS","100000000.29","0.31"]]);
});

test("report-builder page employer ID accepts only canonical positive safe integers", () => {
  assert.equal(explicitReportBuilderEmployerId("1"), 1);
  assert.equal(explicitReportBuilderEmployerId("9007199254740991"), Number.MAX_SAFE_INTEGER);
  for (const value of [undefined, null, "", "0", "-1", "1.5", "1e2", "01",
    " 1", "1 ", "+1", "1&organizationId=2", "9007199254740992", ["1"], 1, {}, NaN]) {
    assert.equal(explicitReportBuilderEmployerId(value), null, String(value));
  }
});
