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
  otNightMealAllowance: {
    ceilingRate: 0.30,
    period: "eligible_day",
    label: "Daily meal allowance for overtime / night or graveyard shift",
    ceilingBasis: "applicable regional basic minimum wage",
  },
} as const;

export type DeMinimisType = keyof typeof DE_MINIMIS_2026;
export const OT_NIGHT_MEAL_TYPE = "otNightMealAllowance" as const;

type FixedDeMinimisRule = {
  ceiling: number;
  period: "month" | "semester" | "year";
  label: string;
};

function isFixedDeMinimisRule(rule: (typeof DE_MINIMIS_2026)[DeMinimisType]): rule is FixedDeMinimisRule {
  return "ceiling" in rule;
}

export const DE_MINIMIS_RULE_PACKS = [
  {
    version: "BIR-RR29-2025",
    effectiveFrom: "2026-01-06",
    effectiveUntil: "2026-12-31",
    rules: DE_MINIMIS_2026,
  },
] as const;

export function deMinimisRulesForDate(asOf: string) {
  const packs = DE_MINIMIS_RULE_PACKS.filter((pack) =>
    pack.effectiveFrom <= asOf && asOf <= pack.effectiveUntil
  );
  if (packs.length !== 1) {
    throw new Error(
      `No certified BIR de minimis rule pack covers ${asOf}. Add the applicable BIR rule version before calculating de minimis benefits for this date.`,
    );
  }
  return packs[0];
}

export type DeMinimisGrantInput = {
  id: number;
  benefitType: DeMinimisType;
  amount: number;
  frequency: "month" | "semester" | "year" | "eligible_day";
  basisDailyMinimumWage?: number | null;
  basisWageOrder?: string | null;
};

/**
 * Returns the first date of the statutory ceiling period that contains payDate.
 * Monthly benefits reset each month, semester benefits reset Jan/Jul, while
 * annual categories reset every January.
 */
export function deMinimisStatutoryPeriodStart(type: DeMinimisType, payDate: string) {
  const rule = deMinimisRulesForDate(payDate).rules[type];
  if (!isFixedDeMinimisRule(rule)) return payDate;
  const year = Number(payDate.slice(0, 4));
  const month = Number(payDate.slice(5, 7));
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    throw new Error("payDate must be YYYY-MM-DD.");
  }
  if (rule.period === "month") {
    return `${year}-${String(month).padStart(2, "0")}-01`;
  }
  if (rule.period === "semester") {
    return `${year}-${month <= 6 ? "01" : "07"}-01`;
  }
  return `${year}-01-01`;
}

/**
 * Aggregates every active grant in the same statutory category, then applies
 * only the ceiling still available in the CURRENT statutory period.
 *
 * priorPaidInStatutoryPeriod must come from already released payrolls in the
 * same month / semester / year as applicable. This avoids both duplicate-grant
 * exemptions and the former error of projecting a newly changed grant amount
 * across the entire year.
 */
export function aggregateDeMinimisForSemiMonthly(
  grants: DeMinimisGrantInput[],
  priorPaidInStatutoryPeriod: Partial<Record<DeMinimisType, number>> = {},
  asOf = "2026-10-08",
  context: { mealEligibleDays?: number } = {},
) {
  const rules = deMinimisRulesForDate(asOf);
  const byType = new Map<DeMinimisType, DeMinimisGrantInput[]>();
  for (const grant of grants) {
    byType.set(grant.benefitType, [...(byType.get(grant.benefitType) ?? []), grant]);
  }

  return [...byType.entries()].map(([benefitType, rows]) => {
    const rule = rules.rules[benefitType];

    if (!isFixedDeMinimisRule(rule)) {
      const eligibleDays = Math.max(0, Math.floor(Number(context.mealEligibleDays ?? 0)));
      const wageBases = rows.map((row) => round2(Number(row.basisDailyMinimumWage ?? 0)));
      if (wageBases.some((value) => value <= 0)) {
        throw new Error("OT/night meal allowance requires a verified applicable daily minimum-wage basis.");
      }
      const distinctWageBases = [...new Set(wageBases.map((value) => value.toFixed(2)))];
      if (distinctWageBases.length !== 1) {
        throw new Error("OT/night meal allowance grants use conflicting daily minimum-wage bases.");
      }

      const dailyGranted = round2(rows.reduce((sum, row) => sum + Math.max(0, Number(row.amount) || 0), 0));
      const treatment = deMinimisMealTreatment({
        amountPerEligibleDay: dailyGranted,
        eligibleDays,
        dailyMinimumWage: wageBases[0],
        asOf,
      });
      return {
        benefitType,
        label: rule.label,
        statutoryPeriod: rule.period,
        grantIds: rows.map((row) => row.id),
        semiMonthlyGranted: treatment.granted,
        semiMonthlyExempt: treatment.exempt,
        semiMonthlyOtherBenefitsPool: treatment.excess,
        priorPaidInStatutoryPeriod: 0,
        statutoryPeriodCeiling: treatment.ceiling,
        remainingCeilingBeforeCutoff: treatment.ceiling,
        eligibleDays,
        dailyCeiling: treatment.dailyCeiling,
        dailyMinimumWage: treatment.dailyMinimumWage,
        basisWageOrder: rows[0]?.basisWageOrder ?? null,
      };
    }

    const semiMonthlyGranted = round2(rows.reduce(
      (sum, row) => sum + deMinimisPerSemiMonthlyPeriod(row.amount, row.frequency),
      0,
    ));
    const priorPaid = round2(Math.max(0, Number(priorPaidInStatutoryPeriod[benefitType] ?? 0)));
    const ceilingConsumed = Math.min(priorPaid, rule.ceiling);
    const remainingCeiling = round2(Math.max(0, rule.ceiling - ceilingConsumed));
    const semiMonthlyExempt = round2(Math.min(semiMonthlyGranted, remainingCeiling));
    const semiMonthlyOtherBenefitsPool = round2(
      Math.max(0, semiMonthlyGranted - semiMonthlyExempt),
    );

    return {
      benefitType,
      label: rule.label,
      statutoryPeriod: rule.period,
      grantIds: rows.map((row) => row.id),
      semiMonthlyGranted,
      semiMonthlyExempt,
      semiMonthlyOtherBenefitsPool,
      priorPaidInStatutoryPeriod: priorPaid,
      statutoryPeriodCeiling: rule.ceiling,
      remainingCeilingBeforeCutoff: remainingCeiling,
    };
  });
}

export function deMinimisTreatment(type: DeMinimisType, granted: number, asOf = "2026-10-08") {
  const pack = deMinimisRulesForDate(asOf);
  const rule = pack.rules[type];
  if (!isFixedDeMinimisRule(rule)) {
    throw new Error("OT/night meal allowance requires eligible-day and minimum-wage context.");
  }
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
    ruleVersion: pack.version,
  };
}


export function deMinimisMealTreatment(input: {
  amountPerEligibleDay: number;
  eligibleDays: number;
  dailyMinimumWage: number;
  asOf?: string;
}) {
  const asOf = input.asOf ?? "2026-10-08";
  const pack = deMinimisRulesForDate(asOf);
  const rule = pack.rules[OT_NIGHT_MEAL_TYPE];
  const eligibleDays = Math.max(0, Math.floor(Number(input.eligibleDays) || 0));
  const dailyMinimumWage = round2(Math.max(0, Number(input.dailyMinimumWage) || 0));
  if (dailyMinimumWage <= 0) {
    throw new Error("OT/night meal allowance requires a positive applicable daily minimum-wage basis.");
  }
  const amountPerEligibleDay = round2(Math.max(0, Number(input.amountPerEligibleDay) || 0));
  const dailyCeiling = round2(dailyMinimumWage * rule.ceilingRate);
  const granted = round2(amountPerEligibleDay * eligibleDays);
  const ceiling = round2(dailyCeiling * eligibleDays);
  const exempt = round2(Math.min(granted, ceiling));
  const excess = round2(Math.max(0, granted - exempt));
  return {
    type: OT_NIGHT_MEAL_TYPE,
    label: rule.label,
    period: rule.period,
    amountPerEligibleDay,
    eligibleDays,
    dailyMinimumWage,
    dailyCeiling,
    granted,
    exempt,
    excess,
    ceiling,
    treatment: excess > 0 ? "excess_to_other_benefits_90k_pool" : "fully_de_minimis_exempt",
    ruleVersion: pack.version,
  };
}

/** PD 851: total basic salary earned within the calendar year divided by 12. */
/**
 * Cash amount paid in one semi-monthly payroll for a recurring de minimis
 * grant. The annual/semester categories are spread evenly so their stated
 * ceiling is never accidentally paid twice in a short month.
 */
export function deMinimisPerSemiMonthlyPeriod(
  amount: number,
  frequency: "month" | "semester" | "year" | "eligible_day",
) {
  const value = Math.max(0, Number(amount) || 0);
  if (frequency === "eligible_day") {
    throw new Error("Eligible-day de minimis benefits require attendance context.");
  }
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
