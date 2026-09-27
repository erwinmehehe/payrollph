import { computeAnnualWithholdingTax } from "@/lib/payroll-rules";

export const ANNUALIZATION_RULE_VERSION = "PH-2026.09";
export const THIRTEENTH_MONTH_EXEMPTION_CAP = 90_000;

export type AnnualizationInput = {
  grossCompensation: number;
  thirteenthMonth: number;
  statutoryContributions: number;
  taxWithheld: number;
  mwe: boolean;
  deMinimis?: number;
  otherBenefits90kPool?: number;
  otherNonTaxable?: number;
  mweExemptCompensation?: number;
};
export type AnnualizationResult = {
  grossCompensation: number; thirteenthMonth: number; exemptThirteenthMonth: number; taxableThirteenthMonth: number;
  deMinimis: number; otherBenefits90kPool: number; exemptOtherBenefits90k: number; taxableOtherBenefits90k: number;
  otherNonTaxable: number; mweExemptCompensation: number; nonTaxable: number; statutoryContributions: number;
  taxableIncome: number; taxDue: number; taxWithheld: number; adjustment: number;
  outcome: "refund" | "collect" | "balanced"; mwe: boolean; ruleVersion: string;
};
const round2=(v:number)=>Math.round((v+Number.EPSILON)*100)/100;

export function annualize(input: AnnualizationInput): AnnualizationResult {
  const grossCompensation=round2(Math.max(0,input.grossCompensation));
  const thirteenthMonth=round2(Math.max(0,input.thirteenthMonth));
  const deMinimis=round2(Math.max(0,input.deMinimis??0));
  const otherBenefits90kPool=round2(Math.max(0,input.otherBenefits90kPool??0));
  const otherNonTaxable=round2(Math.max(0,input.otherNonTaxable??0));
  const mweExemptCompensation=input.mwe?round2(Math.max(0,input.mweExemptCompensation??0)):0;
  const statutoryContributions=round2(Math.max(0,input.statutoryContributions));
  const taxWithheld=round2(Math.max(0,input.taxWithheld));
  const exemptThirteenthMonth=round2(Math.min(thirteenthMonth,THIRTEENTH_MONTH_EXEMPTION_CAP));
  const taxableThirteenthMonth=round2(Math.max(0,thirteenthMonth-THIRTEENTH_MONTH_EXEMPTION_CAP));
  const remaining=Math.max(0,THIRTEENTH_MONTH_EXEMPTION_CAP-exemptThirteenthMonth);
  const exemptOtherBenefits90k=round2(Math.min(otherBenefits90kPool,remaining));
  const taxableOtherBenefits90k=round2(Math.max(0,otherBenefits90kPool-exemptOtherBenefits90k));
  const nonTaxable=round2(exemptThirteenthMonth+exemptOtherBenefits90k+deMinimis+otherNonTaxable+statutoryContributions+mweExemptCompensation);
  const taxableIncome=round2(Math.max(0,grossCompensation-nonTaxable));
  const taxDue=round2(computeAnnualWithholdingTax(taxableIncome,false));
  const adjustment=round2(taxDue-taxWithheld);
  return { grossCompensation,thirteenthMonth,exemptThirteenthMonth,taxableThirteenthMonth,deMinimis,otherBenefits90kPool,exemptOtherBenefits90k,taxableOtherBenefits90k,otherNonTaxable,mweExemptCompensation,nonTaxable,statutoryContributions,taxableIncome,taxDue,taxWithheld,adjustment,outcome:adjustment<0?"refund":adjustment>0?"collect":"balanced",mwe:input.mwe,ruleVersion:ANNUALIZATION_RULE_VERSION };
}

export function renderForm2316(input:{taxYear:number;employerName:string;employerTin?:string;employeeName:string;employeeNo:string;employeeTin?:string;result:AnnualizationResult}) {
  const money=(v:number)=>v.toLocaleString("en-PH",{minimumFractionDigits:2,maximumFractionDigits:2}); const r=input.result;
  const line=(l:string,v:string)=>`${l.padEnd(56,".")} ${v.padStart(16)}`;
  return [
    "BIR FORM NO. 2316 (DRAFT - NOT A CERTIFIED SUBMISSION)","Certificate of Compensation Payment / Tax Withheld",`For the Year Ended December 31, ${input.taxYear}`,"",
    `Employer .......... ${input.employerName}`,`Employer TIN ...... ${input.employerTin??"(not on file)"}`,`Employee .......... ${input.employeeName} (${input.employeeNo})`,`Employee TIN ...... ${input.employeeTin??"(not on file)"}`,`MWE status ........ ${r.mwe?"Minimum Wage Earner - component exemptions applied":"Not an MWE"}`,"",
    "PART IV-A  SUMMARY",line("Gross compensation income",money(r.grossCompensation)),line("13th month pay and other benefits",money(r.thirteenthMonth)),line("  Exempt 13th-month portion",money(r.exemptThirteenthMonth)),line("  Taxable 13th-month excess",money(r.taxableThirteenthMonth)),line("De minimis within ceilings",money(r.deMinimis)),line("Other benefits sharing 90,000 pool",money(r.otherBenefits90kPool)),line("  Exempt other-benefits portion",money(r.exemptOtherBenefits90k)),line("  Taxable other-benefits excess",money(r.taxableOtherBenefits90k)),line("SSS / PhilHealth / Pag-IBIG employee share",money(r.statutoryContributions)),line("Total non-taxable / exempt",money(r.nonTaxable)),"",line("NET TAXABLE COMPENSATION INCOME",money(r.taxableIncome)),line("Tax due",money(r.taxDue)),line("Tax withheld",money(r.taxWithheld)),line(r.outcome==="refund"?"REFUND TO EMPLOYEE":r.outcome==="collect"?"COLLECT FROM EMPLOYEE":"BALANCED",money(Math.abs(r.adjustment))),"",`Rule version: ${r.ruleVersion}`,"Draft only. Validate against current BIR filing/validation tools before submission."
  ].join("\n");
}
