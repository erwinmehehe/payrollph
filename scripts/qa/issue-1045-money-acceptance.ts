/**
 * Issue #1045: OFFLINE fictional-data rehearsal, NOT human payroll acceptance.
 * No database, agency, payout, production, external API, or migration access.
 * Exact observed results are generated from the checked-out source; EXPECTED
 * values below are independent literal arithmetic hypotheses for human review.
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { computeFinalPay } from "../../src/lib/final-pay";
import { finalPayReviewCsv, finalPayReviewShortfall } from "../../src/lib/final-pay-review-evidence";
import { resolvePayProfile, attendanceDeductionsForCutoff } from "../../src/lib/pay-basis";
import { computePhilHealth } from "../../src/lib/payroll-rules";
import { allocateMandatoryDeductions } from "../../src/lib/payroll-mandatory-shortfall";
import { evaluatePayrollAssurance } from "../../src/lib/payroll-assurance";

type Value = number | boolean;
type Case = {
  id: string; ticket: "M-3" | "M-6" | "M-8"; note: string; source: string;
  expected: Record<string, string>; observe: () => Record<string, Value>;
};
const date = "2026-10-15";
const cases: Case[] = [];
const add = (entry: Case) => cases.push(entry);
const cents = (amount: number) => {
  const raw = amount * 100, nearest = Math.round(raw);
  if (!Number.isFinite(raw) || !Number.isSafeInteger(nearest) || Math.abs(raw - nearest) > 0.000001)
    throw Error("Invalid or subcentavo observed result: " + amount);
  return nearest;
};
const formatted = (value: Value) => typeof value === "boolean" ? String(value) : (cents(value) / 100).toFixed(2);
const finalBase = {
  releasedBasicYtd: 300000, historicalBasicYtd: 0, unpaidBasicSalary: 0,
  thirteenthPaidYtd: 25000, grossCompensationYtd: 300000,
  statutoryContributionsYtd: 0, taxWithheldYtd: 0, mwe: false,
  leaveMonetizationPay: 0, separationPay: 0, retirementPay: 0,
  otherBenefits: 0, loanDeductions: 0,
};
function finalResult(overrides: Partial<typeof finalBase> & { finalStatutoryDeductions?: number; taxableLeaveMonetizationPay?: number } = {}) {
  const r = computeFinalPay({ ...finalBase, ...overrides });
  return {
    grossFinalPay: r.grossFinalPay, taxDue: r.taxDue, taxAdjustment: r.taxAdjustment,
    taxRequested: r.requestedTaxCollection, taxApplied: r.appliedTaxCollection,
    taxUncollected: r.unpaidTaxWithholding,
    statutoryRequested: r.finalStatutoryDeductions,
    statutoryApplied: r.appliedStatutoryDeductions,
    statutoryUncollected: r.unpaidStatutoryDeductions,
    mandatoryUncollected: r.unpaidMandatoryDeductions,
    signedMandatoryBalance: (cents(r.grossFinalPay) + cents(r.taxAdjustment) - cents(r.finalStatutoryDeductions)) / 100,
    loanRequested: r.requestedLoanDeductions, loanApplied: r.loanDeductions,
    loanDeferred: r.deferredLoanBalance, netFinalPay: r.netFinalPay,
  };
}
// 300,000 - 25,000 exempt 13th already paid is taxable basic 300,000;
// (300,000 - 250,000) x 15% = 7,500; 0 - 7,500 = -7,500.
add({ id: "M3-F01", ticket: "M-3", note: "Zero final gross; negative unpaid tax survives the payable floor",
  source: "final-pay.ts:129-249; ph-statutory-rule-packs.ts:88-95",
  expected: { grossFinalPay:"0.00",taxDue:"7500.00",taxAdjustment:"-7500.00",
    taxRequested:"7500.00",taxApplied:"0.00",taxUncollected:"7500.00",
    mandatoryUncollected:"7500.00",signedMandatoryBalance:"-7500.00",netFinalPay:"0.00" },
  observe: () => finalResult() });
// 25,000 + 500 other-benefit pool is exempt; 300,000 - 200 contribution = 299,800 taxable;
// (299,800 - 250,000) x 15% = 7,470; 500 applied tax, 6,970 unpaid tax + 200 unpaid statutory.
add({ id:"M3-F02",ticket:"M-3",note:"Partial tax collection before provisional statutory allocation",
  source:"final-pay.ts:160-249; annualization.ts:103-160",
  expected:{grossFinalPay:"500.00",taxDue:"7470.00",taxAdjustment:"-7470.00",
    taxRequested:"7470.00",taxApplied:"500.00",taxUncollected:"6970.00",
    statutoryRequested:"200.00",statutoryApplied:"0.00",statutoryUncollected:"200.00",
    mandatoryUncollected:"7170.00",signedMandatoryBalance:"-7170.00",netFinalPay:"0.00"},
  observe:()=>finalResult({otherBenefits:500,finalStatutoryDeductions:200}) });
// Zero gross - 123.45 statutory = -123.45; a separate 500 loan is fully deferred.
add({id:"M3-F03",ticket:"M-3",note:"Unpaid statutory contributions and a distinct deferred loan",
  source:"final-pay.ts:201-249",
  expected:{grossFinalPay:"0.00",taxDue:"0.00",statutoryRequested:"123.45",
    statutoryApplied:"0.00",statutoryUncollected:"123.45",mandatoryUncollected:"123.45",
    signedMandatoryBalance:"-123.45",loanRequested:"500.00",loanApplied:"0.00",
    loanDeferred:"500.00",netFinalPay:"0.00"},
  observe:()=>finalResult({releasedBasicYtd:0,thirteenthPaidYtd:0,grossCompensationYtd:0,
    mwe:true,finalStatutoryDeductions:123.45,loanDeductions:500}) });
// 900 available - 300 mandatory - 250 loan = 350 payable; no shortfall.
add({id:"M3-F04",ticket:"M-3",note:"Fully funded final pay; loan is applied after statutory",
  source:"final-pay.ts:201-249",
  expected:{grossFinalPay:"900.00",taxDue:"0.00",taxAdjustment:"0.00",
    statutoryRequested:"300.00",statutoryApplied:"300.00",statutoryUncollected:"0.00",
    mandatoryUncollected:"0.00",signedMandatoryBalance:"600.00",loanApplied:"250.00",
    loanDeferred:"0.00",netFinalPay:"350.00"},
  observe:()=>finalResult({releasedBasicYtd:240000,thirteenthPaidYtd:20000,grossCompensationYtd:240000,
    leaveMonetizationPay:900,taxableLeaveMonetizationPay:0,finalStatutoryDeductions:300,loanDeductions:250}) });
// 10,000 paid - 7,500 tax due = 2,500 positive refund; no mandatory shortfall.
add({id:"M3-F05",ticket:"M-3",note:"Prior tax overwithholding: refund not a negative collection",
  source:"annualization.ts:103-160; final-pay.ts:190-249",
  expected:{grossFinalPay:"0.00",taxDue:"7500.00",taxAdjustment:"2500.00",
    taxRequested:"0.00",taxApplied:"0.00",taxUncollected:"0.00",
    mandatoryUncollected:"0.00",signedMandatoryBalance:"2500.00",netFinalPay:"2500.00"},
  observe:()=>finalResult({taxWithheldYtd:10000}) });
const sampleReview = {
  id:7, employeeNo:"SYN-FINAL-07",employeeName:"Fictional Worker 07",
  grossFinalPay:"0.00",netFinalPay:"0.00",taxAdjustment:"-7500.00",
  finalStatutoryDeductions:"50.00",loanDeductions:"0.00",
};
// 0 - (-7,500) + 50 = 7,550 debt; detailed immutable split 7,500 + 50.
for (const missing of [false,true]) add({
  id:missing?"M3-R02":"M3-R01",ticket:"M-3",
  note:missing?"Legacy review without source split cannot claim verified tax/stat shares":"Review CSV retains split and blocks approval",
  source:"final-pay-review-evidence.ts:22-43,87-116",
  expected:missing
    ? {shortfallTotal:"7550.00",splitRecorded:"false",reconciliationRequired:"true",csvBlocksApproval:"true",csvNeedsRecompute:"true"}
    : {shortfallTotal:"7550.00",shortfallTax:"7500.00",shortfallStatutory:"50.00",splitRecorded:"true",reconciliationRequired:"true",csvBlocksApproval:"true"},
  observe:()=>{
    const record={...sampleReview,computationSnapshot:missing ? null : {
      unpaidTaxWithholding:7500,unpaidStatutoryDeductions:50,
      unpaidMandatoryDeductions:7550,shortfallAllocationPolicy:"tax-first-provisional-review-required",
    }};
    const r=finalPayReviewShortfall(record),csv=finalPayReviewCsv(record);
    return {shortfallTotal:r.total??Number.NaN,shortfallTax:r.tax??Number.NaN,
      shortfallStatutory:r.statutory??Number.NaN,splitRecorded:r.splitRecorded,
      reconciliationRequired:r.reconciliationRequired,
      csvBlocksApproval:csv.includes("BLOCKED - FINANCE/PAYROLL RECONCILIATION REQUIRED"),
      csvNeedsRecompute:csv.includes("NOT RECORDED - RECOMPUTE")};
  },
});
type Profile = { basis:"monthly"|"daily"; rate:number; days:number; hours:number };
function phic(p:Profile) {
  const resolved=resolvePayProfile({payBasis:p.basis,rateAmount:p.rate,
    standardWorkDaysPerMonth:p.days,standardHoursPerDay:p.hours});
  const r=computePhilHealth(resolved.monthlyEquivalent,date);
  if(cents(r.total)!==cents(r.employee)+cents(r.employer)) throw Error("PHIC EE+ER does not equal premium");
  return {monthlyEquivalent:resolved.monthlyEquivalent,premiumBase:r.base,
    premiumTotal:r.total,employeeShare:r.employee,employerShare:r.employer};
}
const phicCases: Array<{id:string;profile:Profile;expected:Record<string,string>;note:string}>=[
  // 32,000 x 5% = 1,600; EE/ER 800 each.
  {id:"M6-P01",profile:{basis:"monthly",rate:32000,days:22,hours:8},
    expected:{monthlyEquivalent:"32000.00",premiumBase:"32000.00",premiumTotal:"1600.00",employeeShare:"800.00",employerShare:"800.00"},
    note:"Fixed monthly basic excludes overtime/bonus/allowance"},
  // Salary 9,000 < 10,000 floor; 10,000 x 5% = 500, halves 250.
  {id:"M6-P02",profile:{basis:"monthly",rate:9000,days:22,hours:8},
    expected:{monthlyEquivalent:"9000.00",premiumBase:"10000.00",premiumTotal:"500.00",employeeShare:"250.00",employerShare:"250.00"},
    note:"Monthly fixed basic below PhilHealth floor"},
  // Salary 125,000 > 100,000 ceiling; 100,000 x 5% = 5,000, halves 2,500.
  {id:"M6-P03",profile:{basis:"monthly",rate:125000,days:22,hours:8},
    expected:{monthlyEquivalent:"125000.00",premiumBase:"100000.00",premiumTotal:"5000.00",employeeShare:"2500.00",employerShare:"2500.00"},
    note:"Monthly fixed basic above PhilHealth cap"},
  // 10,000.20 x 5% = 500.01; EE 250.00 / ER 250.01.
  {id:"M6-P04",profile:{basis:"monthly",rate:10000.20,days:22,hours:8},
    expected:{monthlyEquivalent:"10000.20",premiumBase:"10000.20",premiumTotal:"500.01",employeeShare:"250.00",employerShare:"250.01"},
    note:"Odd-cent split: employer receives remaining centavo"},
  // Fictional configured 700 x 20 days = 14,000; 5% = 700 split 350/350.
  {id:"M6-P05",profile:{basis:"daily",rate:700,days:20,hours:8},
    expected:{monthlyEquivalent:"14000.00",premiumBase:"14000.00",premiumTotal:"700.00",employeeShare:"350.00",employerShare:"350.00"},
    note:"Daily-paid 20-day configuration; DOLE EMR eligibility NOT independently approved"},
  // Same daily rate, different 26-day configuration: 700 x 26 = 18,200; 5% = 910 split 455.
  {id:"M6-P06",profile:{basis:"daily",rate:700,days:26,hours:8},
    expected:{monthlyEquivalent:"18200.00",premiumBase:"18200.00",premiumTotal:"910.00",employeeShare:"455.00",employerShare:"455.00"},
    note:"Daily-paid 26-day configuration; NOT a universal daily multiplier"},
  // 800 x 22 = 17,600; 5% = 880 split 440/440.
  {id:"M6-P07",profile:{basis:"daily",rate:800,days:22,hours:8},
    expected:{monthlyEquivalent:"17600.00",premiumBase:"17600.00",premiumTotal:"880.00",employeeShare:"440.00",employerShare:"440.00"},
    note:"Daily-paid 22-day configuration; employment schedule requires independent proof"},
  // 4,000 x 26 = 104,000 > 100,000; capped total 5,000.
  {id:"M6-P08",profile:{basis:"daily",rate:4000,days:26,hours:8},
    expected:{monthlyEquivalent:"104000.00",premiumBase:"100000.00",premiumTotal:"5000.00",employeeShare:"2500.00",employerShare:"2500.00"},
    note:"Daily-paid configured monthly-equivalent exceeds cap"},
  // 300 x 20 = 6,000 < 10,000; floored total 500.
  {id:"M6-P09",profile:{basis:"daily",rate:300,days:20,hours:8},
    expected:{monthlyEquivalent:"6000.00",premiumBase:"10000.00",premiumTotal:"500.00",employeeShare:"250.00",employerShare:"250.00"},
    note:"Daily-paid configured monthly-equivalent below floor"},
];
for(const entry of phicCases) add({id:entry.id,ticket:"M-6",note:entry.note,
  source:"pay-basis.ts:24-70; payroll-rules.ts:45-68; ph-statutory-rule-packs.ts:55-65",
  expected:entry.expected,observe:()=>phic(entry.profile)});
// 35,200 / 22 / 8 = 200/hour; 15m late = 50, 30m undertime = 100;
// PhilHealth MBS remains 35,200; premium 1,760, EE/ER 880 each.
add({id:"M6-P10",ticket:"M-6",note:"Attendance deductions reduce pay, never the fixed basic for PHIC",
  source:"pay-basis.ts:72-90; payroll-rules.ts:45-68",
  expected:{monthlyEquivalent:"35200.00",premiumBase:"35200.00",premiumTotal:"1760.00",
    employeeShare:"880.00",employerShare:"880.00",lateDeduction:"50.00",undertimeDeduction:"100.00"},
  observe:()=>{
    const profile=resolvePayProfile({payBasis:"monthly",rateAmount:35200,standardWorkDaysPerMonth:22,standardHoursPerDay:8});
    const d=attendanceDeductionsForCutoff(profile,15,30),r=phic({basis:"monthly",rate:35200,days:22,hours:8});
    return {...r,lateDeduction:d.tardinessDeduction,undertimeDeduction:d.undertimeDeduction};
  },
});
const due={sss:80,philHealth:40,pagIbig:10,withholding:100,yearEndTaxAdjustment:0,tardiness:0,undertime:0};
function mandatory(gross:number,changes:Partial<typeof due>={}) {
  const r=allocateMandatoryDeductions(gross,{...due,...changes});
  if(cents(r.requestedTotal)!==cents(r.appliedTotal)+cents(r.totalUncollected)
    || cents(gross)!==cents(r.appliedTotal)+cents(r.disposableBeforeOptional))
    throw Error("Centavo footing violated by mandatory deduction allocation");
  return {requested:r.requestedTotal,applied:r.appliedTotal,uncollected:r.totalUncollected,
    net:r.disposableBeforeOptional,appliedTax:r.applied.withholding,appliedSSS:r.applied.sss,
    appliedPhilHealth:r.applied.philHealth,appliedPagIbig:r.applied.pagIbig,
    appliedRefund:r.applied.yearEndTaxAdjustment,uncollectedSSS:r.uncollected.sss,
    uncollectedPhilHealth:r.uncollected.philHealth,uncollectedPagIbig:r.uncollected.pagIbig,
    uncollectedTax:r.uncollected.withholding};
}
// Requested 80+40+10+100=230; tax-first consumes 100; SSS/PHIC/HDMF 130 remains.
add({id:"M8-D01",ticket:"M-8",note:"Headline PHP 100/230/130 split, not a legal priority endorsement",
  source:"payroll-mandatory-shortfall.ts:16-95",
  expected:{requested:"230.00",applied:"100.00",uncollected:"130.00",net:"0.00",
    appliedTax:"100.00",appliedSSS:"0.00",appliedPhilHealth:"0.00",appliedPagIbig:"0.00",
    uncollectedTax:"0.00",uncollectedSSS:"80.00",uncollectedPhilHealth:"40.00",uncollectedPagIbig:"10.00"},
  observe:()=>mandatory(100) });
// Zero gross; 10.01 + 5.00 + 2.02 = 17.03 wholly unpaid.
add({id:"M8-D02",ticket:"M-8",note:"Zero-gross gross/net and unpaid liability persist",
  source:"payroll-mandatory-shortfall.ts:37-95",
  expected:{requested:"17.03",applied:"0.00",uncollected:"17.03",net:"0.00",
    uncollectedSSS:"10.01",uncollectedPhilHealth:"5.00",uncollectedPagIbig:"2.02"},
  observe:()=>mandatory(0,{sss:10.01,philHealth:5,pagIbig:2.02,withholding:0}) });
// Gross 0.01 / SSS due 0.02 => applied 0.01, unpaid 0.01, net zero.
add({id:"M8-D03",ticket:"M-8",note:"One-cent mandatory under-collection",
  source:"payroll-mandatory-shortfall.ts:37-95",
  expected:{requested:"0.02",applied:"0.01",uncollected:"0.01",net:"0.00",
    appliedSSS:"0.01",uncollectedSSS:"0.01"},
  observe:()=>mandatory(0.01,{sss:0.02,philHealth:0,pagIbig:0,withholding:0}) });
// Gross 300 - requested 230 = 70 net; no uncollected amount.
add({id:"M8-D04",ticket:"M-8",note:"Sufficient gross pays every component with 70 net",
  source:"payroll-mandatory-shortfall.ts:37-95",
  expected:{requested:"230.00",applied:"230.00",uncollected:"0.00",net:"70.00",
    appliedTax:"100.00",appliedSSS:"80.00",appliedPhilHealth:"40.00",appliedPagIbig:"10.00"},
  observe:()=>mandatory(300) });
// Refund 50 increases cash 100→150; collect tax 50 + SSS 100;
// net requested 120+70+10+50-50=200; applied net 100, remaining 100 unpaid.
add({id:"M8-D05",ticket:"M-8",note:"Tax refund is negative applied line, not erased shortfall",
  source:"payroll-mandatory-shortfall.ts:55-95",
  expected:{requested:"200.00",applied:"100.00",uncollected:"100.00",net:"0.00",
    appliedRefund:"-50.00",appliedTax:"50.00",appliedSSS:"100.00",
    uncollectedSSS:"20.00",uncollectedPhilHealth:"70.00",uncollectedPagIbig:"10.00"},
  observe:()=>mandatory(100,{sss:120,philHealth:70,pagIbig:10,withholding:50,yearEndTaxAdjustment:-50}) });
// Completed trace 230 = 100 + 130 MUST be blocking; normal acknowledgement cannot waive it.
add({id:"M8-G01",ticket:"M-8",note:"High-severity uncollected trace is an unwaivable release assurance finding",
  source:"payroll-assurance.ts; payroll-mandatory-shortfall.ts",
  expected:{releaseBlocked:"true",highSeverity:"true"},
  observe:()=>{
    const a=evaluatePayrollAssurance([{id:7,employeeId:7,grossPay:100,deductions:100,netPay:0,status:"Exception",
      lineItems:[{code:"UNPAID_MANDATORY",label:"Uncollected mandatory",amount:"130.00"}],
      trace:{inputs:["mandatoryRequested=230.00","mandatoryApplied=100.00","mandatoryUncollected=130.00"],flags:[]}}]);
    const finding=a.findings.find(x=>x.code==="MANDATORY_DEDUCTIONS_UNCOLLECTED");
    return {releaseBlocked:finding?.blocking===true,highSeverity:finding?.severity==="high"};
  },
});

const sha=execFileSync("git",["rev-parse","HEAD"],{encoding:"utf8"}).trim();
if(execFileSync("git",["status","--porcelain"],{encoding:"utf8"}).trim())
  throw Error("Only a clean checkout can produce the acceptance evidence.");
const results: Array<{id:string;ticket:string;metric:string;unit:string;expected:string;observed:string;
  varianceCentavos:string;engineeringStatus:string;humanReviewStatus:string;source:string}>=[];
for(const entry of cases) {
  const observed=entry.observe();
  for(const [metric,expected] of Object.entries(entry.expected)) {
    const value=observed[metric];
    if(value===undefined)throw Error(entry.id+" omitted actual metric "+metric);
    const actual=formatted(value);
    const flag=expected==="true"||expected==="false";
    if(flag!==(typeof value==="boolean"))throw Error(entry.id+" expected/observed unit mismatch: "+metric);
    if(!flag&&!/^-?(?:0|[1-9]\d*)\.\d{2}$/.test(expected))throw Error(entry.id+" invalid literal centavos "+metric);
    const parsedCents=flag?0:((expected.startsWith("-")?-1:1)*(() => { const [whole,fraction]=expected.replace("-","").split("."); return Number(whole)*100+Number(fraction); })());
    const variance=flag?"":String(cents(value as number)-parsedCents);
    const status=actual===expected?"ENGINEERING_MATCH":"ENGINEERING_DIFF";
    results.push({id:entry.id,ticket:entry.ticket,metric,unit:flag?"BOOLEAN":"PHP",
      expected,observed:actual,varianceCentavos:variance,engineeringStatus:status,
      humanReviewStatus:"NOT_RUN",source:entry.source});
  }
}
const mismatch=results.filter(r=>r.engineeringStatus!=="ENGINEERING_MATCH");
const output="qa-artifacts/issue-1045-money-acceptance";
mkdirSync(output,{recursive:true});
const scriptHash=createHash("sha256").update(readFileSync("scripts/qa/issue-1045-money-acceptance.ts")).digest("hex");
const payload={
  schema:"synthetic-money-acceptance-v1",sourceSha:sha,scriptSha256:scriptHash,asOf:date,
  fictionalOnly:true,generatedAt:new Date().toISOString(),
  independentPractitionerAcceptance:"NOT_RUN",
  productionOrAgencyAcceptance:"NOT_RUN",noMoneyMoved:true,
  cases:cases.length,metrics:results.length,engineeringMatches:results.length-mismatch.length,
  engineeringDifferences:mismatch.length,results,
};
writeFileSync(output+"/observations.json",JSON.stringify(payload,null,2)+"\n");
const headers=["case_id","ticket","metric","unit","expected","observed","variance_centavos",
  "engineering_status","independent_review_status","source"];
const csvCell=(value:string)=>{
  const safe=/^[=+@]/.test(value)?"'"+value:value;
  return '"'+safe.replaceAll('"','""')+'"';
};
writeFileSync(output+"/observations.csv",[headers.join(","),
  ...results.map(row=>[
    row.id,row.ticket,row.metric,row.unit,row.expected,row.observed,row.varianceCentavos,
    row.engineeringStatus,row.humanReviewStatus,row.source,
  ].map(csvCell).join(","))].join("\n")+"\n");
console.log(JSON.stringify({sourceSha:sha,scriptSha256:scriptHash,cases:cases.length,metrics:results.length,
  engineeringMatches:results.length-mismatch.length,engineeringDifferences:mismatch.length,
  independentPractitionerAcceptance:"NOT_RUN",output},null,2));
if(mismatch.length)process.exitCode=1;
