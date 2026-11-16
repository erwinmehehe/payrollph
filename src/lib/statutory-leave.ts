/**
 * Philippine statutory leave entitlement rules (private sector).
 *
 * Pure decision library: it never approves a leave, writes a balance or moves money. Every result is a
 * recommendation with explicit blockers and review flags; anything the cited text does not settle is
 * flagged as SOURCE NOT VERIFIED instead of being guessed.
 *
 * Primary sources read (Lawphil reproductions, not checked against the Official Gazette):
 *  - RA 11210 IRR (Expanded Maternity Leave), RA 8187, RA 9710 Sec. 18, RA 9262 Sec. 43, RA 11861 (amending RA 8972).
 *  - Labor Code Art. 95: heading, five days and the listed exemptions come from a summary only.
 */
import { round2 } from "@/lib/round";
import {optionalStatutoryDays, requireStatutoryRecord, statutoryAmount, statutoryBoolean, statutoryDays, statutoryNumber} from "@/lib/statutory-input-validation";

export const STATUTORY_LEAVE_RULE_VERSION = "PH-STATUTORY-LEAVE-2026-11-16";

export type StatutoryLeaveKind =
  | "SERVICE_INCENTIVE"
  | "MATERNITY_LIVE_BIRTH"
  | "MATERNITY_MISCARRIAGE_OR_ETP"
  | "PATERNITY"
  | "SOLO_PARENT"
  | "VAWC"
  | "GYNECOLOGICAL_SURGERY";

export type SourceVerification = "PRIMARY_TEXT_READ" | "SUMMARY_ONLY";

export type StatutoryLeaveRule = {
  kind: StatutoryLeaveKind;
  citation: string;
  url: string;
  verification: SourceVerification;
  /** Entitled days per event or year; months for the gynecological special leave. */
  quantity: number;
  unit: "calendar-days" | "working-days" | "months";
  paid: boolean;
  cumulative: boolean | "NOT_ADDRESSED";
  convertibleToCash: boolean | "NOT_ADDRESSED";
};

export const STATUTORY_LEAVE_RULES: Readonly<Record<StatutoryLeaveKind, StatutoryLeaveRule>> = Object.freeze({
  SERVICE_INCENTIVE: {
    kind: "SERVICE_INCENTIVE", citation: "Labor Code Art. 95 (summary only)",
    url: "https://lawphil.net/statutes/presdecs/pd1974/pd_442_1974.html", verification: "SUMMARY_ONLY",
    quantity: 5, unit: "working-days", paid: true, cumulative: "NOT_ADDRESSED", convertibleToCash: "NOT_ADDRESSED",
  },
  MATERNITY_LIVE_BIRTH: {
    kind: "MATERNITY_LIVE_BIRTH", citation: "RA 11210 IRR Rule III Sec. 2; Rule IV Sec. 1-2",
    url: "https://www.lawphil.net/statutes/repacts/ra2019/irr_11210_2019.html", verification: "PRIMARY_TEXT_READ",
    quantity: 105, unit: "calendar-days", paid: true, cumulative: "NOT_ADDRESSED", convertibleToCash: "NOT_ADDRESSED",
  },
  MATERNITY_MISCARRIAGE_OR_ETP: {
    kind: "MATERNITY_MISCARRIAGE_OR_ETP", citation: "RA 11210 IRR Rule III Sec. 2; Rule II definitions",
    url: "https://www.lawphil.net/statutes/repacts/ra2019/irr_11210_2019.html", verification: "PRIMARY_TEXT_READ",
    quantity: 60, unit: "calendar-days", paid: true, cumulative: "NOT_ADDRESSED", convertibleToCash: "NOT_ADDRESSED",
  },
  PATERNITY: {
    kind: "PATERNITY", citation: "RA 8187 Sec. 2-3",
    url: "https://lawphil.net/statutes/repacts/ra1996/ra_8187_1996.html", verification: "PRIMARY_TEXT_READ",
    quantity: 7, unit: "calendar-days", paid: true, cumulative: "NOT_ADDRESSED", convertibleToCash: "NOT_ADDRESSED",
  },
  SOLO_PARENT: {
    kind: "SOLO_PARENT", citation: "RA 11861 (amending RA 8972) parental leave",
    url: "https://lawphil.net/statutes/repacts/ra2022/ra_11861_2022.html", verification: "PRIMARY_TEXT_READ",
    quantity: 7, unit: "working-days", paid: true, cumulative: false, convertibleToCash: "NOT_ADDRESSED",
  },
  VAWC: {
    kind: "VAWC", citation: "RA 9262 Sec. 43",
    url: "https://lawphil.net/statutes/repacts/ra2004/ra_9262_2004.html", verification: "PRIMARY_TEXT_READ",
    quantity: 10, unit: "calendar-days", paid: true, cumulative: "NOT_ADDRESSED", convertibleToCash: "NOT_ADDRESSED",
  },
  GYNECOLOGICAL_SURGERY: {
    kind: "GYNECOLOGICAL_SURGERY", citation: "RA 9710 Sec. 18",
    url: "https://lawphil.net/statutes/repacts/ra2009/ra_9710_2009.html", verification: "PRIMARY_TEXT_READ",
    quantity: 2, unit: "months", paid: true, cumulative: "NOT_ADDRESSED", convertibleToCash: "NOT_ADDRESSED",
  },
});

export const SOLO_PARENT_MATERNITY_EXTRA_DAYS = 15;
export const MATERNITY_MAX_FATHER_ALLOCATION_DAYS = 7;
export const MATERNITY_UNPAID_EXTENSION_DAYS = 30;
export const MATERNITY_MIN_POSTNATAL_DAYS = 60;
export const PATERNITY_MAX_DELIVERIES = 4;
export const SOLO_PARENT_MIN_SERVICE_MONTHS = 6;
export const SIL_MIN_SERVICE_MONTHS = 12;
export const GYNECOLOGICAL_MIN_SERVICE_MONTHS = 6;

export type LeaveDecision = {
  kind: StatutoryLeaveKind;
  ruleVersion: string;
  eligible: boolean;
  /** Entitled quantity for this event/year, in the rule's unit. Zero when not eligible. */
  entitled: number;
  unit: StatutoryLeaveRule["unit"];
  paid: boolean;
  /** Hard reasons the leave cannot be granted as entitlement. */
  blockers: string[];
  /** Matters a person must settle; none of these silently grant or deny the leave. */
  reviewFlags: string[];
  /** Extra amounts: unpaid extension, father allocation, maximum pay, etc. */
  extras: Record<string, number>;
  source: { citation: string; url: string; verification: SourceVerification };
};

export type StatutoryLeaveInput =
  | {
      kind: "SERVICE_INCENTIVE";
      /** Aggregate service need not be continuous. */
      aggregateServiceMonths: number;
      alreadyEnjoysSameBenefit?: boolean;
      /** Employer already grants at least five days of paid vacation leave. */
      grantsAtLeastFivePaidVacationDays?: boolean;
      /** Establishment regularly employs fewer than ten employees. */
      establishmentRegularlyEmploysFewerThanTen?: boolean;
      exemptedByLaborSecretary?: boolean;
    }
  | {
      kind: "MATERNITY_LIVE_BIRTH";
      soloParent?: boolean;
      /** Days the mother allocates to the father or alternate caregiver (0 to 7). */
      allocatedToFatherOrCaregiver?: number;
      /** Mother opts for the 30-day unpaid extension (live birth only). */
      electsUnpaidExtension?: boolean;
      employerNotifiedOfPregnancy?: boolean;
    }
  | { kind: "MATERNITY_MISCARRIAGE_OR_ETP"; soloParent?: boolean; employerNotifiedOfPregnancy?: boolean }
  | {
      kind: "PATERNITY";
      marriedToLegitimateSpouse: boolean;
      cohabiting: boolean;
      /** Deliveries already compensated under RA 8187 for this employee. */
      priorPaidDeliveries: number;
      employerNotifiedOfPregnancy?: boolean;
    }
  | {
      kind: "SOLO_PARENT";
      serviceMonths: number;
      soloParentStatusConfirmed: boolean;
      /** Days already used this leave year. */
      usedThisYear?: number;
    }
  | {
      kind: "VAWC";
      victimSurvivorOrChildOfEmployee: boolean;
      /** Extension days stated in the protection order, if any. */
      protectionOrderExtensionDays?: number;
      requestedDays: number;
    }
  | {
      kind: "GYNECOLOGICAL_SURGERY";
      /** Continuous aggregate service within the last twelve months. */
      serviceMonthsInLastTwelve: number;
      surgeryCausedByGynecologicalDisorder: boolean;
      grossMonthlyCompensation: number;
    };

function base(kind: StatutoryLeaveKind): LeaveDecision {
  const rule = STATUTORY_LEAVE_RULES[kind];
  const flags: string[] = [];
  if (rule.verification === "SUMMARY_ONLY") {
    flags.push("SOURCE_NOT_FULLY_VERIFIED: statute text was available only as a summary; confirm against the verbatim article");
  }
  if (rule.convertibleToCash === "NOT_ADDRESSED") flags.push("CASH_CONVERSION_NOT_ADDRESSED_BY_SOURCE");
  return {
    kind, ruleVersion: STATUTORY_LEAVE_RULE_VERSION, eligible: false, entitled: 0, unit: rule.unit, paid: rule.paid,
    blockers: [], reviewFlags: flags, extras: {},
    source: { citation: rule.citation, url: rule.url, verification: rule.verification },
  };
}

function finish(d: LeaveDecision, entitled: number): LeaveDecision {
  d.eligible = d.blockers.length === 0;
  d.entitled = d.eligible ? entitled : 0;
  return d;
}

export function evaluateStatutoryLeave(input: StatutoryLeaveInput): LeaveDecision {
  requireStatutoryRecord(input, "leave input");
  if (typeof input.kind !== "string" || !Object.hasOwn(STATUTORY_LEAVE_RULES, input.kind)) {
    throw new RangeError("Unknown statutory leave kind");
  }
  const record = input as unknown as Record<string, unknown>;
  for (const key of ["alreadyEnjoysSameBenefit", "grantsAtLeastFivePaidVacationDays", "establishmentRegularlyEmploysFewerThanTen", "exemptedByLaborSecretary", "soloParent", "electsUnpaidExtension", "employerNotifiedOfPregnancy"]) {
    statutoryBoolean(record[key], key, true);
  }
  const d = base(input.kind);
  const rule = STATUTORY_LEAVE_RULES[input.kind];
  switch (input.kind) {
    case "SERVICE_INCENTIVE": {
      statutoryNumber(input.aggregateServiceMonths, "aggregateServiceMonths");
      if (input.aggregateServiceMonths < SIL_MIN_SERVICE_MONTHS) d.blockers.push("LESS_THAN_ONE_YEAR_OF_AGGREGATE_SERVICE");
      if (input.alreadyEnjoysSameBenefit) d.blockers.push("EXEMPT_ALREADY_ENJOYS_SAME_BENEFIT");
      if (input.grantsAtLeastFivePaidVacationDays) d.blockers.push("EXEMPT_AT_LEAST_FIVE_DAYS_PAID_VACATION");
      if (input.establishmentRegularlyEmploysFewerThanTen) d.blockers.push("EXEMPT_ESTABLISHMENT_UNDER_TEN_EMPLOYEES");
      if (input.exemptedByLaborSecretary) d.blockers.push("EXEMPT_BY_LABOR_SECRETARY");
      d.reviewFlags.push("IRR_EXCLUDED_CLASSES_NOT_ENCODED: managerial, field personnel and other IRR exclusions need review");
      return finish(d, rule.quantity);
    }
    case "MATERNITY_LIVE_BIRTH": {
      const allocated = optionalStatutoryDays(input.allocatedToFatherOrCaregiver, "allocatedToFatherOrCaregiver");
      if (allocated > MATERNITY_MAX_FATHER_ALLOCATION_DAYS) d.blockers.push("ALLOCATION_EXCEEDS_SEVEN_DAYS");
      if (input.employerNotifiedOfPregnancy === false) {
        d.reviewFlags.push("EMPLOYER_NOT_NOTIFIED: late notice does not bar the benefit (IRR Rule VI Sec. 2(c)); SSS guidelines apply");
      }
      const total = rule.quantity + (input.soloParent ? SOLO_PARENT_MATERNITY_EXTRA_DAYS : 0);
      d.extras = {
        totalPaidLeaveDays: total,
        allocatedToFatherOrCaregiver: allocated,
        paidLeaveDaysForMother: total - allocated,
        minimumPostnatalDays: MATERNITY_MIN_POSTNATAL_DAYS,
        unpaidExtensionDays: input.electsUnpaidExtension ? MATERNITY_UNPAID_EXTENSION_DAYS : 0,
      };
      d.reviewFlags.push("FULL_PAY_BASIS_NOT_VERIFIED: IRR defines full pay by working days; how it applies to calendar leave days needs a payroll policy");
      d.reviewFlags.push("TAX_TREATMENT_NOT_VERIFIED: IRR is silent on income-tax and withholding treatment");
      return finish(d, total);
    }
    case "MATERNITY_MISCARRIAGE_OR_ETP": {
      d.extras = { totalPaidLeaveDays: rule.quantity };
      if (input.soloParent) {
        d.reviewFlags.push("SOLO_PARENT_EXTRA_15_DAYS_NOT_GRANTED: IRR ties the 15 days to live childbirth; confirm for miscarriage or ETP");
      }
      if (input.employerNotifiedOfPregnancy === false) d.reviewFlags.push("EMPLOYER_NOT_NOTIFIED: late notice does not bar the benefit");
      d.reviewFlags.push("TAX_TREATMENT_NOT_VERIFIED: IRR is silent on income-tax and withholding treatment");
      return finish(d, rule.quantity);
    }
    case "PATERNITY": {
      statutoryBoolean(input.marriedToLegitimateSpouse, "marriedToLegitimateSpouse");
      statutoryBoolean(input.cohabiting, "cohabiting");
      const prior = statutoryDays(input.priorPaidDeliveries, "priorPaidDeliveries");
      if (!input.marriedToLegitimateSpouse) d.blockers.push("NOT_MARRIED_TO_LEGITIMATE_SPOUSE");
      if (!input.cohabiting) d.blockers.push("NOT_COHABITING_WITH_SPOUSE");
      if (prior >= PATERNITY_MAX_DELIVERIES) d.blockers.push("FIRST_FOUR_DELIVERIES_ALREADY_PAID");
      if (input.employerNotifiedOfPregnancy === false) d.reviewFlags.push("EMPLOYER_NOT_NOTIFIED_OF_PREGNANCY_AND_EXPECTED_DELIVERY");
      d.reviewFlags.push("MISCARRIAGE_COUNTS_AS_A_DELIVERY: RA 8187 Sec. 2 defines delivery to include any miscarriage");
      d.extras = { deliveriesRemainingAfterThis: Math.max(0, PATERNITY_MAX_DELIVERIES - prior - 1) };
      return finish(d, rule.quantity);
    }
    case "SOLO_PARENT": {
      statutoryNumber(input.serviceMonths, "serviceMonths");
      statutoryBoolean(input.soloParentStatusConfirmed, "soloParentStatusConfirmed");
      if (input.serviceMonths < SOLO_PARENT_MIN_SERVICE_MONTHS) d.blockers.push("LESS_THAN_SIX_MONTHS_OF_SERVICE");
      if (!input.soloParentStatusConfirmed) d.blockers.push("SOLO_PARENT_STATUS_NOT_CONFIRMED");
      const used = optionalStatutoryDays(input.usedThisYear, "usedThisYear");
      const remaining = Math.max(0, rule.quantity - used);
      if (remaining === 0) d.blockers.push("ANNUAL_PARENTAL_LEAVE_ALREADY_USED");
      d.reviewFlags.push("FORFEITABLE_NONCUMULATIVE: unused days are forfeited at year end and never carried over");
      d.reviewFlags.push("SOLO_PARENT_ID_NOT_REQUIRED_BY_LEAVE_PROVISION: the SPIC is stated only for the additional benefits");
      d.extras = { remainingThisYear: remaining };
      return finish(d, remaining);
    }
    case "VAWC": {
      statutoryBoolean(input.victimSurvivorOrChildOfEmployee, "victimSurvivorOrChildOfEmployee");
      const ext = optionalStatutoryDays(input.protectionOrderExtensionDays, "protectionOrderExtensionDays");
      const requested = statutoryDays(input.requestedDays, "requestedDays");
      if (!input.victimSurvivorOrChildOfEmployee) d.blockers.push("NOT_A_VICTIM_UNDER_RA_9262");
      const ceiling = statutoryDays(rule.quantity + ext, "ceilingDays");
      d.extras = { ceilingDays: ceiling, requestedDays: requested };
      if (requested > ceiling) d.reviewFlags.push("REQUEST_EXCEEDS_CEILING: only up to ten days plus any protection-order extension is covered");
      d.reviewFlags.push("IN_ADDITION_TO_OTHER_PAID_LEAVES: do not deduct from vacation, sick or service incentive leave");
      d.reviewFlags.push("SENSITIVE_RECORD: restrict visibility; Sec. 43 requires no certification");
      return finish(d, Math.min(requested, ceiling));
    }
    case "GYNECOLOGICAL_SURGERY": {
      statutoryNumber(input.serviceMonthsInLastTwelve, "serviceMonthsInLastTwelve", 12);
      statutoryBoolean(input.surgeryCausedByGynecologicalDisorder, "surgeryCausedByGynecologicalDisorder");
      statutoryAmount(input.grossMonthlyCompensation, "grossMonthlyCompensation");
      if (input.serviceMonthsInLastTwelve < GYNECOLOGICAL_MIN_SERVICE_MONTHS) d.blockers.push("LESS_THAN_SIX_MONTHS_SERVICE_IN_LAST_TWELVE");
      if (!input.surgeryCausedByGynecologicalDisorder) d.blockers.push("SURGERY_NOT_CAUSED_BY_GYNECOLOGICAL_DISORDER");
      if (!(input.grossMonthlyCompensation > 0)) d.blockers.push("GROSS_MONTHLY_COMPENSATION_REQUIRED");
      d.extras = { maximumPay: round2(statutoryAmount(rule.quantity * input.grossMonthlyCompensation, "maximumPay")) };
      d.reviewFlags.push("ACTUAL_PERIOD_UP_TO_TWO_MONTHS_PER_MEDICAL_CERTIFICATION_NOT_VERIFIED");
      d.reviewFlags.push("CUMULATIVE_AND_CONVERTIBLE_NOT_ADDRESSED_BY_SEC_18");
      return finish(d, rule.quantity);
    }
  }
}
