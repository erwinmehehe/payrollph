import assert from "node:assert/strict";
import test from "node:test";
import { comparePayrollCsv } from "../scripts/reconcile-private-employer-payroll.mjs";

const header="periodStart,periodEnd,payDate,employeeNo,gross,sss,philHealth,pagIbig,withholding,net";
const csv=(...rows)=>[header,...rows].join("\n")+"\n";
const row=(id,net="12123.00",gross="15000.00")=>[
  "2026-10-01","2026-10-15","2026-10-15",id,gross,
  "750.00","375.00","100.00","1652.00",net,
].join(",");
test("synthetic: identical payroll passes only mathematical gate; no authorization claim",()=>{
 const x=comparePayrollCsv(csv(row("FICTIONAL-01")),csv(row("FICTIONAL-01")));
 assert.equal(x.pass,true);assert.equal(x.maximumAbsoluteVariancePesos,"0.00");
 assert.equal(x.employeesCompared,1);assert.equal(x.independentPayrollSignoff,false);
 assert.equal(x.approvedForPayment,false);
 assert.equal(JSON.stringify(x).includes("FICTIONAL-01"),false,"no employee IDs in evidence");
});
test("synthetic: PHP 0.01 passes; PHP 0.02 fails with field count",()=>{
 const a=csv(row("FICTIONAL-01"));
 const within=comparePayrollCsv(a,csv(row("FICTIONAL-01","12123.01")));
 assert.equal(within.pass,true);assert.equal(within.maximumAbsoluteVariancePesos,"0.01");
 const outside=comparePayrollCsv(a,csv(row("FICTIONAL-01","12123.02")));
 assert.equal(outside.pass,false);assert.equal(outside.varianceOverCent,1);
 assert.equal(outside.differencesByField.net,1);
});
test("synthetic: missing, additional or repeated employees fail",()=>{
 const a=csv(row("FICTIONAL-01"),row("FICTIONAL-02"));
 assert.equal(comparePayrollCsv(a,csv(row("FICTIONAL-01"))).pass,false);
 assert.equal(comparePayrollCsv(csv(row("FICTIONAL-01")),a).pass,false);
 assert.throws(()=>comparePayrollCsv(a,csv(row("FICTIONAL-01"),row("fictional-01"))),/DUPLICATE_EMPLOYEE/);
});
test("synthetic: mixed or mismatched pay periods and malformed money fail closed",()=>{
 const a=csv(row("FICTIONAL-01"));
 assert.throws(()=>comparePayrollCsv(a,csv(row("FICTIONAL-01").replace("2026-10-15,2026-10-15", "2026-10-30,2026-10-30"))),/PAYROLL_PERIOD_MISMATCH/);
 assert.throws(()=>comparePayrollCsv(a,csv(row("FICTIONAL-01").replace("12123.00","12,123.00"))),/INVALID_COLUMN_COUNT/);
 assert.throws(()=>comparePayrollCsv(a,csv(row("FICTIONAL-01").replace("12123.00","12123.001"))),/INVALID_MONEY/);
 assert.throws(()=>comparePayrollCsv(a,csv(row("FICTIONAL-01"),row("FICTIONAL-02").replace("2026-10-01","2026-11-01"))),/MIXED_PAYROLL_PERIODS|INVALID_PAYROLL_PERIOD/);
});
