export type HolidayType = "ordinary" | "regular" | "special" | "double";

/**
 * SSS Circular 2024-006 schedule effective January 2025 and unchanged in 2026.
 * 15% regular contribution: 5% employee, 10% employer on MSC PHP 5,000–35,000.
 * EC is employer-only: PHP 10 under MSC 15,000; PHP 30 at/above 15,000.
 */
export function computeSss(monthlySalary: number) {
  const msc = Math.min(35_000, Math.max(5_000, Math.round(monthlySalary / 500) * 500));
  const employee = round(msc * 0.05);
  const employer = round(msc * 0.1);
  const employerEC = msc < 15_000 ? 10 : 30;
  return {
    monthlySalaryCredit: msc,
    employee,
    employer,
    employerEC,
    total: round(employee + employer + employerEC),
    employerTotal: round(employer + employerEC),
  };
}

export function computePhilHealth(monthlySalary: number) {
  const base = Math.min(100_000, Math.max(10_000, monthlySalary));
  const total = round(base * 0.05);
  return { base, employee: round(total / 2), employer: round(total / 2) };
}

/**
 * HDMF / Pag-IBIG mandatory contribution (2026): fund salary is capped at
 * PHP 10,000. Employee pays 1% up to PHP 1,500 then 2%; employer is always
 * 2%. Practical ceiling: PHP 200 employee + PHP 200 employer monthly.
 */
export function computePagIbig(monthlySalary: number) {
  const fundSalary = Math.min(10_000, Math.max(0, monthlySalary));
  const employeeRate = monthlySalary <= 1_500 ? 0.01 : 0.02;
  const employee = round(fundSalary * employeeRate);
  const employer = round(fundSalary * 0.02);
  return { fundSalary, employeeRate, employerRate: 0.02, employee, employer, total: round(employee + employer) };
}

/** TRAIN annual brackets effective 2023 onward (still applicable in 2026). */
export function computeAnnualWithholdingTax(taxableAnnualIncome: number, isMwe = false) {
  if (isMwe || taxableAnnualIncome <= 250_000) return 0;
  const brackets = [
    [400_000, 250_000, 0.15, 0],
    [800_000, 400_000, 0.2, 22_500],
    [2_000_000, 800_000, 0.25, 102_500],
    [8_000_000, 2_000_000, 0.3, 402_500],
    [Infinity, 8_000_000, 0.35, 2_202_500],
  ] as const;
  const bracket = brackets.find(([limit]) => taxableAnnualIncome <= limit) ?? brackets[brackets.length - 1];
  return round(bracket[3] + (taxableAnnualIncome - bracket[1]) * bracket[2]);
}

/**
 * BIR Revised Withholding Tax Table, Monthly (RR 11-2018, 2023 onward).
 * Input is monthly taxable compensation AFTER employee statutory deductions and
 * non-taxable items, not gross basic salary.
 */
export function computeMonthlyWithholdingTax(monthlyTaxableIncome: number, isMwe = false) {
  const income = Math.max(0, Number(monthlyTaxableIncome) || 0);
  if (isMwe || income <= 20_833) return 0;
  if (income <= 33_333) return round((income - 20_833) * 0.15);
  if (income <= 66_667) return round(1_875 + (income - 33_333) * 0.2);
  if (income <= 166_667) return round(8_541.8 + (income - 66_667) * 0.25);
  if (income <= 666_667) return round(33_541.8 + (income - 166_667) * 0.3);
  return round(183_541.8 + (income - 666_667) * 0.35);
}

/**
 * BIR Revised Withholding Tax Table, Semi-monthly. Equivalent to calculating
 * monthly taxable compensation from the two cutoffs and dividing its monthly
 * withholding in half. This keeps the exact 20,833 / 33,333 table constants
 * visible rather than hiding them in a generic annual approximation.
 */
export function computeSemiMonthlyWithholdingTax(semiMonthlyTaxableIncome: number, isMwe = false) {
  const period = Math.max(0, Number(semiMonthlyTaxableIncome) || 0);
  return round(computeMonthlyWithholdingTax(period * 2, isMwe) / 2);
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

export type ClockPunch = { timeIn?: string | null; timeOut?: string | null };
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
  const breakMinutes = shift.breakMinutes ?? 60;
  const grossWorked = Math.round((actualOut.getTime() - actualIn.getTime()) / 60_000);
  const tardinessMinutes = Math.max(0, Math.round((actualIn.getTime() - (shiftStart.getTime() + grace * 60_000)) / 60_000));
  const undertimeMinutes = Math.max(0, Math.round((shiftEnd.getTime() - actualOut.getTime()) / 60_000));
  const overtimeMinutes = Math.max(0, Math.round((actualOut.getTime() - shiftEnd.getTime()) / 60_000));
  const regularRangeEnd = new Date(Math.min(actualOut.getTime(), shiftEnd.getTime()));
  const overtimeRangeStart = new Date(Math.max(actualIn.getTime(), shiftEnd.getTime()));
  const nightRegularMinutes = nightMinutesBetween(actualIn, regularRangeEnd);
  const nightOvertimeMinutes = nightMinutesBetween(overtimeRangeStart, actualOut);
  return {
    workedMinutes: Math.max(0, grossWorked - breakMinutes),
    tardinessMinutes,
    undertimeMinutes,
    overtimeMinutes,
    nightDifferentialMinutes: nightRegularMinutes + nightOvertimeMinutes,
    nightRegularMinutes,
    nightOvertimeMinutes,
    flags: [] as string[],
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
