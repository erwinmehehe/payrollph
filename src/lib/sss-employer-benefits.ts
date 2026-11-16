/**
 * SSS maternity and sickness benefits the employer advances and later claims back (private sector).
 *
 * Pure computation and deadline library. It never files with SSS, moves money or approves a claim.
 * Everything the primary pages do not settle is surfaced as a SOURCE NOT VERIFIED review flag.
 *
 * Sources read: https://www.sss.gov.ph/maternity-benefit and https://www.sss.gov.ph/sickness-benefit/
 * (official pages; sample computation images were not read) and the RA 11210 IRR on Lawphil.
 */
import { round2 } from "@/lib/round";

export const SSS_BENEFIT_RULE_VERSION = "SSS-BENEFITS-2026-11-16";
/** Regular Program MSC limit for benefit computation (SSS Circular 2020-032 as cited on the benefit pages). */
export const SSS_BENEFIT_MSC_CAP = 20000;
export const SSS_ADSC_DIVISOR = 180;
export const SSS_MIN_CONTRIBUTION_MONTHS = 3;
export const SSS_MATERNITY_DAYS = { LIVE_BIRTH: 105, LIVE_BIRTH_SOLO_PARENT: 120, MISCARRIAGE_OR_ETP: 60 } as const;
export const SSS_SICKNESS_RATE = 0.9;
export const SSS_SICKNESS_MAX_DAYS_PER_YEAR = 120;
export const SSS_SICKNESS_MAX_DAYS_SAME_ILLNESS = 240;
export const SSS_SICKNESS_MIN_CONFINEMENT_DAYS = 4;
export const MATERNITY_ADVANCE_DUE_DAYS = 30;

export type MonthlyContribution = {
  /** Contribution month, YYYY-MM. */
  month: string;
  monthlySalaryCredit: number;
  /** Optional payment date, YYYY-MM-DD. A contribution paid on or after the semester start does not count. */
  paidOn?: string;
};

export type AdscWindow = {
  semesterStart: string;
  semesterEnd: string;
  windowStart: string;
  windowEnd: string;
};

const pad = (n: number) => String(n).padStart(2, "0");
const monthIndex = (ym: string) => {
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(ym);
  if (!m) throw new RangeError(`Invalid month ${ym}; expected YYYY-MM`);
  return Number(m[1]) * 12 + Number(m[2]) - 1;
};
const monthOf = (index: number) => `${Math.floor(index / 12)}-${pad((index % 12) + 1)}`;
const parseDate = (value: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) throw new RangeError(`Invalid date ${value}; expected YYYY-MM-DD`);
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const back = new Date(t);
  if (back.getUTCFullYear() !== Number(m[1]) || back.getUTCMonth() !== Number(m[2]) - 1 || back.getUTCDate() !== Number(m[3])) {
    throw new RangeError(`Invalid calendar date ${value}`);
  }
  return t;
};
const fmt = (t: number) => {
  const d = new Date(t);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
};
export const addCalendarDays = (date: string, days: number) => fmt(parseDate(date) + days * 86_400_000);
export const addYears = (date: string, years: number) => {
  const d = new Date(parseDate(date));
  const y = d.getUTCFullYear() + years;
  const month = d.getUTCMonth();
  const last = new Date(Date.UTC(y, month + 1, 0)).getUTCDate();
  return fmt(Date.UTC(y, month, Math.min(d.getUTCDate(), last)));
};

/**
 * The semester of contingency is the two successive quarters ending in the quarter of the contingency.
 * The twelve-month window ends with the month immediately before that semester.
 */
export function adscWindow(contingencyDate: string): AdscWindow {
  const t = new Date(parseDate(contingencyDate));
  const quarterStartMonth = Math.floor(t.getUTCMonth() / 3) * 3;
  const quarterEnd = t.getUTCFullYear() * 12 + quarterStartMonth + 2;
  const semesterStart = quarterEnd - 5;
  const windowEnd = semesterStart - 1;
  return {
    semesterStart: monthOf(semesterStart), semesterEnd: monthOf(quarterEnd),
    windowStart: monthOf(windowEnd - 11), windowEnd: monthOf(windowEnd),
  };
}

export type AdscResult = {
  window: AdscWindow;
  /** Months counted toward the three-contribution test. */
  contributionMonths: number;
  /** Highest MSCs actually used (up to six), each capped. */
  usedCredits: number[];
  totalMsc: number;
  /** Unrounded average daily salary credit. */
  adsc: number;
  eligible: boolean;
  reviewFlags: string[];
};

export function computeAdsc(contributions: MonthlyContribution[], contingencyDate: string): AdscResult {
  const window = adscWindow(contingencyDate);
  const lo = monthIndex(window.windowStart);
  const hi = monthIndex(window.windowEnd);
  const semesterStartDate = `${window.semesterStart}-01`;
  const seen = new Set<string>();
  const credits: number[] = [];
  for (const row of contributions) {
    const idx = monthIndex(row.month);
    if (!Number.isFinite(row.monthlySalaryCredit) || row.monthlySalaryCredit < 0) throw new RangeError(`Invalid MSC for ${row.month}`);
    if (seen.has(row.month)) throw new RangeError(`Duplicate contribution month ${row.month}`);
    seen.add(row.month);
    if (idx < lo || idx > hi) continue;
    if (row.paidOn && parseDate(row.paidOn) >= parseDate(semesterStartDate)) continue;
    credits.push(Math.min(row.monthlySalaryCredit, SSS_BENEFIT_MSC_CAP));
  }
  credits.sort((a, b) => b - a);
  const used = credits.slice(0, 6);
  const totalMsc = used.reduce((a, b) => a + b, 0);
  const flags: string[] = [];
  if (credits.length > 0 && used.length < 6) flags.push("FEWER_THAN_SIX_CONTRIBUTIONS_IN_WINDOW: formula applied to the credits available");
  flags.push("ROUNDING_CONVENTION_NOT_VERIFIED: amounts here round once to the centavo from the unrounded ADSC");
  return {
    window, contributionMonths: credits.length, usedCredits: used, totalMsc,
    adsc: totalMsc / SSS_ADSC_DIVISOR, eligible: credits.length >= SSS_MIN_CONTRIBUTION_MONTHS, reviewFlags: flags,
  };
}

export type MaternityCase = "LIVE_BIRTH" | "MISCARRIAGE_OR_ETP";

export type MaternityBenefitInput = {
  contributions: MonthlyContribution[];
  contingencyDate: string;
  caseKind: MaternityCase;
  soloParent?: boolean;
  /** Date the employee filed the maternity leave application, YYYY-MM-DD. */
  applicationFiledOn?: string;
  /** Full pay per leave day under the employer's reviewed policy. Required to price the differential. */
  fullPayPerLeaveDay?: number;
  /** Employer holds a current DOLE exemption from the salary differential. */
  differentialExemptByDole?: boolean;
};

export type MaternityBenefitResult = {
  ruleVersion: string;
  eligibleForSssBenefit: boolean;
  days: number;
  adsc: number;
  /** 100% of ADSC for each compensable day, rounded once. Also the reimbursement ceiling. */
  sssBenefit: number;
  /** Amount the employer must advance within thirty days of the application. */
  employerAdvance: number;
  advanceDueBy: string | null;
  /** Full pay less the SSS benefit, or null when it cannot be priced. Not reimbursable by SSS. */
  employerDifferential: number | null;
  prescriptiveDeadline: string;
  adsc_detail: AdscResult;
  reviewFlags: string[];
};

export function computeMaternityBenefit(input: MaternityBenefitInput): MaternityBenefitResult {
  const a = computeAdsc(input.contributions, input.contingencyDate);
  const days =
    input.caseKind === "MISCARRIAGE_OR_ETP"
      ? SSS_MATERNITY_DAYS.MISCARRIAGE_OR_ETP
      : input.soloParent ? SSS_MATERNITY_DAYS.LIVE_BIRTH_SOLO_PARENT : SSS_MATERNITY_DAYS.LIVE_BIRTH;
  const flags = [...a.reviewFlags];
  if (input.caseKind === "MISCARRIAGE_OR_ETP" && input.soloParent) {
    flags.push("SOLO_PARENT_EXTRA_15_DAYS_NOT_APPLIED_TO_MISCARRIAGE_OR_ETP");
  }
  flags.push("EMPLOYER_NOTICE_TO_SSS_DEADLINE_NOT_STATED_BY_SSS_PAGE");
  flags.push("REIMBURSEMENT_FILING_DEADLINE_NOT_STATED_BY_SSS_PAGE");
  flags.push("RECOVERY_FROM_EMPLOYEE_IF_SSS_DENIES_NOT_STATED_DO_NOT_DEDUCT");
  flags.push("TAX_TREATMENT_NOT_VERIFIED");
  const sssBenefit = a.eligible ? round2((a.totalMsc * days) / SSS_ADSC_DIVISOR) : 0;
  if (!a.eligible) flags.push("EMPLOYER_LIABILITY_WHEN_SSS_INELIGIBLE_NOT_VERIFIED: needs a documented decision before any payment");
  let differential: number | null = null;
  if (input.differentialExemptByDole) {
    differential = 0;
  } else if (typeof input.fullPayPerLeaveDay === "number") {
    if (!(input.fullPayPerLeaveDay >= 0)) throw new RangeError("fullPayPerLeaveDay must be non-negative");
    differential = a.eligible ? Math.max(0, round2(input.fullPayPerLeaveDay * days - sssBenefit)) : null;
  } else {
    flags.push("FULL_PAY_PER_LEAVE_DAY_REQUIRED_TO_PRICE_THE_DIFFERENTIAL");
  }
  return {
    ruleVersion: SSS_BENEFIT_RULE_VERSION, eligibleForSssBenefit: a.eligible, days, adsc: a.adsc, sssBenefit,
    employerAdvance: sssBenefit,
    advanceDueBy: input.applicationFiledOn ? addCalendarDays(input.applicationFiledOn, MATERNITY_ADVANCE_DUE_DAYS) : null,
    employerDifferential: differential,
    prescriptiveDeadline: addYears(input.contingencyDate, 10),
    adsc_detail: a, reviewFlags: flags,
  };
}

export type SicknessBenefitInput = {
  contributions: MonthlyContribution[];
  /** First day of sickness or confinement, YYYY-MM-DD. */
  sicknessStartDate: string;
  confinementDays: number;
  /** Days SSS approved for payment on this claim. */
  approvedDays: number;
  daysPaidThisCalendarYear?: number;
  daysPaidForSameIllness?: number;
  companySickLeaveExhausted: boolean;
};

export type SicknessBenefitResult = {
  ruleVersion: string;
  eligible: boolean;
  blockers: string[];
  adsc: number;
  dailyBenefit: number;
  payableDays: number;
  sssBenefit: number;
  adsc_detail: AdscResult;
  reviewFlags: string[];
};

export function computeSicknessBenefit(input: SicknessBenefitInput): SicknessBenefitResult {
  const a = computeAdsc(input.contributions, input.sicknessStartDate);
  for (const [label, v] of [["confinementDays", input.confinementDays], ["approvedDays", input.approvedDays]] as const) {
    if (!Number.isInteger(v) || v < 0) throw new RangeError(`${label} must be a non-negative integer`);
  }
  const paidYear = input.daysPaidThisCalendarYear ?? 0;
  const paidIllness = input.daysPaidForSameIllness ?? 0;
  const blockers: string[] = [];
  if (!a.eligible) blockers.push("FEWER_THAN_THREE_CONTRIBUTION_MONTHS_IN_WINDOW");
  if (input.confinementDays < SSS_SICKNESS_MIN_CONFINEMENT_DAYS) blockers.push("CONFINEMENT_UNDER_FOUR_DAYS");
  if (!input.companySickLeaveExhausted) blockers.push("COMPANY_SICK_LEAVE_NOT_EXHAUSTED");
  const room = Math.max(0, Math.min(SSS_SICKNESS_MAX_DAYS_PER_YEAR - paidYear, SSS_SICKNESS_MAX_DAYS_SAME_ILLNESS - paidIllness));
  if (room === 0) blockers.push("ANNUAL_OR_SAME_ILLNESS_DAY_LIMIT_REACHED");
  const eligible = blockers.length === 0;
  const payableDays = eligible ? Math.min(input.approvedDays, room) : 0;
  const flags = [...a.reviewFlags];
  flags.push("PAYABLE_DAYS_ARE_THE_SSS_APPROVED_DAYS: whether payment starts on day one or after day four is not stated by the SSS page");
  flags.push("EMPLOYER_ADVANCE_TIMING_FOR_SICKNESS_NOT_STATED_BY_SSS_PAGE");
  flags.push("RECOVERY_FROM_EMPLOYEE_IF_SSS_DENIES_NOT_STATED_DO_NOT_DEDUCT");
  flags.push("TAX_TREATMENT_NOT_VERIFIED");
  if (paidIllness + payableDays > SSS_SICKNESS_MAX_DAYS_SAME_ILLNESS) flags.push("SAME_ILLNESS_PAST_240_DAYS_IS_A_DISABILITY_CLAIM");
  return {
    ruleVersion: SSS_BENEFIT_RULE_VERSION, eligible, blockers, adsc: a.adsc,
    dailyBenefit: round2(a.adsc * SSS_SICKNESS_RATE), payableDays,
    sssBenefit: eligible ? round2((a.totalMsc * SSS_SICKNESS_RATE * payableDays) / SSS_ADSC_DIVISOR) : 0,
    adsc_detail: a, reviewFlags: flags,
  };
}

export type SicknessDeadlines = {
  employeeNoticeToEmployerBy: string | null;
  employerNoticeToSssBy: string;
  reimbursementClaimBy: string;
  /** Home confinement notified late is deemed to start no earlier than the fifth day before notice. */
  earliestDeemedStart: string | null;
};

export function sicknessDeadlines(input: {
  confinement: "HOME" | "HOSPITAL";
  confinementStart: string;
  dischargeDate?: string;
  employeeNotifiedEmployerOn?: string;
}): SicknessDeadlines {
  if (input.confinement === "HOSPITAL") {
    if (!input.dischargeDate) throw new RangeError("dischargeDate is required for hospital confinement");
    const by = addYears(input.dischargeDate, 1);
    return { employeeNoticeToEmployerBy: null, employerNoticeToSssBy: by, reimbursementClaimBy: by, earliestDeemedStart: null };
  }
  const employeeBy = addCalendarDays(input.confinementStart, 5);
  const received = input.employeeNotifiedEmployerOn ?? employeeBy;
  return {
    employeeNoticeToEmployerBy: employeeBy,
    employerNoticeToSssBy: addCalendarDays(received, 5),
    reimbursementClaimBy: addYears(input.confinementStart, 1),
    earliestDeemedStart:
      input.employeeNotifiedEmployerOn && parseDate(input.employeeNotifiedEmployerOn) > parseDate(employeeBy)
        ? addCalendarDays(input.employeeNotifiedEmployerOn, -5)
        : null,
  };
}
