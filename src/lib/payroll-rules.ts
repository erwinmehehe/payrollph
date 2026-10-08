import {
  BIR_WITHHOLDING_RULE_PACKS,
  PAGIBIG_RULE_PACKS,
  PHILHEALTH_RULE_PACKS,
  SSS_RULE_PACKS,
  resolveEffectiveRulePack,
} from "@/lib/ph-statutory-rule-packs";

export type HolidayType = "ordinary" | "regular" | "special" | "double";

/**
 * SSS Circular 2024-006 schedule effective January 2025 and unchanged in 2026.
 * 15% regular contribution: 5% employee, 10% employer on MSC PHP 5,000–35,000.
 * EC is employer-only: PHP 10 under MSC 15,000; PHP 30 at/above 15,000.
 */
export function computeSss(monthlySalary: number, asOf = "2026-10-08") {
  const rule = resolveEffectiveRulePack(SSS_RULE_PACKS, asOf, "SSS");
  const { mscFloor, mscCeiling, mscStep, regularMscCeiling, employeeRate, employerRate, ecThreshold, ecBelow, ecAtOrAbove } = rule.params;
  const msc = Math.min(mscCeiling, Math.max(mscFloor, Math.round(monthlySalary / mscStep) * mscStep));
  const regularMsc = Math.min(regularMscCeiling, msc);
  const mpfMsc = Math.max(0, msc - regularMsc);
  const employeeRegular = round(regularMsc * employeeRate);
  const employeeMpf = round(mpfMsc * employeeRate);
  const employerRegular = round(regularMsc * employerRate);
  const employerMpf = round(mpfMsc * employerRate);
  const employee = round(employeeRegular + employeeMpf);
  const employer = round(employerRegular + employerMpf);
  const employerEC = msc < ecThreshold ? ecBelow : ecAtOrAbove;
  return {
    monthlySalaryCredit: msc,
    regularMsc,
    mpfMsc,
    employeeRegular,
    employeeMpf,
    employerRegular,
    employerMpf,
    employee,
    employer,
    employerEC,
    total: round(employee + employer + employerEC),
    employerTotal: round(employer + employerEC),
  };
}

export function computePhilHealth(monthlySalary: number, asOf = "2026-10-08") {
  const rule = resolveEffectiveRulePack(PHILHEALTH_RULE_PACKS, asOf, "PhilHealth");
  const { salaryFloor, salaryCeiling, premiumRate, employeeShare } = rule.params;
  const base = Math.min(salaryCeiling, Math.max(salaryFloor, monthlySalary));
  const total = round(base * premiumRate);
  // Split the already-rounded statutory premium in centavos. When the total
  // has an odd centavo, keep the employee share at the lower centavo and put
  // the unavoidable one-centavo remainder on the employer share.
  const totalCentavos = Math.round(total * 100);
  const employee = Math.floor(totalCentavos * employeeShare) / 100;
  const employer = round(total - employee);
  return { base, total, employee, employer };
}

/**
 * HDMF / Pag-IBIG mandatory contribution (2026): fund salary is capped at
 * PHP 10,000. Employee pays 1% up to PHP 1,500 then 2%; employer is always
 * 2%. Practical ceiling: PHP 200 employee + PHP 200 employer monthly.
 */
export type StatutoryDeductionTiming = "split" | "first_cutoff" | "second_cutoff";

export function computeCutoffStatutoryDeduction(input: {
  monthlyTarget: number;
  priorCollected: number;
  timing: StatutoryDeductionTiming;
  isSecondCutoff: boolean;
}) {
  const target = round(Math.max(0, input.monthlyTarget));
  const prior = round(Math.max(0, input.priorCollected));

  if (input.timing === "second_cutoff") {
    return input.isSecondCutoff ? round(Math.max(0, target - prior)) : 0;
  }
  if (input.timing === "first_cutoff") {
    // First cutoff collects the current target; second cutoff performs only a
    // true-up when later variable remuneration increases that monthly target.
    return input.isSecondCutoff ? round(Math.max(0, target - prior)) : target;
  }
  return input.isSecondCutoff
    ? round(Math.max(0, target - prior))
    : round(target / 2);
}

export function computePagIbig(monthlySalary: number, asOf = "2026-10-08") {
  const rule = resolveEffectiveRulePack(PAGIBIG_RULE_PACKS, asOf, "Pag-IBIG");
  const { fundSalaryCeiling, lowRateThreshold, employeeLowRate, employeeStandardRate, employerRate } = rule.params;
  const fundSalary = Math.min(fundSalaryCeiling, Math.max(0, monthlySalary));
  const employeeRate = monthlySalary <= lowRateThreshold ? employeeLowRate : employeeStandardRate;
  const employee = round(fundSalary * employeeRate);
  const employer = round(fundSalary * employerRate);
  return { fundSalary, employeeRate, employerRate, employee, employer, total: round(employee + employer) };
}

/** TRAIN annual brackets effective 2023 onward (still applicable in 2026). */
export function computeAnnualWithholdingTax(taxableAnnualIncome: number, isMwe = false, asOf = "2026-10-08") {
  if (isMwe) return 0;
  const rule = resolveEffectiveRulePack(BIR_WITHHOLDING_RULE_PACKS, asOf, "BIR withholding");
  const bracket = rule.params.annual.find((row) => taxableAnnualIncome <= row.limit)
    ?? rule.params.annual[rule.params.annual.length - 1];
  return round(bracket.base + Math.max(0, taxableAnnualIncome - bracket.floor) * bracket.rate);
}

/**
 * BIR Revised Withholding Tax Table, Monthly (RR 11-2018, 2023 onward).
 * Input is monthly taxable compensation AFTER employee statutory deductions and
 * non-taxable items, not gross basic salary.
 */
export function computeMonthlyWithholdingTax(monthlyTaxableIncome: number, isMwe = false, asOf = "2026-10-08") {
  const income = Math.max(0, Number(monthlyTaxableIncome) || 0);
  if (isMwe) return 0;
  const rule = resolveEffectiveRulePack(BIR_WITHHOLDING_RULE_PACKS, asOf, "BIR withholding");
  const bracket = rule.params.monthly.find((row) => income <= row.limit)
    ?? rule.params.monthly[rule.params.monthly.length - 1];
  return round(bracket.base + Math.max(0, income - bracket.floor) * bracket.rate);
}

/**
 * BIR Revised Withholding Tax Table, Semi-monthly (RR 11-2018, 2023 onward).
 * This is the published semi-monthly table, not a monthly-table approximation.
 */
export function computeSemiMonthlyWithholdingTax(semiMonthlyTaxableIncome: number, isMwe = false, asOf = "2026-10-08") {
  const income = Math.max(0, Number(semiMonthlyTaxableIncome) || 0);
  if (isMwe) return 0;
  const rule = resolveEffectiveRulePack(BIR_WITHHOLDING_RULE_PACKS, asOf, "BIR withholding");
  const bracket = rule.params.semiMonthly.find((row) => income <= row.limit)
    ?? rule.params.semiMonthly[rule.params.semiMonthly.length - 1];
  return round(bracket.base + Math.max(0, income - bracket.floor) * bracket.rate);
}

export function holidayMultiplier(input: { holiday: HolidayType; worked: boolean; restDay?: boolean; overtime?: boolean }) {
  if (!input.worked) {
    if (input.holiday === "double") return 2;
    return input.holiday === "regular" ? 1 : 0;
  }

  const premiumDay = input.holiday !== "ordinary" || Boolean(input.restDay);
  let multiplier =
    input.holiday === "double"
      ? 3
      : input.holiday === "regular"
        ? 2
        : input.holiday === "special"
          ? 1.3
          : 1;

  if (input.restDay) {
    multiplier =
      input.holiday === "double"
        ? 3.9
        : input.holiday === "regular"
          ? 2.6
          : input.holiday === "special"
            ? 1.5
            : 1.3;
  }

  return round(multiplier * (input.overtime ? (premiumDay ? 1.3 : 1.25) : 1));
}

export const REST_DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
export type RestDayName = (typeof REST_DAY_NAMES)[number];

const REST_DAY_INDEX: Record<string, number> = Object.fromEntries(
  REST_DAY_NAMES.map((name, index) => [name, index]),
);

/** Pure day-of-week check, independent of the host process timezone. */
export function isRestDayOfWeek(workDate: string, restDay: string | null | undefined): boolean {
  if (!restDay) return false;
  const index = REST_DAY_INDEX[restDay];
  if (index === undefined) return false;
  const [year, month, day] = workDate.split("-").map(Number);
  if (!year || !month || !day) return false;
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay() === index;
}

export type EffectiveRestDayRevisionInput = {
  effectiveDate: string;
  previousRestDay: string | null;
  newRestDay: string | null;
};

function normalizedRestDay(value: string | null | undefined): RestDayName | null {
  return value && REST_DAY_INDEX[value] !== undefined ? value as RestDayName : null;
}

/**
 * Resolves the weekly rest day that was in force on a historical work date.
 * The employee row stores today's value; the first later revision preserves
 * the previous value so recalculating an older period never rewrites history.
 */
export function restDayForDate(
  currentRestDay: string | null | undefined,
  revisions: EffectiveRestDayRevisionInput[],
  workDate: string,
): RestDayName | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(workDate)) return normalizedRestDay(currentRestDay);
  const ordered = [...revisions]
    .filter((revision) => /^\d{4}-\d{2}-\d{2}$/.test(revision.effectiveDate))
    .sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate));

  const applied = ordered.filter((revision) => revision.effectiveDate <= workDate);
  if (applied.length > 0) return normalizedRestDay(applied[applied.length - 1].newRestDay);

  const firstLater = ordered.find((revision) => revision.effectiveDate > workDate);
  if (firstLater) return normalizedRestDay(firstLater.previousRestDay);

  return normalizedRestDay(currentRestDay);
}

export type ClockPunch = {
  timeIn?: string | null;
  timeOut?: string | null;
  breakStart?: string | null;
  breakEnd?: string | null;
};
export type ShiftSchedule = { start: string; end: string; breakMinutes?: number; graceMinutes?: number };

function asLocalDate(value: string) {
  const [datePart, timePart] = value.split("T");
  const [year, month, day] = datePart.split("-").map(Number);
  const [hours, minutes] = timePart.slice(0, 5).split(":").map(Number);
  return new Date(year, month - 1, day, hours, minutes, 0, 0);
}

function shiftBoundary(base: Date, time: string, nextDay = false) {
  const [hours, minutes] = time.split(":").map(Number);
  const point = new Date(base.getFullYear(), base.getMonth(), base.getDate(), hours, minutes, 0, 0);
  if (nextDay) point.setDate(point.getDate() + 1);
  return point;
}

function overlapMinutes(
  rangeStart: Date,
  rangeEnd: Date,
  overlapStart: Date,
  overlapEnd: Date,
) {
  const start = Math.max(rangeStart.getTime(), overlapStart.getTime());
  const end = Math.min(rangeEnd.getTime(), overlapEnd.getTime());
  return end > start ? Math.round((end - start) / 60_000) : 0;
}

function nightMinutesBetween(start: Date, end: Date) {
  if (end <= start) return 0;
  let total = 0;
  const cursor = new Date(start.getFullYear(), start.getMonth(), start.getDate() - 1, 22, 0);
  while (cursor < end) {
    const nightStart = new Date(cursor);
    const nightEnd = new Date(cursor);
    nightEnd.setHours(30, 0, 0, 0);
    const overlapStart = Math.max(start.getTime(), nightStart.getTime());
    const overlapEnd = Math.min(end.getTime(), nightEnd.getTime());
    if (overlapEnd > overlapStart) total += (overlapEnd - overlapStart) / 60_000;
    cursor.setDate(cursor.getDate() + 1);
  }
  return Math.round(total);
}

const EMPTY_CLOCK_RESULT = {
  workedMinutes: 0,
  tardinessMinutes: 0,
  undertimeMinutes: 0,
  overtimeMinutes: 0,
  nightDifferentialMinutes: 0,
  nightRegularMinutes: 0,
  nightOvertimeMinutes: 0,
  flags: [] as string[],
};

export function deriveClockHours(punch: ClockPunch, shift: ShiftSchedule) {
  if (!punch.timeIn || !punch.timeOut) {
    return { ...EMPTY_CLOCK_RESULT, flags: ["Incomplete punch pair, reviewer sign-off required"] };
  }
  const actualIn = asLocalDate(punch.timeIn);
  const actualOut = asLocalDate(punch.timeOut);
  if (actualOut <= actualIn) {
    return { ...EMPTY_CLOCK_RESULT, flags: ["Invalid punch sequence, reviewer sign-off required"] };
  }
  const shiftStart = shiftBoundary(actualIn, shift.start);
  const spansOvernight = shift.end <= shift.start;
  const shiftEnd = shiftBoundary(actualIn, shift.end, spansOvernight);
  const grace = shift.graceMinutes ?? 5;
  const scheduledBreakMinutes = Math.max(0, shift.breakMinutes ?? 60);
  const grossWorked = Math.round((actualOut.getTime() - actualIn.getTime()) / 60_000);
  const tardinessMinutes = Math.max(0, Math.round((actualIn.getTime() - (shiftStart.getTime() + grace * 60_000)) / 60_000));
  const undertimeMinutes = Math.max(0, Math.round((shiftEnd.getTime() - actualOut.getTime()) / 60_000));
  const overtimeMinutes = Math.max(0, Math.round((actualOut.getTime() - shiftEnd.getTime()) / 60_000));
  const regularRangeEnd = new Date(Math.min(actualOut.getTime(), shiftEnd.getTime()));
  const overtimeRangeStart = new Date(Math.max(actualIn.getTime(), shiftEnd.getTime()));

  const rawNightRegularMinutes = nightMinutesBetween(actualIn, regularRangeEnd);
  const rawNightOvertimeMinutes = nightMinutesBetween(overtimeRangeStart, actualOut);

  let actualBreakMinutes = scheduledBreakMinutes;
  let nightBreakRegular = 0;
  let nightBreakOvertime = 0;
  const flags: string[] = [];

  if (punch.breakStart && punch.breakEnd) {
    const breakStart = asLocalDate(punch.breakStart);
    const breakEnd = asLocalDate(punch.breakEnd);
    if (
      breakEnd <= breakStart
      || breakStart < actualIn
      || breakEnd > actualOut
    ) {
      flags.push("Invalid break punch pair, reviewer sign-off required");
    } else {
      actualBreakMinutes = overlapMinutes(actualIn, actualOut, breakStart, breakEnd);
      const breakNightMinutes = nightMinutesBetween(breakStart, breakEnd);
      nightBreakRegular = Math.min(
        breakNightMinutes,
        overlapMinutes(actualIn, regularRangeEnd, breakStart, breakEnd),
      );
      nightBreakOvertime = Math.max(
        0,
        breakNightMinutes - nightBreakRegular,
      );
    }
  } else if (punch.breakStart || punch.breakEnd) {
    flags.push("Incomplete break punch pair, reviewer sign-off required");
  } else if ((rawNightRegularMinutes + rawNightOvertimeMinutes) > 0 && scheduledBreakMinutes > 0) {
    flags.push(
      "Night differential overlaps an unlocated meal break; record break start/end before release",
    );
  }

  const nightRegularMinutes = Math.max(0, rawNightRegularMinutes - nightBreakRegular);
  const nightOvertimeMinutes = Math.max(0, rawNightOvertimeMinutes - nightBreakOvertime);
  return {
    workedMinutes: Math.max(0, grossWorked - actualBreakMinutes),
    tardinessMinutes,
    undertimeMinutes,
    overtimeMinutes,
    nightDifferentialMinutes: nightRegularMinutes + nightOvertimeMinutes,
    nightRegularMinutes,
    nightOvertimeMinutes,
    flags,
  };
}

export function compareFreelancerTax(annualGross: number, annualExpenses: number) {
  const flatEightPercent = round(Math.max(0, annualGross - 250_000) * 0.08);
  const graduated = computeAnnualWithholdingTax(Math.max(0, annualGross - annualExpenses));
  return { flatEightPercent, graduated, recommended: flatEightPercent <= graduated ? "8% flat" : "Graduated" };
}

function round(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
