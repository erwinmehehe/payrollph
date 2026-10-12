import assert from "node:assert/strict";
import test from "node:test";
import {
  validateBuilderSpec, runWhitelistedBuilder, builderRowsToCsv,
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
