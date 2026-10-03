import { round2 } from "@/lib/round";

export const PH_COMPLIANCE_RULE_VERSION = "PH-2026.02";
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

/**
 * Government remittance deadlines are intentionally NOT reduced to one date.
 * SSS, PhilHealth, Pag-IBIG and BIR follow different filing/payment calendars,
 * and some deadlines depend on employer/account identifiers or filing channel.
 * Operational reminders must be produced by an agency-specific rule or entered
 * from the employer's verified filing calendar.
 */
/**
 * Payroll intervals must be no more than 16 calendar days (Labor Code rule).
 * Inclusive dates: Mar 1–15 is a 15-day interval.
 */
export function isValidPayInterval(startDate: string, endDate: string, maxDays = 16) {
  const start = new Date(`${startDate}T00:00:00Z`).getTime();
  const end = new Date(`${endDate}T00:00:00Z`).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return false;
  const inclusiveDays = Math.floor((end - start) / 86_400_000) + 1;
  return inclusiveDays <= maxDays;
}
