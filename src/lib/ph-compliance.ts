import { round2 } from "@/lib/round";

export const PH_COMPLIANCE_RULE_VERSION = "PH-2026.02";
export const STATUTORY_REMITTANCE_DUE_DAY = 10;
export const THIRTEENTH_MONTH_DUE_MONTH = 12;
export const THIRTEENTH_MONTH_DUE_DAY = 24;

/** BIR RR No. 29-2025, effective 6 January 2026. */
export const DE_MINIMIS_2026 = {
  monetizedVacationLeaveDays: { ceiling: 12, period: "year", label: "Monetized unused vacation leave (private employee)" },
  medicalCashDependents: { ceiling: 2_000, period: "semester", label: "Medical cash allowance to dependents" },
  riceSubsidy: { ceiling: 2_500, period: "month", label: "Rice subsidy" },
  uniformClothing: { ceiling: 8_000, period: "year", label: "Uniform and clothing allowance" },
  actualMedical: { ceiling: 12_000, period: "year", label: "Actual medical assistance" },
  laundry: { ceiling: 400, period: "month", label: "Laundry allowance" },
  achievementAward: { ceiling: 12_000, period: "year", label: "Employee achievement award" },
  christmasGift: { ceiling: 6_000, period: "year", label: "Christmas / major anniversary gift" },
  cbaProductivity: { ceiling: 12_000, period: "year", label: "CBA / productivity incentive (combined)" },
} as const;

export type DeMinimisType = keyof typeof DE_MINIMIS_2026;

export type StatutoryDeductionMode = "split_evenly" | "second_cutoff";

export function statutoryCutoffFactor(mode: StatutoryDeductionMode, periodEnd: string) {
  const match = /^\d{4}-\d{2}-(\d{2})$/.exec(String(periodEnd));
  if (!match) throw new Error("periodEnd must be an ISO date (YYYY-MM-DD).");
  const day = Number(match[1]);
  return mode === "second_cutoff" ? (day > 15 ? 1 : 0) : 0.5;
}

export function deMinimisTreatment(type: DeMinimisType, granted: number) {
  const rule = DE_MINIMIS_2026[type];
  const amount = Math.max(0, Number(granted) || 0);
  const exempt = round2(Math.min(amount, rule.ceiling));
  const excess = round2(Math.max(0, amount - rule.ceiling));
  return {
    type,
    label: rule.label,
    period: rule.period,
    granted: round2(amount),
    exempt,
    excess,
    ceiling: rule.ceiling,
    /** Excess joins the 13th-month / other-benefits PHP 90k annual stack. */
    treatment: excess > 0 ? "excess_to_other_benefits_90k_pool" : "fully_de_minimis_exempt",
    ruleVersion: PH_COMPLIANCE_RULE_VERSION,
  };
}

/** PD 851: total basic salary earned within the calendar year divided by 12. */
/**
 * Cash amount paid in one semi-monthly payroll for a recurring de minimis
 * grant. The annual/semester categories are spread evenly so their stated
 * ceiling is never accidentally paid twice in a short month.
 */
export function deMinimisPerSemiMonthlyPeriod(amount: number, frequency: "month" | "semester" | "year") {
  const value = Math.max(0, Number(amount) || 0);
  if (frequency === "month") return round2(value / 2);
  if (frequency === "semester") return round2(value / 12);
  return round2(value / 24);
}

export function computeThirteenthMonthPay(totalBasicSalaryEarned: number) {
  return round2(Math.max(0, Number(totalBasicSalaryEarned) || 0) / 12);
}

export function thirteenthMonthDeadline(year: number) {
  return `${year}-${String(THIRTEENTH_MONTH_DUE_MONTH).padStart(2, "0")}-${String(THIRTEENTH_MONTH_DUE_DAY).padStart(2, "0")}`;
}

/** Contributions / 1601-C are due on the 10th of the month after coverage. */
function assertCoverageMonth(coverageMonth: number) {
  if (!Number.isInteger(coverageMonth) || coverageMonth < 1 || coverageMonth > 12) throw new Error("coverageMonth must be 1-12.");
}
function isoUtc(year: number, zeroBasedMonth: number, day: number) { return new Date(Date.UTC(year, zeroBasedMonth, day)).toISOString().slice(0, 10); }
export function bir1601CDueDate(year: number, month: number) { assertCoverageMonth(month); return month === 12 ? `${year + 1}-01-15` : isoUtc(year, month, 10); }
export function sssEmployerDueDate(year: number, month: number) { assertCoverageMonth(month); return isoUtc(year, month + 1, 0); }
export function philHealthEmployerDueWindow(year: number, month: number, penEnding: number) { assertCoverageMonth(month); if (!Number.isInteger(penEnding) || penEnding < 0 || penEnding > 9) throw new Error("penEnding must be 0-9."); const a=penEnding<=4?11:16,b=penEnding<=4?15:20; return { start: isoUtc(year,month,a), end: isoUtc(year,month,b) }; }
export function pagIbigEmployerDueWindow(year: number, month: number, employerName: string) { assertCoverageMonth(month); const f=employerName.trim().charAt(0).toUpperCase(); if(!f) throw new Error("employerName is required."); let a:number,b:number|null; if(f>="A"&&f<="D")[a,b]=[10,14]; else if(f>="E"&&f<="L")[a,b]=[15,19]; else if(f>="M"&&f<="Q")[a,b]=[20,24]; else [a,b]=[25,null]; return { start: isoUtc(year,month,a), end: b==null?isoUtc(year,month+1,0):isoUtc(year,month,b) }; }
export function statutoryDueDate(year: number, month: number) { return bir1601CDueDate(year, month); }
export function isValidPayInterval(startDate: string, endDate: string, maxDays=16) { const start=new Date(`${startDate}T00:00:00Z`).getTime(),end=new Date(`${endDate}T00:00:00Z`).getTime(); if(!Number.isFinite(start)||!Number.isFinite(end)||end<start)return false; return Math.floor((end-start)/86_400_000)+1<=maxDays; }
