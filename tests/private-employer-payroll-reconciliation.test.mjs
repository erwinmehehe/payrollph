import assert from "node:assert/strict";
import test from "node:test";
import { comparePayrollCsv } from "../scripts/reconcile-private-employer-payroll.mjs";

const header="legalEmployerId,periodStart,periodEnd,payDate,employeeNo,gross,sss,philHealth,pagIbig,withholding,net";
const csv=(...rows)=>[header,...rows].join("\n")+"\n";
const row=(id,net="12123.00",gross="15000.00")=>[
  "FICTIONAL-EMPLOYER-A","2026-10-01","2026-10-15","2026-10-15",id,gross,
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
 assert.throws(()=>comparePayrollCsv(a,csv(row("FICTIONAL-01").replace("FICTIONAL-EMPLOYER-A","FICTIONAL-EMPLOYER-B"))),/LEGAL_EMPLOYER_MISMATCH/);
 assert.throws(()=>comparePayrollCsv(a,csv(row("FICTIONAL-01"),row("FICTIONAL-02").replace("FICTIONAL-EMPLOYER-A","FICTIONAL-EMPLOYER-B"))),/MIXED_LEGAL_EMPLOYERS/);
});

test("synthetic: extra personal-data columns are rejected, while order-only changes remain valid",()=>{
 const a=csv(row("FICTIONAL-01"));
 const unsafe=[header+",employeeName,bankAccount",row("FICTIONAL-01")+",PRIVATE-NAME,PRIVATE-BANK",""].join("\n");
 assert.throws(()=>comparePayrollCsv(a,unsafe),/NONCANONICAL_CSV_HEADER/);
 assert.throws(()=>comparePayrollCsv(unsafe,unsafe),/NONCANONICAL_CSV_HEADER/);
 // Reverse column order without changing any source values.
 const ordered=[header.split(",").reverse().join(","),row("FICTIONAL-01").split(",").reverse().join(","),""].join("\n");
 assert.equal(comparePayrollCsv(a,ordered).pass,true);
});

test("synthetic: valid quoted employee identifiers and CRLF remain supported, malformed trailing text fails",()=>{
 const a=csv(row("FICTIONAL-01"));
 const quoted=csv(row('"FICTIONAL-01"')).replace(/\n/g,"\r\n");
 assert.equal(comparePayrollCsv(a,quoted).pass,true);
 const invalid=csv(row('"FICTIONAL-01"trailing'));
 assert.throws(()=>comparePayrollCsv(a,invalid),/INVALID_CSV_QUOTE/);
 const hiddenNewline=csv(row('"FICTIONAL\n01"'));
 assert.throws(()=>comparePayrollCsv(a,hiddenNewline),/INVALID_EMPLOYEE_NO/);
});

test("synthetic: bounded offline CSV input rejects oversized files, rows and amounts",()=>{
 const a=csv(row("FICTIONAL-01"));
 assert.throws(()=>comparePayrollCsv(a+"x".repeat(8*1024*1024),a),/CSV_TOO_LARGE/);
 const many=[header,...Array.from({length:50_001},()=>row("FICTIONAL-01")),""].join("\n");
 assert.throws(()=>comparePayrollCsv(many,a),/TOO_MANY_CSV_ROWS/);
 const largeMoney=csv(row("FICTIONAL-01").replace("15000.00","9999999999.00"));
 assert.throws(()=>comparePayrollCsv(a,largeMoney),/INVALID_MONEY/);
});
